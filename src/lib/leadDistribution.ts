export type LeadDistributionModel = 'rodizio' | 'fila_compartilhada';
export type LeadDistributionAudience = 'todos' | 'admins' | 'integrantes' | 'personalizado';

export const leadDistributionModelLabels: Record<LeadDistributionModel, string> = {
  rodizio: 'Rodizio automatico',
  fila_compartilhada: 'Fila compartilhada - primeiro atendimento',
};

export const leadDistributionAudienceLabels: Record<LeadDistributionAudience, string> = {
  todos: 'Todos recebem',
  admins: 'Somente administradores',
  integrantes: 'Somente integrantes',
  personalizado: 'Personalizado',
};

export function normalizeLeadDistributionModel(value: unknown): LeadDistributionModel {
  return value === 'fila_compartilhada' ? 'fila_compartilhada' : 'rodizio';
}

export function normalizeLeadDistributionAudience(value: unknown): LeadDistributionAudience {
  return value === 'admins' || value === 'integrantes' || value === 'personalizado' ? value : 'todos';
}

export function audienceIncludesRole(audience: LeadDistributionAudience, role: string) {
  if (audience === 'todos') return true;
  if (audience === 'admins') return role === 'corretor' || role === 'corretor_admin';
  if (audience === 'integrantes') return role === 'corretor_membro';
  return false;
}
