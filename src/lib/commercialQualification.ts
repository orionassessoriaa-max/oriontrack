export type CommercialMqlLevel = 'S' | 'A' | 'B' | 'C' | 'FMQL';

function parseCommercialToken(token: string) {
  let numeric = token.trim();
  if (numeric.includes('.') && numeric.includes(',')) {
    numeric = numeric.lastIndexOf(',') > numeric.lastIndexOf('.')
      ? numeric.replace(/\./g, '').replace(',', '.')
      : numeric.replace(/,/g, '');
  } else if (numeric.includes(',')) {
    numeric = numeric.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(numeric)) {
    numeric = numeric.replace(/\./g, '');
  }
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCommercialNumber(input: unknown) {
  const source = String(input ?? '').trim().toLowerCase();
  if (!source) return 0;
  const tokens = source.match(/-?\d+(?:[.,]\d+)*/g) || [];
  if (!tokens.length) return 0;
  const multiplier = /(?:\bmil\b|\bk\b)/i.test(source) ? 1000 : 1;
  return Math.max(...tokens.map((token) => parseCommercialToken(token) * multiplier));
}

export function hasCommercialInvestment(input: unknown) {
  const source = String(input ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!source || /^(?:0|r\$\s*0(?:[,.]00)?)$/.test(source)) return false;
  if (/\b(?:sem|nenhum|nenhuma|nao|nunca)\b/.test(source)) return false;
  return normalizeCommercialNumber(source) > 0 || source.length > 0;
}

function normalizeCommercialLabel(input: unknown) {
  return String(input ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function commercialRevenueFloor(input: unknown) {
  const source = normalizeCommercialLabel(input);
  if (!source || /\b(?:nao informado|sem informacao)\b/.test(source)) return 0;
  if (/\b(?:abaixo|menos)\s+de\b/.test(source)) return 0;

  const values = Array.from(source.matchAll(/(-?\d+(?:[.,]\d+)*)\s*(milhao|milhoes|mil|k)?/g))
    .map((match) => {
      const value = parseCommercialToken(match[1]);
      const unit = match[2] || '';
      if (unit.startsWith('milhao') || unit.startsWith('milhoe')) return value * 1_000_000;
      if (unit === 'mil' || unit === 'k') return value * 1_000;
      return value;
    })
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  if (values.length === 1 && /\bate\b/.test(source)) return 0;
  return Math.min(...values);
}

export function isCommercialHighPriority(input: unknown) {
  const source = normalizeCommercialLabel(input);
  return source.includes('alta') && source.includes('quero crescer agora');
}

export function getCommercialMqlLevel(
  faturamento: unknown,
  investimento: unknown,
  prioridade?: unknown,
): CommercialMqlLevel {
  const revenueFloor = commercialRevenueFloor(faturamento);
  const hasInvestment = hasCommercialInvestment(investimento);

  // Ordem aprovada: S -> A -> B -> C -> Fora do MQL.
  if (revenueFloor >= 30_000 && hasInvestment && isCommercialHighPriority(prioridade)) return 'S';
  if (revenueFloor >= 20_000 && hasInvestment) return 'A';
  if (revenueFloor >= 20_000) return 'B';
  if (revenueFloor >= 10_000 || hasInvestment) return 'C';
  return 'FMQL';
}

export function commercialCadenceMaxDay(faturamento: unknown, investimento: unknown, prioridade?: unknown) {
  return getCommercialMqlLevel(faturamento, investimento, prioridade) === 'FMQL' ? 2 : 10;
}

export function isCommercialMql(faturamento: unknown, investimento?: unknown, prioridade?: unknown) {
  return getCommercialMqlLevel(faturamento, investimento, prioridade) !== 'FMQL';
}
