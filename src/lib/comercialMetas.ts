/**
 * Metas do mes comercial, resolvidas num lugar so.
 *
 * A Overview Vendas era a unica tela comercial que ignorava comercial_metas e
 * usava numero fixo no codigo. Resultado: o coordenador mudava a meta na tela e
 * a TV da sala obedecia, enquanto a Overview continuava mostrando 185.000.
 *
 * Aqui ficam apenas as tres metas que o coordenador edita. As outras duas da
 * Overview (100 ligacoes por SDR e teto de 20% de no-show) seguem fixas na
 * rota de proposito: sao combinado de time, nao numero de planejamento mensal.
 */

/** Piso usado enquanto o coordenador nao definir o mes. */
export const META_RECEITA_PADRAO = 185_000;
export const META_VENDAS_PADRAO = 25;
export const META_CONVERSAO_PADRAO = 40;

/** numeric do Postgres chega como string em parte dos drivers. */
export type LinhaComercialMetas = {
  meta_valor?: number | string | null;
  meta_vendas?: number | string | null;
  meta_conversao?: number | string | null;
} | null | undefined;

export type MetasDoMes = {
  receita: number;
  vendas: number;
  conversao: number;
};

/**
 * O teste e "> 0", nunca "??".
 *
 * As colunas sao not null default 0 e o POST antigo gravava zero de verdade em
 * meta_vendas, meta_calls e ticket_medio toda vez que alguem salvava so a
 * receita. Hoje os tres meses gravados estao zerados por causa disso. Com "??"
 * esse zero passaria como meta legitima e o telao mostraria meta de 0 vendas,
 * 0% de progresso e a barra de conversao sempre verde.
 *
 * O preco: zero deixa de ser uma meta gravavel. Nao existe meta de 0 vendas.
 */
function efetivo(valor: number | string | null | undefined, padrao: number) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

/** Resolve campo a campo, nao linha a linha: a linha pode existir com so um preenchido. */
export function resolverMetasDoMes(linha: LinhaComercialMetas): MetasDoMes {
  return {
    receita: efetivo(linha?.meta_valor, META_RECEITA_PADRAO),
    vendas: efetivo(linha?.meta_vendas, META_VENDAS_PADRAO),
    conversao: efetivo(linha?.meta_conversao, META_CONVERSAO_PADRAO),
  };
}

/**
 * Primeiro dia do mes em Brasilia, no formato que a coluna `mes` usa.
 *
 * A rota de metas usava new Date().toISOString(), que e UTC: no ultimo dia do
 * mes depois das 21h locais ela escrevia na linha do mes seguinte enquanto a
 * Overview lia a do mes corrente.
 */
export function mesComercialAtual() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const ano = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  return `${ano}-${mes}-01`;
}

/**
 * Normaliza o `mes` que chega no corpo do POST.
 *
 * Aceita AAAA-MM e tambem AAAA-MM-DD: a tela de Inteligencia manda
 * `{ mes: month, ...goal }` e o goal espalhado carrega o `mes` completo vindo
 * do banco, que sobrescreve o escolhido. Com a regex antiga isso falhava em
 * silencio e a edicao de um mes passado ia parar no mes corrente.
 */
export function normalizarMesComercial(valor?: string | null) {
  const texto = String(valor || '').trim();
  return /^\d{4}-\d{2}(-\d{2})?$/.test(texto) ? `${texto.slice(0, 7)}-01` : mesComercialAtual();
}
