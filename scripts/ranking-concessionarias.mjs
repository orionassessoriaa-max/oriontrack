/**
 * Ranking de captacao por concessionaria.
 *
 * Usa data_entrada, que e a data em que o lead entrou na planilha de origem.
 * created_at e o carimbo da importacao: a Vida Protegida tem 2.716 leads com
 * created_at no mesmo minuto, o que distorce qualquer leitura por periodo.
 *
 *   node --env-file=.env.local scripts/ranking-concessionarias.mjs
 */
import { createClient } from '@supabase/supabase-js';

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: corretores } = await s.from('corretores').select('id,nome_empresa');
const empresa = new Map((corretores || []).map((c) => [c.id, c.nome_empresa || '(sem nome)']));

const leads = [];
for (let i = 0; ; i += 1000) {
  const { data, error } = await s
    .from('leads')
    .select('id,corretor_id,data_entrada,created_at')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(i, i + 999);
  if (error) throw error;
  if (!data?.length) break;
  leads.push(...data);
  if (data.length < 1000) break;
}

const agora = Date.now();
const quando = (l) => new Date(l.data_entrada || l.created_at).getTime();
const tabela = new Map();
let semData = 0;
for (const l of leads) {
  if (!l.data_entrada) semData += 1;
  const nome = empresa.get(l.corretor_id) || '(sem concessionaria)';
  if (!tabela.has(nome)) tabela.set(nome, { total: 0, d90: 0, d30: 0, d7: 0, primeiro: Infinity, ultimo: 0 });
  const r = tabela.get(nome);
  const t = quando(l);
  r.total += 1;
  if (agora - t <= 90 * 864e5) r.d90 += 1;
  if (agora - t <= 30 * 864e5) r.d30 += 1;
  if (agora - t <= 7 * 864e5) r.d7 += 1;
  if (t < r.primeiro) r.primeiro = t;
  if (t > r.ultimo) r.ultimo = t;
}

const dia = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`leads: ${leads.length} | sem data_entrada (usando created_at): ${semData}`);
console.log('\n#   TOTAL   90d   30d    7d | concessionaria                  | 1o lead     ultimo');
[...tabela].sort((a, b) => b[1].total - a[1].total).slice(0, 15).forEach(([nome, r], i) => {
  console.log(`${String(i + 1).padStart(2)}  ${String(r.total).padStart(5)}  ${String(r.d90).padStart(4)}  ${String(r.d30).padStart(4)}  ${String(r.d7).padStart(4)} | ${nome.slice(0, 30).padEnd(30)} | ${dia(r.primeiro)}  ${dia(r.ultimo)}`);
});

for (const [rotulo, chave] of [['90 DIAS', 'd90'], ['30 DIAS', 'd30'], ['7 DIAS', 'd7']]) {
  console.log(`\n=== ${rotulo} ===`);
  [...tabela].sort((a, b) => b[1][chave] - a[1][chave]).slice(0, 6)
    .forEach(([nome, r], i) => console.log(`  ${i + 1}. ${String(r[chave]).padStart(4)} | ${nome}`));
}
