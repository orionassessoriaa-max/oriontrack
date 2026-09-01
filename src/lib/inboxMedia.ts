import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Midia do WhatsApp fora do banco.
 *
 * O arquivo era gravado em base64 dentro da coluna metadata da mensagem, na
 * tabela que o inbox le o tempo todo. Abrir uma conversa custava 626 ms contra
 * 258 ms sem essa coluna, e consulta com filtro em JSONB estourava o timeout do
 * banco. Aqui o arquivo vai para o bucket e a linha guarda so a URL, que e o
 * que a tela ja sabe ler.
 *
 * Arquivo pequeno continua inline: subir ao bucket custa uma ida e volta que
 * nao se paga para poucos KB.
 */
const BUCKET = 'inbox-media';
const MINIMO_PARA_BUCKET = 20 * 1024;

function extensaoDe(mime?: string | null, nomeOriginal?: string | null) {
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

function pastaDe(mime?: string | null) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'imagem';
  if (m.startsWith('video/')) return 'video';
  return 'arquivo';
}

/**
 * Devolve o metadata pronto para gravar: com `media_url` quando o arquivo subiu,
 * ou com o `media_base64` original quando nao subiu. Falha de upload nunca
 * derruba a mensagem — o pior caso e voltar ao comportamento antigo.
 */
export async function guardarMidiaForaDoBanco(metadata: Record<string, any>) {
  const base64Bruto = String(metadata?.media_base64 || '');
  if (!base64Bruto || metadata?.media_url) return metadata;

  const limpo = base64Bruto.includes(';base64,') ? base64Bruto.split(';base64,')[1] : base64Bruto;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(limpo, 'base64');
  } catch {
    return metadata;
  }
  if (bytes.length < MINIMO_PARA_BUCKET) return metadata;

  const mime = String(metadata?.media_mimetype || 'application/octet-stream');
  const caminho = `${pastaDe(mime)}/${crypto.randomUUID()}.${extensaoDe(mime, metadata?.media_file_name)}`;

  try {
    const upload = await supabaseAdmin.storage.from(BUCKET).upload(caminho, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (upload.error) throw new Error(upload.error.message);

    const publica = supabaseAdmin.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
    if (!publica) throw new Error('bucket nao devolveu URL publica');

    const { media_base64: _saiu, ...restante } = metadata;
    return { ...restante, media_url: publica, media_mimetype: mime };
  } catch (erro) {
    console.warn('[inbox_media] Nao consegui subir a midia para o bucket, mantendo no banco:', {
      caminho,
      bytes: bytes.length,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return metadata;
  }
}

/**
 * Tira do metadata qualquer bloco gigante de texto quando o arquivo ja esta no
 * bucket.
 *
 * O webhook copia o corpo inteiro do provedor para dentro da linha, e esse
 * corpo traz o arquivo em base64. Guardar a URL por cima nao apagava o base64
 * que veio junto: em um unico dia voltaram 24 MB para a tabela que o inbox mais
 * le. Em vez de perseguir nome de campo, que muda conforme o tipo de midia,
 * remove todo texto acima de 20 mil caracteres.
 */
const TETO_TEXTO = 20_000;

export function removerBlobs(metadata: Record<string, any>) {
  if (!metadata?.media_url) return metadata;

  const limpo: Record<string, any> = {};
  for (const [chave, valor] of Object.entries(metadata)) {
    if (typeof valor === 'string' && valor.length > TETO_TEXTO) continue;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      limpo[chave] = removerBlobsDeObjeto(valor as Record<string, any>);
      continue;
    }
    limpo[chave] = valor;
  }
  return limpo;
}

function removerBlobsDeObjeto(objeto: Record<string, any>) {
  const limpo: Record<string, any> = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    if (typeof valor === 'string' && valor.length > TETO_TEXTO) continue;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      limpo[chave] = removerBlobsDeObjeto(valor as Record<string, any>);
      continue;
    }
    limpo[chave] = valor;
  }
  return limpo;
}
