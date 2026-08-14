import { supabaseAdmin } from '@/lib/supabase/admin';

export const LEAD_SOURCE_TYPES = [
  'meta_ad_account',
  'meta_page',
  'meta_form',
  'n8n_workflow',
  'spreadsheet',
  'custom',
] as const;

export type LeadSourceType = typeof LEAD_SOURCE_TYPES[number];

export type LeadRoutingSource = {
  type: LeadSourceType;
  id: string;
};

export type LeadRoutingResult = {
  status: 'routed' | 'legacy' | 'unmapped' | 'conflict' | 'missing';
  corretorId: string | null;
  corretoraId: string | null;
  source: LeadRoutingSource | null;
  sources: LeadRoutingSource[];
  legacyCorretorId: string | null;
  reason?: string;
  routingAvailable: boolean;
};

type PayloadReader = (aliases: string[]) => unknown;

const sourceAliases: Array<{ type: LeadSourceType; aliases: string[] }> = [
  {
    type: 'meta_form',
    aliases: ['meta_form_id', 'leadgen_form_id', 'form_id', 'facebook_form_id'],
  },
  {
    type: 'meta_page',
    aliases: ['meta_page_id', 'facebook_page_id', 'page_id'],
  },
  {
    type: 'meta_ad_account',
    aliases: ['meta_ad_account_id', 'ad_account_id', 'facebook_ad_account_id', 'act_id'],
  },
  {
    type: 'n8n_workflow',
    aliases: ['n8n_workflow_id', 'workflow_id'],
  },
  {
    type: 'spreadsheet',
    aliases: ['spreadsheet_id', 'google_sheet_id', 'sheet_document_id'],
  },
];

function text(value: unknown) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function normalizeLeadSourceId(type: LeadSourceType, value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  if (type === 'meta_ad_account') return raw.replace(/^act_/i, '');
  return raw;
}

function isLeadSourceType(value: string): value is LeadSourceType {
  return (LEAD_SOURCE_TYPES as readonly string[]).includes(value);
}

export function extractLeadRoutingSources(read: PayloadReader) {
  const sources: LeadRoutingSource[] = [];
  const explicitType = text(read(['source_type', 'tipo_origem']));
  const explicitId = text(read(['source_id', 'id_origem']));

  if (explicitId && isLeadSourceType(explicitType)) {
    sources.push({ type: explicitType, id: normalizeLeadSourceId(explicitType, explicitId) });
  }

  for (const definition of sourceAliases) {
    const id = normalizeLeadSourceId(definition.type, read(definition.aliases));
    if (id) sources.push({ type: definition.type, id });
  }

  return Array.from(new Map(
    sources
      .filter((source) => source.id)
      .map((source) => [`${source.type}:${source.id}`, source]),
  ).values());
}

export function isMissingLeadRoutingTable(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | null)?.message || error || '');
  return /lead_source_routes|lead_routing_quarantine|schema cache|does not exist|could not find/i.test(message);
}

async function primaryBrokerForCorretora(corretoraId: string) {
  const { data: corretora, error: corretoraError } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .eq('id', corretoraId)
    .maybeSingle();

  if (corretoraError) throw corretoraError;
  if (!corretora?.nome) return null;

  const { data: broker, error: brokerError } = await supabaseAdmin
    .from('corretores')
    .select('id')
    .ilike('nome_empresa', corretora.nome)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (brokerError) throw brokerError;
  return broker?.id || null;
}

export async function resolveLeadRouting(
  sources: LeadRoutingSource[],
  legacyCorretorId: string | null,
): Promise<LeadRoutingResult> {
  if (sources.length === 0) {
    return {
      status: legacyCorretorId ? 'legacy' : 'missing',
      corretorId: legacyCorretorId,
      corretoraId: null,
      source: null,
      sources,
      legacyCorretorId,
      routingAvailable: true,
    };
  }

  const matches: Array<{ source: LeadRoutingSource; corretora_id: string }> = [];

  try {
    for (const source of sources) {
      const { data, error } = await supabaseAdmin
        .from('lead_source_routes')
        .select('corretora_id')
        .eq('source_type', source.type)
        .eq('source_id', source.id)
        .eq('active', true)
        .maybeSingle();

      if (error) throw error;
      if (data?.corretora_id) matches.push({ source, corretora_id: data.corretora_id });
    }
  } catch (error) {
    if (!isMissingLeadRoutingTable(error)) throw error;
    return {
      status: legacyCorretorId ? 'legacy' : 'missing',
      corretorId: legacyCorretorId,
      corretoraId: null,
      source: null,
      sources,
      legacyCorretorId,
      routingAvailable: false,
      reason: 'Migration de roteamento ainda nao aplicada.',
    };
  }

  if (matches.length === 0) {
    return {
      status: 'unmapped',
      corretorId: legacyCorretorId,
      corretoraId: null,
      source: sources[0] || null,
      sources,
      legacyCorretorId,
      routingAvailable: true,
      reason: 'Origem ainda nao cadastrada no roteamento central.',
    };
  }

  const corretoraIds = Array.from(new Set(matches.map((match) => match.corretora_id)));
  if (corretoraIds.length > 1) {
    return {
      status: 'conflict',
      corretorId: null,
      corretoraId: null,
      source: matches[0].source,
      sources,
      legacyCorretorId,
      routingAvailable: true,
      reason: 'Os identificadores da origem apontam para concessionarias diferentes.',
    };
  }

  const corretoraId = corretoraIds[0];
  const routedCorretorId = await primaryBrokerForCorretora(corretoraId);
  if (!routedCorretorId) {
    return {
      status: 'conflict',
      corretorId: null,
      corretoraId,
      source: matches[0].source,
      sources,
      legacyCorretorId,
      routingAvailable: true,
      reason: 'A concessionaria da origem nao possui conta interna para receber leads.',
    };
  }

  if (legacyCorretorId && legacyCorretorId !== routedCorretorId) {
    return {
      status: 'conflict',
      corretorId: routedCorretorId,
      corretoraId,
      source: matches[0].source,
      sources,
      legacyCorretorId,
      routingAvailable: true,
      reason: 'O ID legado enviado pelo n8n nao pertence a concessionaria identificada pela origem.',
    };
  }

  return {
    status: 'routed',
    corretorId: routedCorretorId,
    corretoraId,
    source: matches[0].source,
    sources,
    legacyCorretorId,
    routingAvailable: true,
  };
}

function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[limite de profundidade]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactPayload(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (/secret|token|authorization|password|senha|api[_-]?key/i.test(key)) {
      output[key] = '[redigido]';
    } else {
      output[key] = redactPayload(nested, depth + 1);
    }
  }
  return output;
}

export async function quarantineLeadRouting(input: {
  reason: string;
  source?: LeadRoutingSource | null;
  suppliedCorretorId?: string | null;
  resolvedCorretoraId?: string | null;
  resolvedCorretorId?: string | null;
  payload: unknown;
}) {
  try {
    const sanitized = redactPayload(input.payload);
    const serialized = JSON.stringify(sanitized);
    const payload = serialized.length <= 64_000
      ? sanitized
      : { truncated: true, preview: serialized.slice(0, 64_000) };

    const { data, error } = await supabaseAdmin
      .from('lead_routing_quarantine')
      .insert({
        reason: input.reason,
        source_type: input.source?.type || null,
        source_id: input.source?.id || null,
        supplied_corretor_id: input.suppliedCorretorId || null,
        resolved_corretora_id: input.resolvedCorretoraId || null,
        resolved_corretor_id: input.resolvedCorretorId || null,
        payload,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id || null;
  } catch (error) {
    if (!isMissingLeadRoutingTable(error)) {
      console.error('[N8N lead routing] Falha ao registrar quarentena:', error);
    }
    return null;
  }
}

export function strictLeadRoutingEnabled() {
  return String(process.env.ORION_N8N_STRICT_ROUTING || '').trim().toLowerCase() === 'true';
}
