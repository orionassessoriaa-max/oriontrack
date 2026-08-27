/**
 * Relatorio de gasto na OpenAI, por origem e por dia.
 *
 * Uso:
 *   node --env-file=.env.local scripts/relatorio-openai.mjs [dias]
 *
 * Os precos abaixo sao os da tabela publica da OpenAI e ficam num lugar so:
 * confira antes de tratar o valor como exato. O que o banco guarda e o que nao
 * muda com a tabela de preco: origem, modelo e tokens.
 */
import { createClient } from '@supabase/supabase-js';

const PRECO_POR_MILHAO = {
  'gpt-4o-mini': { entrada: 0.15, saida: 0.60 },
  'gpt-4o': { entrada: 2.50, saida: 10.00 },
};
const PRECO_IMAGEM_USD = 0.42;   // mesmo valor de orion_cred_global_config
const PRECO_WHISPER_MINUTO = 0.006;

const dias = Number(process.argv[2] || 7);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const desde = new Date(Date.now() - dias * 86400000).toISOString();
let linhas = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('openai_uso')
    .select('created_at, origem, modelo, tokens_entrada, tokens_saida, imagens, ok')
    .gte('created_at', desde)
    .order('created_at')
    .range(from, from + 999);
  if (error) {
    console.error('Aplique supabase/2026-08-27_openai_uso.sql antes:', error.message);
    process.exit(1);
  }
  if (!data.length) break;
  linhas = linhas.concat(data);
  if (data.length < 1000) break;
}

if (!linhas.length) {
  console.log(`Nenhuma chamada registrada nos ultimos ${dias} dias.`);
  process.exit(0);
}

function custo(linha) {
  if (linha.imagens) return linha.imagens * PRECO_IMAGEM_USD;
  if (String(linha.modelo).includes('whisper')) return PRECO_WHISPER_MINUTO; // ~1 minuto por audio
  const preco = PRECO_POR_MILHAO[linha.modelo] || PRECO_POR_MILHAO['gpt-4o-mini'];
  return ((linha.tokens_entrada || 0) * preco.entrada + (linha.tokens_saida || 0) * preco.saida) / 1_000_000;
}

const porOrigem = new Map();
const porDia = new Map();
let falhas = 0;
for (const linha of linhas) {
  const valor = custo(linha);
  const dia = linha.created_at.slice(0, 10);
  const o = porOrigem.get(linha.origem) || { chamadas: 0, entrada: 0, saida: 0, imagens: 0, usd: 0 };
  o.chamadas += 1;
  o.entrada += linha.tokens_entrada || 0;
  o.saida += linha.tokens_saida || 0;
  o.imagens += linha.imagens || 0;
  o.usd += valor;
  porOrigem.set(linha.origem, o);
  porDia.set(dia, (porDia.get(dia) || 0) + valor);
  if (!linha.ok) falhas += 1;
}

console.log(`\nOpenAI — ultimos ${dias} dias (${linhas.length} chamadas, ${falhas} com erro)\n`);
console.log('origem                     chamadas   tokens ent.  tokens sai.  imagens   US$ est.');
for (const [origem, o] of [...porOrigem.entries()].sort((a, b) => b[1].usd - a[1].usd)) {
  console.log(
    origem.padEnd(26),
    String(o.chamadas).padStart(8),
    String(o.entrada).padStart(13),
    String(o.saida).padStart(12),
    String(o.imagens).padStart(8),
    o.usd.toFixed(2).padStart(10),
  );
}
console.log('\npor dia:');
for (const [dia, valor] of [...porDia.entries()].sort()) {
  console.log(`  ${dia}  US$ ${valor.toFixed(2)}`);
}
const total = [...porOrigem.values()].reduce((soma, o) => soma + o.usd, 0);
console.log(`\ntotal estimado no periodo: US$ ${total.toFixed(2)}`);
