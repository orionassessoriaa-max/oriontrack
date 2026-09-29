export type UnityLabel = {
  id: string;
  name: string;
  color: string;
  active: boolean;
};

export const UNITY_DEFAULT_LABELS: UnityLabel[] = [
  { id: 'adesao', name: 'Adesão', color: '#2563eb', active: true },
  { id: 'aguardando-analise', name: 'Aguardando Análise', color: '#f59e0b', active: true },
  { id: 'aguardando-vigencia', name: 'Aguardando Vigência', color: '#22c55e', active: true },
  { id: 'atendimento-finalizado', name: 'Atendimento Finalizado', color: '#c026d3', active: true },
  { id: 'beneficiario-ativo', name: 'Beneficiário Ativo', color: '#7c3aed', active: true },
  { id: 'cancelado', name: 'Cancelado', color: '#db2777', active: true },
  { id: 'coletando-dados', name: 'Coletando Dados', color: '#4ade80', active: true },
  { id: 'declinado-acima-64', name: 'Declinado Acima de 64 anos', color: '#ef4444', active: true },
  { id: 'declinado-menor-6', name: 'Declinado Menor de 6 anos', color: '#f97316', active: true },
  { id: 'declinado-dlp', name: 'Declinado DLP', color: '#dc2626', active: true },
  { id: 'declinado-gestante', name: 'Declinado Gestante', color: '#fb7185', active: true },
  { id: 'envio-documentacao', name: 'Envio de Documentação', color: '#eab308', active: true },
  { id: 'evidencias', name: 'Evidências', color: '#fbbf24', active: true },
  { id: 'follow-up', name: 'Follow Up', color: '#c4a7bb', active: true },
  { id: 'indicacao', name: 'Indicação', color: '#d4e157', active: true },
  { id: 'lead-desqualificado', name: 'Lead Desqualificado', color: '#16a34a', active: true },
  { id: 'lead-novo', name: 'Lead Novo', color: '#0ea5e9', active: true },
  { id: 'negociacao', name: 'Negociação', color: '#e879f9', active: true },
  { id: 'outros-municipios', name: 'Outros Municípios', color: '#15803d', active: true },
  { id: 'pme', name: 'PME', color: '#94a3b8', active: true },
  { id: 'sindservicos', name: 'Sindserviços', color: '#7e2252', active: true },
];

function normalizeLabelName(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

export function sanitizeUnityLabels(value: unknown): UnityLabel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 60).flatMap((item: unknown) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const name = String(record.name || '').trim().slice(0, 50);
    const normalized = normalizeLabelName(name);
    if (!name || seen.has(normalized)) return [];
    seen.add(normalized);
    const color = /^#[0-9a-f]{6}$/i.test(String(record.color || '')) ? String(record.color) : '#06b6d4';
    return [{
      id: String(record.id || crypto.randomUUID()),
      name,
      color,
      active: record.active !== false,
    }];
  });
}

export function mergeUnityDefaultLabels(value: unknown): UnityLabel[] {
  const stored = sanitizeUnityLabels(value);
  const storedNames = new Set(stored.map((label) => normalizeLabelName(label.name)));
  return [
    ...stored,
    ...UNITY_DEFAULT_LABELS.filter((label) => !storedNames.has(normalizeLabelName(label.name))),
  ];
}
