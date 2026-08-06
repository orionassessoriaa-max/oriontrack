export type CommercialMqlLevel = 'S' | 'A' | 'B' | 'C';

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

export function getCommercialMqlLevel(faturamento: unknown, investimento: unknown): CommercialMqlLevel {
  const revenueLabel = String(faturamento ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!revenueLabel.trim() || /\b(?:nao informado|sem informacao)\b/.test(revenueLabel)) return 'C';
  if (/(?:acima|mais)\s+de\s+(?:r\$\s*)?20(?:[\s.]?mil|k)?/.test(revenueLabel)) return 'S';
  if (/abaixo\s+de\s+(?:r\$\s*)?10(?:[\s.]?mil|k)?/.test(revenueLabel)) {
    return hasCommercialInvestment(investimento) ? 'B' : 'C';
  }
  const revenue = normalizeCommercialNumber(faturamento);
  if (revenue > 20_000) return 'S';
  if (revenue >= 10_000) return 'A';
  return hasCommercialInvestment(investimento) ? 'B' : 'C';
}

export function isCommercialMql(faturamento: unknown, investimento: unknown) {
  return getCommercialMqlLevel(faturamento, investimento) !== 'C';
}
