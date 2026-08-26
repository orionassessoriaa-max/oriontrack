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

export function isTeamLeadSale(status?: string | null) {
  return normalizeLeadStatusMetric(status).includes('venda');
}

export function isTeamLeadLost(status?: string | null) {
  const normalized = normalizeLeadStatusMetric(status);
  return ['sem interesse', 'nao tive retorno', 'telefone nao existe']
    .some((marker) => normalized.includes(marker));
}

export function isTeamLeadStalled(
  lead: { status?: string | null; updated_at?: string | null; data_entrada?: string | null },
  now = Date.now(),
) {
  if (isTeamLeadSale(lead.status) || isTeamLeadLost(lead.status)) return false;

  const lastMovement = lead.updated_at || lead.data_entrada;
  if (!lastMovement) return false;

  const lastMovementTime = new Date(lastMovement).getTime();
  return Number.isFinite(lastMovementTime) && now - lastMovementTime >= 24 * 60 * 60 * 1000;
}
