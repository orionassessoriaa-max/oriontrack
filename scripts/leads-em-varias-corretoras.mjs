/**
 * Encontra o mesmo lead cadastrado em mais de uma concessionaria.
 *
 * O casamento e por telefone usando phoneMatchKey (DDD + 8 digitos finais), a
 * mesma regra do inbox: numero antigo chega sem o nono digito e comparacao de
 * string pura perderia o par.
 *
 *   node --env-file=.env.local scripts/leads-em-varias-corretoras.mjs
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { phoneMatchKey } from '../node_modules/.cache/uazapi.mjs';

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: corretores } = await s.from('corretores').select('id,nome_empresa');
const empresa = new Map((corretores || []).map((c) => [c.id, c.nome_empresa || '(sem nome)']));

// Paginacao por created_at: filtrar/ordenar por colunas largas ja derrubou o
// PostgREST por timeout nesta instancia.
const leads = [];
const PAGINA = 1000;
for (let inicio = 0; ; inicio += PAGINA) {
  // Paginacao por faixa, ordenando tambem por id: cargas em lote gravam varios
  // leads com o mesmo created_at, e cursor por data pula os empatados.
  const { data, error } = await s
    .from('leads')
    .select('id,nome,telefone,corretor_id,created_at,status')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(inicio, inicio + PAGINA - 1);
  if (error) throw error;
  if (!data?.length) break;
  leads.push(...data);
  if (data.length < PAGINA) break;
}
console.log(`leads lidos: ${leads.length}`);

const porTelefone = new Map();
let semTelefone = 0;
for (const lead of leads) {
  const chave = phoneMatchKey(lead.telefone);
  if (!chave || chave.length < 10) { semTelefone += 1; continue; }
  if (!porTelefone.has(chave)) porTelefone.set(chave, []);
  porTelefone.get(chave).push(lead);
}

const duplicados = [];
for (const [chave, itens] of porTelefone) {
  const corretoras = new Set(itens.map((l) => empresa.get(l.corretor_id) || '(sem corretora)'));
  if (corretoras.size > 1) duplicados.push({ chave, itens, corretoras: [...corretoras] });
}
duplicados.sort((a, b) => b.corretoras.length - a.corretoras.length || b.itens.length - a.itens.length);

console.log(`telefones distintos: ${porTelefone.size} | sem telefone valido: ${semTelefone}`);
console.log(`LEADS EM MAIS DE UMA CONCESSIONARIA: ${duplicados.length} telefones, ${duplicados.reduce((t, d) => t + d.itens.length, 0)} cadastros`);

const paresCount = new Map();
for (const d of duplicados) {
  const ordenadas = [...d.corretoras].sort();
  for (let i = 0; i < ordenadas.length; i += 1) {
    for (let j = i + 1; j < ordenadas.length; j += 1) {
      const par = `${ordenadas[i]} <-> ${ordenadas[j]}`;
      paresCount.set(par, (paresCount.get(par) || 0) + 1);
    }
  }
}
console.log('\npares que mais se repetem:');
for (const [par, n] of [...paresCount].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(3)}x | ${par}`);

console.log('\nprimeiros 15 casos:');
for (const d of duplicados.slice(0, 15)) {
  console.log(`\n  telefone ${d.chave} | ${d.corretoras.length} concessionarias`);
  for (const l of d.itens.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    console.log(`    ${l.created_at.slice(0, 10)} | ${(empresa.get(l.corretor_id) || '?').padEnd(30)} | ${String(l.nome || '').slice(0, 24).padEnd(24)} | ${l.status || ''}`);
  }
}

const linhas = ['telefone,data,concessionaria,nome,status,lead_id'];
for (const d of duplicados) {
  for (const l of d.itens) {
    const campo = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    linhas.push([campo(d.chave), campo(l.created_at.slice(0, 16)), campo(empresa.get(l.corretor_id)), campo(l.nome), campo(l.status), campo(l.id)].join(','));
  }
}
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/leads-em-varias-corretoras.csv', linhas.join('\n'), 'utf8');
console.log(`\nplanilha: reports/leads-em-varias-corretoras.csv (${linhas.length - 1} linhas)`);

// Recorte extra: quantas concessionarias cada uma "divide" leads, e o intervalo
// entre o primeiro e o ultimo cadastro do mesmo telefone.
const porCorretora = new Map();
let simultaneos = 0;
for (const d of duplicados) {
  const datas = d.itens.map((l) => new Date(l.created_at).getTime()).sort((a, b) => a - b);
  if (datas[datas.length - 1] - datas[0] <= 7 * 864e5) simultaneos += 1;
  for (const nome of d.corretoras) porCorretora.set(nome, (porCorretora.get(nome) || 0) + 1);
}
console.log(`\ntelefones que cairam em duas ou mais concessionarias dentro de 7 dias: ${simultaneos}`);
console.log('\nconcessionarias mais afetadas:');
for (const [nome, n] of [...porCorretora].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(3)} telefones | ${nome}`);
}
