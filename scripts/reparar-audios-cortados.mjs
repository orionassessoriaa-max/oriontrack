/**
 * Conserta audio truncado no teto de cache.
 *
 * O webhook grava a midia como base64 dentro da mensagem, e parte dos audios
 * chega cortada em 262.144 bytes cravados, que e o teto de 256 KB. O arquivo
 * inteiro continua na central: o de 21/08 do Sandro tem 858.789 bytes, contra os
 * 262.144 guardados, e por isso tocava picotado.
 *
 * Aqui cada mensagem cortada e rebaixada da central, mandada para o bucket e a
 * linha passa a apontar para a URL. O base64 sai do banco, que era justamente o
 * que inchava whatsapp_mensagens.
 *
 *   node --env-file=.env.local scripts/reparar-audios-cortados.mjs --dry-run
 *   node --env-file=.env.local scripts/reparar-audios-cortados.mjs
 */
import { createClient } from '@supabase/supabase-js';

const TETO = 256 * 1024;
const BUCKET = 'inbox-media';
const seco = process.argv.includes('--dry-run');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const uazapi = String(process.env.UAZAPI_URL || '').replace(/\/+$/, '');

// A central as vezes responde pagina de erro em vez de JSON quando recebe muitas
// chamadas seguidas. Sem esta guarda o script quebrava com o HTML na tela.
async function listarInstancias(tentativa = 1) {
  const resposta = await fetch(`${uazapi}/instance/all`, { headers: { admintoken: process.env.UAZAPI_GLOBAL_TOKEN } });
  const texto = await resposta.text();
  try {
    const json = JSON.parse(texto);
    return Array.isArray(json) ? json : json.instances || json.data || [];
  } catch {
    if (tentativa >= 3) throw new Error(`a central respondeu ${resposta.status} sem JSON; tente de novo em alguns minutos`);
    await new Promise((r) => setTimeout(r, 4000 * tentativa));
    return listarInstancias(tentativa + 1);
  }
}

const instancias = await listarInstancias();
const tokenPorInstancia = new Map(instancias.map((i) => [i.name || i.instanceName, i.token]));

const cortadas = [];
for (let inicio = 0; ; inicio += 500) {
  const { data, error } = await supabase
    .from('whatsapp_mensagens')
    .select('id, created_at, remetente, provider_message_id, metadata')
    .order('created_at', { ascending: false })
    .range(inicio, inicio + 499);
  if (error) throw error;
  if (!data?.length) break;
  for (const mensagem of data) {
    const base64 = mensagem.metadata?.media_base64;
    if (!base64) continue;
    if (Buffer.from(base64, 'base64').length === TETO) cortadas.push(mensagem);
  }
  if (data.length < 500) break;
}

console.log(`audios cortados encontrados: ${cortadas.length}${seco ? ' (modo seco, nada sera gravado)' : ''}`);

let recuperados = 0;
let liberado = 0;
for (const mensagem of cortadas) {
  const instancia = mensagem.metadata?.instance;
  const token = tokenPorInstancia.get(instancia);
  const quando = String(mensagem.created_at).slice(0, 16);
  if (!token || !mensagem.provider_message_id) {
    console.log(`  ${quando} | ${mensagem.remetente}: sem instancia ou id na central, pulando`);
    continue;
  }

  try {
    const resposta = await fetch(`${uazapi}/message/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ id: mensagem.provider_message_id }),
    });
    const payload = await resposta.json().catch(() => ({}));
    const url = payload.fileURL || payload.url || payload.fileUrl || '';
    const base64 = payload.fileBase64 || payload.base64 || payload.media_base64 || '';
    const buffer = url
      ? Buffer.from(await (await fetch(url)).arrayBuffer())
      : base64 ? Buffer.from(base64, 'base64') : null;

    if (!buffer?.length) {
      console.log(`  ${quando} | ${mensagem.remetente}: a central nao devolveu o arquivo`);
      continue;
    }

    const mime = mensagem.metadata?.media_mimetype || payload.mimetype || 'audio/mpeg';
    const extensao = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'mp3';
    const nome = `audio/${mensagem.id}.${extensao}`;

    if (!seco) {
      const upload = await supabase.storage.from(BUCKET).upload(nome, buffer, { contentType: mime, upsert: true });
      if (upload.error) throw new Error(upload.error.message);
      const publica = supabase.storage.from(BUCKET).getPublicUrl(nome).data.publicUrl;
      const { media_base64: _cortado, ...restante } = mensagem.metadata || {};
      const { error } = await supabase
        .from('whatsapp_mensagens')
        .update({ metadata: { ...restante, media_url: publica, media_mimetype: mime, media_reparado_em: new Date().toISOString() } })
        .eq('id', mensagem.id);
      if (error) throw error;
    }

    recuperados += 1;
    liberado += TETO;
    console.log(`  ${quando} | ${mensagem.remetente}: ${TETO} -> ${buffer.length} bytes`);
  } catch (erro) {
    console.log(`  ${quando} | ${mensagem.remetente}: falhou (${erro instanceof Error ? erro.message.slice(0, 60) : erro})`);
  }
}

console.log(`\nrecuperados: ${recuperados} | espaco liberado no banco: ${(liberado / 1024 / 1024).toFixed(1)} MB`);
