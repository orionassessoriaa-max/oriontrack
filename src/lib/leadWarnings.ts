import { Lead } from '@/types';

export const IMPORT_WARNING_PREFIX = '[AVISO IMPORTACAO]';

export function buildLeadImportWarningNote(warnings: string[]) {
  const cleanWarnings = Array.from(new Set(warnings.map((warning) => warning.trim()).filter(Boolean)));
  if (cleanWarnings.length === 0) return '';
  return `${IMPORT_WARNING_PREFIX} ${cleanWarnings.join('; ')}`;
}

export function getLeadImportWarnings(lead: Pick<Lead, 'nome' | 'telefone' | 'observacoes'>) {
  const warnings = new Set<string>();
  const notes = String(lead.observacoes || '');
  const markerIndex = notes.indexOf(IMPORT_WARNING_PREFIX);

  if (markerIndex >= 0) {
    const afterMarker = notes.slice(markerIndex + IMPORT_WARNING_PREFIX.length);
    const firstSection = afterMarker.split('|')[0] || '';
    firstSection
      .split(';')
      .map((warning) => warning.trim())
      .filter(Boolean)
      .forEach((warning) => warnings.add(warning));
  }

  if (!String(lead.nome || '').trim() || String(lead.nome || '').trim().toLowerCase() === 'lead sem nome') {
    warnings.add('Nome ausente na planilha');
  }

  const phone = String(lead.telefone || '').trim().toLowerCase();
  if (!phone || phone === 'telefone nao informado' || phone === 'telefone não informado' || phone === 'sem telefone') {
    warnings.add('Telefone ausente na planilha');
  }

  return Array.from(warnings);
}

export function cleanLeadObservationText(value?: string | null) {
  return String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(IMPORT_WARNING_PREFIX))
    .join(' | ');
}
