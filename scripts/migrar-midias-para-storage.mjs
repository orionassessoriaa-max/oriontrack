/**
 * Tira as midias de dentro do Postgres e coloca no Supabase Storage.
 *
 * O inbox guardava foto, audio e video em base64 dentro de
 * whatsapp_mensagens.metadata, com teto de 15 MB por mensagem. Resultado:
 * 2.041 mensagens ocupando 839 MB num banco de 1 GB de RAM, o que derrubava a
 * instancia. Aqui cada arquivo vai para o bucket, a linha fica com a URL e o
 * base64 sai.
 *
 * Uso (na VPS, dentro de /root/oriontrack):
 *   node scripts/migrar-midias-para-storage.mjs            # migra
 *   node scripts/migrar-midias-para-storage.mjs --dry-run  # so mostra o que faria
 *   node scripts/migrar-midias-para-storage.mjs --limite=50
 *
 * E seguro parar no meio: cada mensagem migrada e marcada, e rodar de novo
 * continua de onde parou. Nada e apagado sem a URL estar gravada antes.
 */
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Dentro do container as variaveis ja vem do stack; fora dele, le do arquivo.
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const dotenv = await import('dotenv');
  dotenv.default.config({ path: path.resolve(process.cwd(), '.env.production') });
  dotenv.default.config({ path: path.resolve(process.cwd(), '.env.local') });
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(1);
}

const BUCKET = 'inbox-media';
const LOTE = 5;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limiteArg = args.find((arg) => arg.startsWith('--limite='));
const limite = limiteArg ? Number(limiteArg.split('=')[1]) : Infinity;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const EXTENSOES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'application/pdf': 'pdf',
};

function extensaoDe(mime, nomeArquivo) {
  const limpo = String(mime || '').split(';')[0].trim().toLowerCase();
  if (EXTENSOES[limpo]) return EXTENSOES[limpo];
  const doNome = String(nomeArquivo || '').split('.').pop();
  return doNome && doNome.length <= 5 ? doNome.toLowerCase() : 'bin';
}

function tamanhoBase64(base64) {
  const limpo = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!limpo) return 0;
  const padding = limpo.endsWith('==') ? 2 : limpo.endsWith('=') ? 1 : 0;
  return Math.floor((limpo.length * 3) / 4) - padding;
}

async function garantirBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket) => bucket.name === BUCKET)) return;
  if (dryRun) {
    console.log(`[dry-run] criaria o bucket ${BUCKET}`);
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(`bucket ${BUCKET} criado`);
}

/**
 * Paginacao por data em vez de filtro no campo JSON: filtrar por
 * metadata->>media_base64 obriga o Postgres a abrir os 839 MB de uma vez e a
 * consulta morre no statement timeout.
 */
async function proximas(cursor, quantidade) {
  let query = supabase
    .from('whatsapp_mensagens')
    .select('id,conversa_id,metadata,created_at')
    .order('created_at', { ascending: true })
    .limit(quantidade);
  if (cursor) query = query.gt('created_at', cursor);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function migrarUma(mensagem) {
  const metadata = mensagem.metadata || {};
  const base64 = String(metadata.media_base64 || '').replace(/^data:[^;]+;base64,/, '');
  const bytes = tamanhoBase64(base64);
  const mime = String(metadata.media_mimetype || metadata.mimetype || 'application/octet-stream');
  const nome = `${mensagem.conversa_id}/${mensagem.id}.${extensaoDe(mime, metadata.media_file_name)}`;

  if (dryRun) {
    console.log(`[dry-run] ${mensagem.created_at.slice(0, 10)} ${nome} (${Math.round(bytes / 1024)} KB)`);
    return bytes;
  }

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(nome, Buffer.from(base64, 'base64'), { contentType: mime, upsert: true });
  if (upload.error) throw new Error(`upload falhou: ${upload.error.message}`);

  const url = supabase.storage.from(BUCKET).getPublicUrl(nome).data.publicUrl;

  // A URL entra na mesma escrita em que o base64 sai: se algo falhar antes
  // disso, a mensagem continua intacta com o arquivo original.
  const novoMetadata = { ...metadata, media_url: url, media_migrado_at: new Date().toISOString() };
  delete novoMetadata.media_base64;

  const { error } = await supabase
    .from('whatsapp_mensagens')
    .update({ metadata: novoMetadata })
    .eq('id', mensagem.id);
  if (error) throw new Error(`update falhou: ${error.message}`);

  return bytes;
}

const inicio = Date.now();
let migradas = 0;
let liberados = 0;
let falhas = 0;

await garantirBucket();
console.log(dryRun ? 'modo simulacao, nada sera alterado\n' : 'migrando...\n');

let cursor = null;
let varridas = 0;

while (migradas + falhas < limite) {
  const lote = await proximas(cursor, LOTE);
  if (!lote.length) break;
  cursor = lote[lote.length - 1].created_at;
  varridas += lote.length;

  for (const mensagem of lote) {
    if (!mensagem.metadata?.media_base64) continue;
    try {
      liberados += await migrarUma(mensagem);
      migradas += 1;
    } catch (erro) {
      falhas += 1;
      console.error(`falhou ${mensagem.id}: ${erro.message}`);
    }
    if (migradas + falhas >= limite) break;
  }

  if (varridas % 100 === 0) {
    console.log(`${varridas} mensagens lidas | ${migradas} migradas | ${Math.round(liberados / 1024 / 1024)} MB liberados`);
  }
  if (dryRun && migradas > 0) break;
}

const minutos = ((Date.now() - inicio) / 60000).toFixed(1);
console.log(`\nfim: ${migradas} mensagens, ${Math.round(liberados / 1024 / 1024)} MB tirados do banco, ${falhas} falhas, ${minutos} min`);
if (!dryRun && migradas > 0) {
  console.log('\nAgora rode no SQL Editor, fora do horario comercial:');
  console.log('  vacuum full analyze public.whatsapp_mensagens;');
}
