export function normalizeLeadStatusMetric(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isTeamLeadWithoutResponse(status?: string | null) {
  const normalized = normalizeLeadStatusMetric(status);
  return ['retorno', 'resposta', 'aguardando', 'contato feito']
    .some((marker) => normalized.includes(marker));
}
