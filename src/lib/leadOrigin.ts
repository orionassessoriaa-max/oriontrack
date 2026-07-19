export type LeadOriginInput = {
  origem?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_term?: unknown;
  utm_content?: unknown;
  campaign?: unknown;
  adset?: unknown;
  ad?: unknown;
  operadora?: unknown;
  observacoes?: unknown;
};

function clean(value: unknown) {
  return String(value ?? '').trim();
}

export function hasOrionMarker(...values: unknown[]) {
  return values.some((value) => /\[\s*orion\s*\]/i.test(clean(value)));
}

export function resolveLeadOrigin(input: LeadOriginInput, fallback = '') {
  const values = [
    input.origem,
    input.utm_source,
    input.utm_medium,
    input.utm_campaign,
    input.utm_term,
    input.utm_content,
    input.campaign,
    input.adset,
    input.ad,
    input.operadora,
    input.observacoes,
  ];

  if (hasOrionMarker(...values)) return 'Orion';

  const explicitOrigin = clean(input.origem || input.utm_source);
  if (explicitOrigin) return explicitOrigin;

  return clean(fallback);
}

export function isOrionLead(input: LeadOriginInput) {
  return resolveLeadOrigin(input).toLowerCase() === 'orion';
}

export function isMissingLeadOriginColumn(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('origem') && message.includes('column');
}
