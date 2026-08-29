/**
 * Tira a midia de dentro do banco.
 *
 * O arquivo era gravado em base64 na coluna metadata da propria mensagem. Sao
 * 3.356 midias em 31.739 mensagens carregando ~1,3 GB, na tabela que o inbox le
 * o tempo todo: abrir uma conversa custava 626 ms contra 258 ms sem essa coluna.
 *
 * Aqui o arquivo que ja esta no banco e enviado para o bucket e a linha passa a
 * apontar para a URL. Nao depende da central: os bytes ja estao na mao. O
 * base64 so sai da linha depois de o arquivo responder no bucket, entao nenhuma
 * mensagem fica sem midia no meio do caminho.
 *
 * Roda com o sistema no ar. Em lotes, com pausa, para nao pesar no banco.
 *
 *   node --env-file=.env.local scripts/mover-midia-para-bucket.mjs --dry-run
 *   node --env-file=.env.local scripts/mover-midia-para-bucket.mjs --limite=200
 *   node --env-file=.env.local scripts/mover-midia-para-bucket.mjs
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'inbox-media';
const PAGINA = 40;
const PAUSA_MS = 500;
const MINIMO_BYTES = 20 * 1024;

const seco = process.argv.includes('--dry-run');
const desdeArg = process.argv.find((a) => a.startsWith('--desde='));
// A midia toda esta nos ultimos dias: varrer o historico inteiro so faz o banco
// destoastar 32 mil linhas a toa, e foi o que deixou a instancia de joelhos.
const desde = desdeArg ? desdeArg.split('=')[1] : '2026-08-17';
const limiteArg = process.argv.find((a) => a.startsWith('--limite='));
const limite = limiteArg ? Number(limiteArg.split('=')[1]) : Infinity;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function extensaoDe(mime, nomeOriginal) {
  const doNome = String(nomeOriginal || '').split('.').pop();
  if (doNome && doNome.length <= 5 && /^[a-z0-9]+$/i.test(doNome)) return doNome.toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('pdf')) return 'pdf';
  return 'bin';
}

function pastaDe(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'imagem';
  if (m.startsWith('video/')) return 'video';
  return 'arquivo';
}

let analisadas = 0;
let movidas = 0;
let falhas = 0;
let liberado = 0;

console.log(seco ? 'MODO SECO: nada sera gravado.\n' : 'Movendo midia para o bucket. O sistema segue no ar.\n');

// Pagina grande em cima da coluna com base64 estoura o statement timeout do
// banco: e o mesmo motivo de o inbox ficar lento. Quando isso acontece a pagina
// e relida em pedacos menores, em vez de abandonar o resto da fila.
async function lerPagina(inicio, tamanho, tentativa = 1) {
  const { data, error } = await supabase
    .from('whatsapp_mensagens')
    .select('id, created_at, mensagem, metadata')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .range(inicio, inicio + tamanho - 1);
  if (!error) return data || [];

  // A borda da Supabase as vezes devolve pagina de erro em vez de JSON. Antes
  // isso abortava a fila inteira: agora espera e tenta de novo.
  if (!/timeout/i.test(error.message)) {
    if (tentativa >= 3) throw new Error(String(error.message).replace(/<[^>]*>/g, ' ').slice(0, 120));
    await espera(3000 * tentativa);
    return lerPagina(inicio, tamanho, tentativa + 1);
  }

  if (tamanho <= 5) throw new Error('timeout mesmo com pagina minima');

  const metade = Math.max(5, Math.floor(tamanho / 4));
  const juntas = [];
  for (let deslocamento = 0; deslocamento < tamanho; deslocamento += metade) {
    await espera(PAUSA_MS);
    juntas.push(...await lerPagina(inicio + deslocamento, Math.min(metade, tamanho - deslocamento)));
  }
  return juntas;
}

for (let inicio = 0; ; inicio += PAGINA) {
  let data;
  try {
    data = await lerPagina(inicio, PAGINA);
  } catch (erro) {
    console.error(`falha ao ler a pagina ${inicio}:`, erro.message);
    break;
  }
  if (!data?.length) break;

  for (const mensagem of data) {
    analisadas += 1;
    const base64 = String(mensagem.metadata?.media_base64 || '');
    if (!base64) continue;

    const bytes = Buffer.from(base64.includes(';base64,') ? base64.split(';base64,')[1] : base64, 'base64');
    if (bytes.length < MINIMO_BYTES) continue;
    if (movidas >= limite) break;

    const quando = String(mensagem.created_at).slice(0, 16);
    const rotulo = String(mensagem.mensagem || '').replace(/\s+/g, ' ').slice(0, 32);
    const mime = mensagem.metadata?.media_mimetype || 'application/octet-stream';
    const caminho = `${pastaDe(mime)}/${mensagem.id}.${extensaoDe(mime, mensagem.metadata?.media_file_name)}`;

    if (seco) {
      console.log(`  ${quando} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  ${rotulo}`);
      movidas += 1;
      liberado += bytes.length;
      continue;
    }

    try {
      const upload = await supabase.storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: true });
      if (upload.error) throw new Error(upload.error.message);

      const publica = supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;

      // Confere que o arquivo responde antes de tirar o base64 da linha. Sem
      // esta checagem, um upload que falhasse em silencio deixaria a mensagem
      // sem midia nenhuma.
      const conferencia = await fetch(publica, { method: 'HEAD' });
      if (!conferencia.ok) throw new Error(`bucket respondeu ${conferencia.status}`);

      const { media_base64: _saiu, ...restante } = mensagem.metadata || {};
      const { error: erroUpdate } = await supabase
        .from('whatsapp_mensagens')
        .update({
          metadata: {
            ...restante,
            media_url: publica,
            media_mimetype: mime,
            media_movido_em: new Date().toISOString(),
          },
        })
        .eq('id', mensagem.id);
      if (erroUpdate) throw erroUpdate;

      movidas += 1;
      liberado += bytes.length;
      console.log(`  ${quando} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  ${rotulo}`);
    } catch (erro) {
      falhas += 1;
      console.log(`  ${quando} FALHOU  ${rotulo}: ${erro instanceof Error ? erro.message.slice(0, 60) : erro}`);
    }
  }

  if (movidas >= limite) break;
  if (data.length < PAGINA) break;
  await espera(PAUSA_MS);
}

console.log(`\nanalisadas: ${analisadas} | movidas: ${movidas} | falhas: ${falhas}`);
console.log(`espaco tirado do banco: ${(liberado / 1024 / 1024).toFixed(1)} MB`);
