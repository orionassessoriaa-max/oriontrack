export function normalizeCommercialNumber(input: unknown) {
  const source = String(input ?? '').trim().toLowerCase();
  if (!source) return 0;
  const multiplier = /(?:\bmil\b|\bk\b)/i.test(source) ? 1000 : 1;
  let numeric = source.replace(/[^0-9.,-]/g, '');
  if (!numeric) return 0;

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
  return Number.isFinite(parsed) ? parsed * multiplier : 0;
}

export function isCommercialMql(faturamento: unknown, investimento: unknown) {
  return normalizeCommercialNumber(faturamento) > 20_000
    && normalizeCommercialNumber(investimento) >= 1_500;
}

