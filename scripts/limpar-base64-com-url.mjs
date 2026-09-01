/**
 * Tira o base64 das linhas que ja tem o arquivo no bucket.
 *
 * O webhook copiava o corpo do provedor inteiro para o metadata, e o arquivo em
 * base64 vinha junto mesmo depois de a URL ser gravada. Aqui a linha perde so o
 * peso: o arquivo continua no bucket e a mensagem continua abrindo igual.
 *
 * Roda em lote pequeno e com pausa: varredura grande neste banco ja derrubou a
 * instancia uma vez.
 *
 *   node --env-file=.env.local scripts/limpar-base64-com-url.mjs --dry-run
 *   node --env-file=.env.local scripts/limpar-base64-com-url.mjs --desde=2026-08-31
 */
import { createClient } from '@supabase/supabase-js';

const PAGINA = 40;
const PAUSA_MS = 600;
const TETO_TEXTO = 20_000;
const seco = process.argv.includes('--dry-run');
const desdeArg = process.argv.find((a) => a.startsWith('--desde='));
const desde = desdeArg ? desdeArg.split('=')[1] : '2026-08-31';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function semBlobs(objeto) {
  const limpo = {};
  for (const [chave, valor] of Object.entries(objeto || {})) {
    if (typeof valor === 'string' && valor.length > TETO_TEXTO) continue;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      limpo[chave] = semBlobs(valor);
      continue;
    }
    limpo[chave] = valor;
  }
  return limpo;
}

let analisadas = 0;
let limpas = 0;
let liberado = 0;

console.log(`${seco ? 'MODO SECO: nada sera gravado.' : 'Limpando.'} A partir de ${desde}, em paginas de ${PAGINA}.\n`);

for (let inicio = 0; ; inicio += PAGINA) {
  const { data, error } = await supabase
    .from('whatsapp_mensagens')
    .select('id, created_at, mensagem, metadata')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .range(inicio, inicio + PAGINA - 1);
  if (error) {
    console.error('falha ao ler a pagina:', String(error.message).replace(/<[^>]*>/g, ' ').slice(0, 80));
    break;
  }
  if (!data.length) break;

  for (const mensagem of data) {
    analisadas += 1;
    const metadata = mensagem.metadata || {};
    if (!metadata.media_url) continue;

    const antes = JSON.stringify(metadata).length;
    const limpo = semBlobs(metadata);
    const depois = JSON.stringify(limpo).length;
    if (antes - depois < 1000) continue;

    liberado += antes - depois;
    limpas += 1;
    console.log(`  ${mensagem.created_at.slice(5, 16)} ${((antes - depois) / 1024).toFixed(0).padStart(5)} KB  ${String(mensagem.mensagem).replace(/\s+/g, ' ').slice(0, 30)}`);
    if (!seco) {
      const { error: erroUpdate } = await supabase.from('whatsapp_mensagens').update({ metadata: limpo }).eq('id', mensagem.id);
      if (erroUpdate) console.log(`     falhou: ${String(erroUpdate.message).slice(0, 60)}`);
    }
  }

  if (data.length < PAGINA) break;
  await espera(PAUSA_MS);
}

console.log(`\nanalisadas: ${analisadas} | limpas: ${limpas} | espaco tirado do banco: ${(liberado / 1024 / 1024).toFixed(1)} MB`);
