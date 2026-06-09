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

function normalizeTextKey(value?: string | null) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhoneKey(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeDateKey(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export function buildLeadDuplicateKey(lead: LeadDuplicateInput) {
  return [
    lead.corretor_id || '',
    normalizeDateKey(lead.data_entrada),
    normalizeTextKey(lead.nome),
    normalizePhoneKey(lead.telefone),
    normalizeTextKey(lead.idades),
    normalizeTextKey(lead.possui_cnpj),
    normalizeTextKey(lead.tem_plano_ativo),
    normalizeTextKey(lead.plano_atual),
    normalizeTextKey(lead.custo_plano_atual),
    normalizeTextKey(lead.investimento),
    normalizeTextKey(lead.cidade),
    normalizeTextKey(lead.operadora),
    normalizeTextKey(lead.utm_source),
    normalizeTextKey(lead.utm_medium),
    normalizeTextKey(lead.utm_campaign),
    normalizeTextKey(lead.utm_term),
    normalizeTextKey(lead.utm_content),
  ].join('|');
}
