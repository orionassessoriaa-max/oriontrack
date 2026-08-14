import type { CommercialMqlLevel } from '@/lib/commercialQualification';

export const COMMERCIAL_CADENCE_DAYS = 10;

export const COMMERCIAL_CADENCE_POINTS = [
  { point: 1, channel: 'ligacao_fixo', label: 'Ligação 1 (fixo)' },
  { point: 2, channel: 'ligacao_fixo', label: 'Ligação 2 (fixo)' },
  { point: 3, channel: 'ligacao_fixo', label: 'Ligação 3 (fixo)' },
  { point: 4, channel: 'ligacao_whatsapp', label: 'Ligação (WhatsApp)' },
  { point: 5, channel: 'mensagem_whatsapp', label: 'Mensagem (WhatsApp)' },
  { point: 6, channel: 'audio_whatsapp', label: 'Áudio (WhatsApp)' },
  { point: 7, channel: 'ligacao_fixo', label: 'Ligação 4 (fixo)' },
  { point: 8, channel: 'mensagem_whatsapp', label: 'Mensagem 2 (WhatsApp)' },
] as const;

export type CommercialCadencePointStatus =
  | 'pendente'
  | 'nao_atendeu'
  | 'sem_resposta'
  | 'atendeu'
  | 'respondeu'
  | 'nao_necessario';

export function cadenceDay(startValue: string | null | undefined, now = new Date()) {
  if (!startValue) return 1;
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return 1;
  return Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1);
}

export function cadenceResultIsResponse(status: CommercialCadencePointStatus) {
  return status === 'atendeu' || status === 'respondeu';
}

export function cadencePointLabel(point: number) {
  return COMMERCIAL_CADENCE_POINTS.find((item) => item.point === point)?.label || `Ponto ${point}`;
}

export function mqlReserveStage(level: CommercialMqlLevel) {
  return `MQL ${level}`;
}

export function statusStartsCadence(value: unknown) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return normalized.includes('1º dia') || normalized.includes('1o dia') || normalized.includes('primeiro dia') || normalized.includes('tentando contato');
}

export function statusResolvesReturn(value: unknown) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, ' ').toLowerCase();
  return normalized.includes('reunio') && normalized.includes('agend')
    || normalized.includes('perdido')
    || normalized.includes('negocio fechado')
    || normalized.startsWith('mql ');
}
