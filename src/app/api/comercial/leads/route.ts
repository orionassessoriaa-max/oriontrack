import { NextResponse } from 'next/server';
import { applyCommercialLeadScope, requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/api/security';
import { startCommercialBotIfEligible } from '@/lib/commercialBot';
import { assignNextCommercialSdr } from '@/lib/commercialDistribution';

function redactFinancialFields<T extends Record<string, any>>(lead: T, canView: boolean) {
  if (canView) return lead;
  const sanitized = { ...lead };
  for (const field of ['ja_investiu_trafego', 'faturamento_mensal', 'investimento', 'valor_negociacao', 'valor_fechado']) delete sanitized[field];
  return sanitized;
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search')?.trim();

  let query = supabaseAdmin.from('comercial_leads').select('*').order('data_entrada', { ascending: false }).limit(2000);
  query = applyCommercialLeadScope(query, guard.commercialRole, guard.profile.id);
  if (start) query = query.gte('data_entrada', `${start}T00:00:00-03:00`);
  if (end) query = query.lte('data_entrada', `${end}T23:59:59-03:00`);
  if (status && status !== 'todos') query = query.eq('status', status);
  if (search) query = query.or(`nome.ilike.%${search}%,telefone.ilike.%${search}%,email.ilike.%${search}%,empresa.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: (data || []).map((lead) => redactFinancialFields(lead, guard.canViewCommercialFinancials)), role: guard.commercialRole });
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const nome = String(body.nome || '').trim();
  if (!nome) return NextResponse.json({ error: 'Nome do lead e obrigatorio.' }, { status: 400 });

  const status = String(body.status || 'Oportunidade').trim().slice(0, 80) || 'Oportunidade';
  const assignedSdrId = guard.commercialRole === 'sdr'
    ? guard.profile.id
    : body.sdr_id || await assignNextCommercialSdr();
  const payload = {
    nome,
    telefone: String(body.telefone || '').trim() || null,
    email: String(body.email || '').trim() || null,
    empresa: String(body.empresa || '').trim() || null,
    estado: String(body.estado || '').trim().toUpperCase().slice(0, 2) || null,
    origem: String(body.origem || '').trim() || null,
    campanha: String(body.campanha || '').trim() || null,
    ja_investiu_trafego: guard.canViewCommercialFinancials ? String(body.ja_investiu_trafego || '').trim() || null : null,
    faturamento_mensal: guard.canViewCommercialFinancials ? String(body.faturamento_mensal || '').trim() || null : null,
    prioridade: String(body.prioridade || '').trim() || null,
    investimento: guard.canViewCommercialFinancials ? String(body.investimento || '').trim() || null : null,
    vidas: String(body.vidas || '').trim() || null,
    negocio_etapa: String(body.negocio_etapa || '').trim() || null,
    utm_source: String(body.utm_source || '').trim() || null,
    utm_medium: String(body.utm_medium || '').trim() || null,
    utm_campaign: String(body.utm_campaign || '').trim() || null,
    utm_term: String(body.utm_term || '').trim() || null,
    utm_content: String(body.utm_content || '').trim() || null,
    status,
    sdr_id: assignedSdrId || null,
    closer_id: guard.commercialRole === 'closer' ? guard.profile.id : body.closer_id || null,
    lead_qualificado: Boolean(body.lead_qualificado),
    valor_negociacao: guard.canViewCommercialFinancials ? Number(body.valor_negociacao || 0) : 0,
    observacoes: String(body.observacoes || '').trim() || null,
    created_by: guard.profile.id,
  };
  const { data, error } = await supabaseAdmin.from('comercial_leads').insert(payload).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    await startCommercialBotIfEligible(data.id);
  } catch (botError) {
    // O lead deve continuar sendo criado mesmo que o provedor de WhatsApp
    // esteja temporariamente indisponivel.
    console.error('commercial_bot_first_message_failed', botError);
  }
  await writeAuditLog(request, guard.profile, { action: 'commercial.lead.create', entity_type: 'commercial_lead', entity_id: data.id });
  return NextResponse.json({ lead: redactFinancialFields(data, guard.canViewCommercialFinancials) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'Lead obrigatorio.' }, { status: 400 });

  let check = supabaseAdmin.from('comercial_leads').select('id,sdr_id,closer_id,status').eq('id', id);
  check = applyCommercialLeadScope(check, guard.commercialRole, guard.profile.id);
  const { data: allowed } = await check.maybeSingle();
  if (!allowed) return NextResponse.json({ error: 'Lead nao encontrado ou sem permissao.' }, { status: 404 });

  const targetStatus = String(body.status || '').trim();
  const normalizedStatus = targetStatus.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isScheduledStage = normalizedStatus.includes('reunio') && normalizedStatus.includes('agend');
  const scheduledAt = body.reuniao_agendada_at ? new Date(String(body.reuniao_agendada_at)) : null;
  if (isScheduledStage && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
    return NextResponse.json({ error: 'Informe a data e o horario da reuniao antes de mover o lead.' }, { status: 400 });
  }

  const allowedFields = [
    'nome', 'telefone', 'email', 'empresa', 'estado', 'origem', 'campanha', 'ja_investiu_trafego', 'faturamento_mensal',
    'prioridade', 'investimento', 'vidas', 'negocio_etapa', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
    'utm_content', 'status', 'sdr_id', 'closer_id',
    'lead_qualificado', 'valor_negociacao', 'valor_fechado', 'reuniao_agendada_at',
    'reuniao_realizada_at', 'reuniao_qualificada', 'no_show', 'observacoes', 'ultimo_contato_at', 'fechado_at',
  ];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (!guard.canViewCommercialFinancials && ['ja_investiu_trafego', 'faturamento_mensal', 'investimento', 'valor_negociacao', 'valor_fechado'].includes(field)) continue;
    if (guard.commercialRole === 'sdr' && ['sdr_id', 'closer_id'].includes(field)) continue;
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field] === '' ? null : body[field];
  }
  if (update.status === 'Negócio fechado' && !Object.prototype.hasOwnProperty.call(body, 'fechado_at')) {
    update.fechado_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin.from('comercial_leads').update(update).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAuditLog(request, guard.profile, {
    action: 'commercial.lead.update', entity_type: 'commercial_lead', entity_id: id, metadata: { fields: Object.keys(update) },
  });
  return NextResponse.json({ lead: redactFinancialFields(data, guard.canViewCommercialFinancials) });
}

export async function DELETE(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map((id: unknown) => String(id)).filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ error: 'Selecione pelo menos um lead.' }, { status: 400 });

  const { data: deleted, error } = await supabaseAdmin
    .from('comercial_leads')
    .delete()
    .in('id', ids)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog(request, guard.profile, {
    action: 'commercial.lead.bulk_delete',
    entity_type: 'commercial_lead',
    metadata: { ids: (deleted || []).map((lead) => lead.id) },
  });
  return NextResponse.json({ deleted: deleted?.length || 0 });
}
