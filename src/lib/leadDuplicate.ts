export type LeadDuplicateInput = {
  corretor_id?: string | null;
  data_entrada?: string | null;
  nome?: string | null;
  telefone?: string | null;
  idades?: string | null;
  possui_cnpj?: string | null;
  tem_plano_ativo?: string | null;
  plano_atual?: string | null;
  custo_plano_atual?: string | null;
  investimento?: string | null;
  cidade?: string | null;
  operadora?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
};

export function normalizeLeadTextKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function normalizeLeadPhoneKey(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeLeadDateKey(value?: string | null) {
  if (!value) return '';

  const text = String(value).trim();
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s]00:00:00(?:\.0+)?$)/);
  if (dateOnly) return dateOnly[1];

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);

  // A entrada comercial acontece no horário de Brasília. Usar a data UTC
  // permitia que o mesmo lead reaparecesse no dia seguinte após uma
  // importação (por exemplo, 23h no Brasil vira 02h UTC).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : parsed.toISOString().slice(0, 10);
}

export function buildLeadIdentityKey(lead: LeadDuplicateInput) {
  const phone = normalizeLeadPhoneKey(lead.telefone);
  return [
    lead.corretor_id || '',
    normalizeLeadDateKey(lead.data_entrada),
    normalizeLeadTextKey(lead.nome),
    phone.length >= 8 ? phone.slice(-11) : phone,
  ].join('|');
}

export function buildLeadContactKey(lead: LeadDuplicateInput) {
  const phone = normalizeLeadPhoneKey(lead.telefone);
  return [
    lead.corretor_id || '',
    normalizeLeadTextKey(lead.nome),
    phone.length >= 8 ? phone.slice(-11) : phone,
  ].join('|');
}

export function buildLeadDuplicateKey(lead: LeadDuplicateInput) {
  return [
    lead.corretor_id || '',
    normalizeLeadDateKey(lead.data_entrada),
    normalizeLeadTextKey(lead.nome),
    normalizeLeadPhoneKey(lead.telefone),
    normalizeLeadTextKey(lead.idades),
    normalizeLeadTextKey(lead.possui_cnpj),
    normalizeLeadTextKey(lead.tem_plano_ativo),
    normalizeLeadTextKey(lead.plano_atual),
    normalizeLeadTextKey(lead.custo_plano_atual),
    normalizeLeadTextKey(lead.investimento),
    normalizeLeadTextKey(lead.cidade),
    normalizeLeadTextKey(lead.operadora),
    normalizeLeadTextKey(lead.utm_source),
    normalizeLeadTextKey(lead.utm_medium),
    normalizeLeadTextKey(lead.utm_campaign),
    normalizeLeadTextKey(lead.utm_term),
    normalizeLeadTextKey(lead.utm_content),
  ].join('|');
}
