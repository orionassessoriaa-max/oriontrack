import { NextResponse } from 'next/server';
import { COMMERCIAL_STATUSES } from '@/lib/comercial';
import { rateLimit, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startCommercialBotIfEligible } from '@/lib/commercialBot';

type CommercialLeadPayload = Record<string, unknown>;

function normalizeText(value: unknown, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }
  return String(value).trim();
}

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function collectPayloadEntries(input: unknown, entries: Array<[string, unknown]> = [], prefix = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return entries;

  Object.entries(input).forEach(([key, value]) => {
    const path = prefix ? `${prefix}_${key}` : key;
    entries.push([key, value]);
    entries.push([path, value]);

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectPayloadEntries(value, entries, path);
    }
  });

  return entries;
}

function flattenPayload(input: unknown) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const respondent = source.respondent && typeof source.respondent === 'object' && !Array.isArray(source.respondent)
    ? source.respondent as Record<string, unknown>
    : null;
  const nested = [
    source.body,
    source.data,
    source.lead,
    source.cliente,
    source.customer,
    source.contato,
    source.contact,
    source.form,
    source.payload,
    source.json,
    respondent?.answers,
    source.answers,
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[];

  return Object.assign({}, source, ...nested);
}

function field(body: CommercialLeadPayload, aliases: string[]) {
  const normalized = new Map<string, unknown>();
  collectPayloadEntries(body).forEach(([key, value]) => {
    normalized.set(normalizeKey(key), value);
  });

  for (const alias of aliases) {
    const direct = body[alias];
    if (direct !== undefined && direct !== null && normalizeText(direct)) return direct;
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined && value !== null && normalizeText(value)) return value;
  }

  return '';
}

function trackingField(body: CommercialLeadPayload, key: string, aliases: string[]) {
  const names = [key, ...aliases];
  const direct = field(body, names);
  if (normalizeText(direct)) return normalizeText(direct);

  for (const containerName of ['utm', 'utms', 'tracking', 'tracking_params', 'respondent_utms', 'respondentUtms']) {
    const container = body[containerName];
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      const nested = field(container as CommercialLeadPayload, names);
      if (normalizeText(nested)) return normalizeText(nested);
    }
  }

  return null;
}

async function readPayload(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text());
    return Object.fromEntries(params.entries());
  }
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }
  return request.json();
}

function normalizePhone(value: unknown) {
  return normalizeText(value).replace(/\D/g, '');
}

function parseCurrencyValue(value: unknown) {
  const raw = normalizeText(value);
  if (!raw || raw === '-') return 0;
  const numeric = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeText(value));
}

function normalizeCommercialStatus(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return 'Oportunidade';
  const found = COMMERCIAL_STATUSES.find((status) => normalizeKey(status) === normalizeKey(raw));
  return found || 'Oportunidade';
}

function buildNotes(body: CommercialLeadPayload) {
  const ignored = new Set([
    'nome', 'name', 'lead_nome', 'cliente', 'nome_completo',
    'telefone', 'phone', 'whatsapp', 'celular', 'fone',
    'email', 'e_mail', 'mail',
    'empresa', 'company',
    'origem', 'source', 'utm_source',
    'campanha', 'campaign', 'utm_campaign',
    'status', 'etapa',
    'valor_negociacao', 'valor', 'receita',
  ].map(normalizeKey));

  const lines: string[] = [];
  collectPayloadEntries(body).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    const text = normalizeText(value);
    if (!text || ignored.has(normalized) || typeof value === 'object') return;
    const label = String(key).replace(/[_-]+/g, ' ').trim();
    if (!lines.some((line) => line.toLowerCase().startsWith(`${label.toLowerCase()}:`))) {
      lines.push(`${label}: ${text}`);
    }
  });

  return lines.slice(0, 40).join(' | ') || null;
}

async function resolveDefaultCommercialMember(role: 'sdr' | 'closer') {
  const { data } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id')
    .eq('papel', role)
    .eq('ativo', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.profile_id || null;
}

async function findExistingCommercialLead(telefone: string | null, email: string | null) {
  if (!telefone && !email) return null;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from('comercial_leads')
    .select('*')
    .gte('data_entrada', since)
    .order('data_entrada', { ascending: false })
    .limit(1000);

  const phoneDigits = normalizePhone(telefone);
  const emailKey = normalizeText(email).toLowerCase();
  return (data || []).find((lead) => {
    const samePhone = phoneDigits && normalizePhone(lead.telefone).endsWith(phoneDigits.slice(-10));
    const sameEmail = emailKey && normalizeText(lead.email).toLowerCase() === emailKey;
    return samePhone || sameEmail;
  }) || null;
}

async function sendLeadToSheet(lead: Record<string, unknown>, rawPayload: CommercialLeadPayload) {
  const sheetWebhookUrl = process.env.COMMERCIAL_LEADS_SHEET_WEBHOOK_URL;
  if (!sheetWebhookUrl) return { configured: false, ok: false };

  try {
    const response = await fetch(sheetWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.COMMERCIAL_LEADS_SHEET_SECRET ? { 'x-orion-secret': process.env.COMMERCIAL_LEADS_SHEET_SECRET } : {}),
      },
      body: JSON.stringify({
        lead,
        raw: rawPayload,
        secret: process.env.COMMERCIAL_LEADS_SHEET_SECRET || undefined,
        received_at: new Date().toISOString(),
      }),
    });

    return { configured: true, ok: response.ok, status: response.status };
  } catch (error) {
    console.error('commercial_sheet_sync_failed', error);
    return { configured: true, ok: false };
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'webhook:comercial:leads', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const secret = process.env.ORION_COMERCIAL_WEBHOOK_SECRET || process.env.ORION_N8N_WEBHOOK_SECRET;
    if (secret) {
      const headerSecret = request.headers.get('x-orion-secret');
      const bearerSecret = request.headers.get('Authorization')?.replace('Bearer ', '');
      if (headerSecret !== secret && bearerSecret !== secret) {
        return NextResponse.json({ error: 'Webhook comercial nao autorizado.' }, { status: 401 });
      }
    }

    const rawPayload = flattenPayload(await readPayload(request));
    const nome = normalizeText(field(rawPayload, ['nome', 'name', 'lead_nome', 'cliente', 'nome completo']));
    const telefone = normalizeText(field(rawPayload, ['telefone', 'phone', 'whatsapp', 'celular', 'fone'])) || null;
    const email = normalizeText(field(rawPayload, ['email', 'e-mail', 'mail'])) || null;

    if (!nome || (!telefone && !email)) {
      return NextResponse.json({ error: 'Nome e telefone ou email sao obrigatorios.' }, { status: 400 });
    }

    const notes = buildNotes(rawPayload);
    const status = normalizeCommercialStatus(field(rawPayload, ['status', 'etapa', 'pipeline']));
    const dataEntrada = parseDate(field(rawPayload, ['data_entrada', 'data entrada', 'data', 'created_time', 'timestamp'])) || new Date().toISOString();
    const explicitSdrId = normalizeText(field(rawPayload, ['sdr_id', 'sdr']));
    const explicitCloserId = normalizeText(field(rawPayload, ['closer_id', 'closer']));
    const sdrId = isUuid(explicitSdrId) ? explicitSdrId : await resolveDefaultCommercialMember('sdr');
    const closerId = isUuid(explicitCloserId) ? explicitCloserId : await resolveDefaultCommercialMember('closer');
    const jaInvestiuTrafego = normalizeText(field(rawPayload, ['ja_investiu_trafego', 'ja investiu em trafego', 'traffic', 'tráfego'])) || null;
    const faturamentoMensal = normalizeText(field(rawPayload, ['faturamento_mensal', 'faturamento mensal', 'revenue', 'faturamento'])) || null;
    const prioridade = normalizeText(field(rawPayload, ['prioridade', 'priority'])) || null;
    const investimento = normalizeText(field(rawPayload, ['investimento', 'investment'])) || null;
    const vidas = normalizeText(field(rawPayload, ['vidas', 'lives', 'quantidade de vidas'])) || null;
    const utmSource = trackingField(rawPayload, 'utm_source', ['utmSource', 'utm source', 'source', 'origem']);
    const utmMedium = trackingField(rawPayload, 'utm_medium', ['utmMedium', 'utm medium', 'medium', 'meio']);
    const utmCampaign = trackingField(rawPayload, 'utm_campaign', ['utmCampaign', 'utm campaign', 'campaign_name', 'campaignName', 'campaign', 'campanha']);
    const utmTerm = trackingField(rawPayload, 'utm_term', ['utmTerm', 'utm term', 'term', 'adset', 'ad_set', 'conjunto']);
    const utmContent = trackingField(rawPayload, 'utm_content', ['utmContent', 'utm content', 'content', 'ad', 'creative', 'criativo']);

    const incoming = {
      nome,
      telefone,
      email,
      empresa: normalizeText(field(rawPayload, ['empresa', 'company', 'negocio', 'nome da empresa'])) || null,
      estado: normalizeText(field(rawPayload, ['estado', 'uf', 'state'])).toUpperCase().slice(0, 2) || null,
      origem: normalizeText(field(rawPayload, ['origem', 'source', 'utm_source', 'canal'])) || 'Funil comercial',
      campanha: normalizeText(field(rawPayload, ['campanha', 'campaign', 'utm_campaign', 'formulario', 'form'])) || null,
      ja_investiu_trafego: jaInvestiuTrafego,
      faturamento_mensal: faturamentoMensal,
      prioridade,
      investimento,
      vidas,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_term: utmTerm,
      utm_content: utmContent,
      status,
      sdr_id: sdrId || null,
      closer_id: closerId || null,
      lead_qualificado: false,
      valor_negociacao: parseCurrencyValue(field(rawPayload, ['valor_negociacao', 'valor negociacao', 'valor', 'receita', 'ticket'])),
      observacoes: notes,
      data_entrada: dataEntrada,
      created_by: null,
    };

    const existing = await findExistingCommercialLead(telefone, email);
    if (existing?.id) {
      const mergedNotes = [existing.observacoes, notes ? `Reenvio do funil: ${notes}` : 'Reenvio do funil comercial']
        .filter(Boolean)
        .join(' | ');
      const { data, error } = await supabaseAdmin
        .from('comercial_leads')
        .update({
          telefone: existing.telefone || telefone,
          email: existing.email || email,
          empresa: existing.empresa || incoming.empresa,
          estado: existing.estado || incoming.estado,
          origem: existing.origem || incoming.origem,
          campanha: existing.campanha || incoming.campanha,
          ja_investiu_trafego: existing.ja_investiu_trafego || incoming.ja_investiu_trafego,
          faturamento_mensal: existing.faturamento_mensal || incoming.faturamento_mensal,
          prioridade: existing.prioridade || incoming.prioridade,
          investimento: existing.investimento || incoming.investimento,
          vidas: existing.vidas || incoming.vidas,
          utm_source: existing.utm_source || incoming.utm_source,
          utm_medium: existing.utm_medium || incoming.utm_medium,
          utm_campaign: existing.utm_campaign || incoming.utm_campaign,
          utm_term: existing.utm_term || incoming.utm_term,
          utm_content: existing.utm_content || incoming.utm_content,
          observacoes: mergedNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const sheet = await sendLeadToSheet(data, rawPayload);
      try {
        await startCommercialBotIfEligible(data.id);
      } catch (botError) {
        console.error('commercial_bot_first_message_failed', botError);
      }
      await writeAuditLog(request, null, {
        action: 'commercial.lead.webhook_duplicate',
        entity_type: 'commercial_lead',
        entity_id: data.id,
        metadata: { sheet },
      });

      return NextResponse.json({ success: true, duplicated: true, lead: data, sheet });
    }

    const { data, error } = await supabaseAdmin
      .from('comercial_leads')
      .insert(incoming)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sheet = await sendLeadToSheet(data, rawPayload);
    try {
      await startCommercialBotIfEligible(data.id);
    } catch (botError) {
      console.error('commercial_bot_first_message_failed', botError);
    }
    await writeAuditLog(request, null, {
      action: 'commercial.lead.create_webhook',
      entity_type: 'commercial_lead',
      entity_id: data.id,
      metadata: { origem: incoming.origem, campanha: incoming.campanha, sheet },
    });

    return NextResponse.json({ success: true, lead: data, sheet }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao receber lead comercial.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
