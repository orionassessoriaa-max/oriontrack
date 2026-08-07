import { NextResponse } from 'next/server';
import { applyCommercialLeadScope, requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/api/security';
import { startCommercialBotIfEligible } from '@/lib/commercialBot';
import { assignNextCommercialSdr } from '@/lib/commercialDistribution';
import { isCommercialMql } from '@/lib/commercialQualification';
import { notifyCommercialLeadAssignment } from '@/lib/commercialLeadNotifications';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';

function normalizeStage(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isScheduledMeetingStage(value: unknown) {
  const normalized = normalizeStage(value);
  return normalized.includes('reunio') && normalized.includes('agend');
}

function isNoShowStage(value: unknown) {
  return normalizeStage(value).replace(/[-_]/g, ' ').includes('no show');
}

function isClosedStage(value: unknown) {
  return normalizeStage(value).trim() === 'negocio fechado';
}

const PEDRO_GHISOLFI_PROFILE_ID = 'a12b63f9-4c72-4a92-a99a-98c020723a06';
const MEETING_LINK_LABEL = 'Link da reunião';

function meetingLinkFromNotes(notes: unknown) {
  const match = String(notes || '').split(/\s*\|\s*/).find((part) => normalizeStage(part.split(':')[0]).trim() === normalizeStage(MEETING_LINK_LABEL));
  return match ? match.slice(match.indexOf(':') + 1).trim() || null : null;
}

function notesWithMeetingLink(notes: unknown, link: string) {
  const parts = String(notes || '').split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean)
    .filter((part) => normalizeStage(part.split(':')[0]).trim() !== normalizeStage(MEETING_LINK_LABEL));
  parts.push(`${MEETING_LINK_LABEL}: ${link}`);
  return parts.join(' | ');
}

function enrichSaleFields<T extends Record<string, any>>(lead: T) {
  return { ...lead, vendedor_id: lead.closer_id || null, reuniao_link: meetingLinkFromNotes(lead.observacoes) };
}

function validMeetingLink(value: unknown) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function redactFinancialFields<T extends Record<string, any>>(lead: T, canView: boolean) {
  if (canView) return lead;
  const sanitized = { ...lead };
  for (const field of ['valor_negociacao', 'valor_fechado']) delete sanitized[field];
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
  const leadIds = (data || []).map((lead) => lead.id);
  const { data: pendingTasks } = leadIds.length
    ? await supabaseAdmin
      .from('comercial_tarefas')
      .select('lead_id,titulo,vencimento')
      .in('lead_id', leadIds)
      .eq('status', 'pendente')
      .not('vencimento', 'is', null)
      .order('vencimento', { ascending: true })
    : { data: [] };
  const nextReturnByLead = new Map<string, { titulo: string | null; vencimento: string | null }>();
  for (const task of pendingTasks || []) {
    if (task.lead_id && !nextReturnByLead.has(task.lead_id)) nextReturnByLead.set(task.lead_id, task);
  }
  return NextResponse.json({
    leads: (data || []).map((lead) => {
      const nextReturn = nextReturnByLead.get(lead.id);
      return redactFinancialFields(enrichSaleFields({
        ...lead,
        lead_qualificado: isCommercialMql(lead.faturamento_mensal, lead.investimento),
        proximo_retorno_at: nextReturn?.vencimento || null,
        proximo_retorno_titulo: nextReturn?.titulo || null,
      }), guard.canViewCommercialFinancials);
    }),
    role: guard.commercialRole,
  });
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
    ja_investiu_trafego: String(body.ja_investiu_trafego || '').trim() || null,
    faturamento_mensal: String(body.faturamento_mensal || '').trim() || null,
    prioridade: String(body.prioridade || '').trim() || null,
    investimento: String(body.investimento || '').trim() || null,
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
    lead_qualificado: isCommercialMql(body.faturamento_mensal, body.investimento),
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
  await recordCommercialTimelineEvent({
    leadId: data.id,
    actorId: guard.profile.id,
    type: 'lead_created',
    description: `Lead criado por ${guard.profile.nome || 'Equipe comercial'}.`,
    metadata: { status: data.status, sdr_id: data.sdr_id, closer_id: data.closer_id },
  });
  try {
    await notifyCommercialLeadAssignment(data);
  } catch (notificationError) {
    console.error('commercial_lead_assignment_notification_failed', notificationError);
  }
  return NextResponse.json({ lead: redactFinancialFields(data, guard.canViewCommercialFinancials) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'Lead obrigatorio.' }, { status: 400 });

  let check = supabaseAdmin.from('comercial_leads').select('id,sdr_id,closer_id,observacoes,status,reuniao_agendada_at,reuniao_realizada_at,no_show,no_show_count,faturamento_mensal,investimento,lead_qualificado').eq('id', id);
  check = applyCommercialLeadScope(check, guard.commercialRole, guard.profile.id);
  const { data: allowed } = await check.maybeSingle();
  if (!allowed) return NextResponse.json({ error: 'Lead nao encontrado ou sem permissao.' }, { status: 404 });

  const targetStatus = String(body.status || '').trim();
  const isScheduledStage = isScheduledMeetingStage(targetStatus);
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
  const closingSale = isClosedStage(targetStatus) && !isClosedStage(allowed.status);
  const editingSaleFields = Object.prototype.hasOwnProperty.call(body, 'vendedor_id')
    || Object.prototype.hasOwnProperty.call(body, 'reuniao_link');
  if (editingSaleFields && !closingSale && guard.commercialRole !== 'coordenador') {
    return NextResponse.json({ error: 'Somente o administrador pode editar os dados de uma venda concluida.' }, { status: 403 });
  }
  for (const field of allowedFields) {
    if (!guard.canViewCommercialFinancials && ['valor_negociacao', 'valor_fechado'].includes(field)) continue;
    if (guard.commercialRole === 'sdr' && ['sdr_id', 'closer_id'].includes(field)) continue;
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field] === '' ? null : body[field];
  }
  if (closingSale) {
    const automaticSellerId = guard.commercialRole === 'closer' || guard.profile.id === PEDRO_GHISOLFI_PROFILE_ID
      ? guard.profile.id
      : null;
    const sellerId = String(body.vendedor_id || automaticSellerId || '').trim();
    const meetingLink = validMeetingLink(body.reuniao_link);
    if (!sellerId) {
      return NextResponse.json({ error: 'Selecione quem realizou a venda.' }, { status: 400 });
    }
    const { data: sellerMember } = await supabaseAdmin
      .from('comercial_membros')
      .select('profile_id,papel,ativo')
      .eq('profile_id', sellerId)
      .eq('ativo', true)
      .maybeSingle();
    const validSeller = sellerMember?.papel === 'closer' || sellerId === PEDRO_GHISOLFI_PROFILE_ID;
    if (!validSeller) {
      return NextResponse.json({ error: 'O vendedor deve ser um closer ativo ou o administrador Pedro.' }, { status: 400 });
    }
    if (!meetingLink) {
      return NextResponse.json({ error: 'Informe um link valido da reuniao para concluir a venda.' }, { status: 400 });
    }
    update.closer_id = sellerId;
    update.observacoes = notesWithMeetingLink(body.observacoes ?? allowed.observacoes, meetingLink);
  } else if (editingSaleFields && guard.commercialRole === 'coordenador') {
    if (Object.prototype.hasOwnProperty.call(body, 'reuniao_link')) {
      const meetingLink = validMeetingLink(body.reuniao_link);
      if (!meetingLink) return NextResponse.json({ error: 'Informe um link valido da reuniao.' }, { status: 400 });
      update.observacoes = notesWithMeetingLink(body.observacoes ?? allowed.observacoes, meetingLink);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'vendedor_id')) {
      const sellerId = String(body.vendedor_id || '').trim();
      if (!sellerId) return NextResponse.json({ error: 'Selecione quem realizou a venda.' }, { status: 400 });
      const { data: sellerMember } = await supabaseAdmin
        .from('comercial_membros')
        .select('profile_id,papel,ativo')
        .eq('profile_id', sellerId)
        .eq('ativo', true)
        .maybeSingle();
      if (sellerMember?.papel !== 'closer' && sellerId !== PEDRO_GHISOLFI_PROFILE_ID) {
        return NextResponse.json({ error: 'O vendedor deve ser um closer ativo ou o administrador Pedro.' }, { status: 400 });
      }
      update.closer_id = sellerId;
    }
  }
  const statusChanged = Boolean(targetStatus) && targetStatus !== allowed.status;
  if (statusChanged && isNoShowStage(targetStatus) && !isNoShowStage(allowed.status)) {
    update.no_show = true;
    update.no_show_count = Number(allowed.no_show_count || 0) + 1;
  } else if (statusChanged && isScheduledStage) {
    update.no_show = false;
  } else if (statusChanged && isScheduledMeetingStage(allowed.status) && !isNoShowStage(targetStatus)) {
    update.reuniao_realizada_at = body.reuniao_realizada_at || new Date().toISOString();
    update.no_show = false;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'faturamento_mensal') || Object.prototype.hasOwnProperty.call(body, 'investimento')) {
    update.lead_qualificado = isCommercialMql(
      Object.prototype.hasOwnProperty.call(body, 'faturamento_mensal') ? body.faturamento_mensal : allowed.faturamento_mensal,
      Object.prototype.hasOwnProperty.call(body, 'investimento') ? body.investimento : allowed.investimento,
    );
  }
  if (isClosedStage(update.status) && !Object.prototype.hasOwnProperty.call(body, 'fechado_at')) {
    update.fechado_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin.from('comercial_leads').update(update).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAuditLog(request, guard.profile, {
    action: 'commercial.lead.update', entity_type: 'commercial_lead', entity_id: id, metadata: { fields: Object.keys(update) },
  });
  const changedFields = Object.keys(update).filter((field) => field !== 'updated_at');
  const timelineDescription = statusChanged
    ? isNoShowStage(targetStatus)
      ? `Moveu o lead de ${allowed.status} para ${targetStatus}. No-show ${Number(data.no_show_count || 0)} registrado.`
      : isScheduledMeetingStage(allowed.status) && !isScheduledMeetingStage(targetStatus)
        ? `Moveu o lead de ${allowed.status} para ${targetStatus}. A reuniao foi marcada automaticamente como realizada.`
        : `Moveu o lead de ${allowed.status} para ${targetStatus}.`
    : `Atualizou ${changedFields.length} campo(s) do lead.`;
  await recordCommercialTimelineEvent({
    leadId: id,
    actorId: guard.profile.id,
    type: statusChanged ? (isNoShowStage(targetStatus) ? 'meeting_no_show' : 'stage_changed') : 'lead_updated',
    description: timelineDescription,
    metadata: { from_status: allowed.status, to_status: targetStatus || allowed.status, fields: changedFields, vendedor_id: data.closer_id || null, reuniao_link: meetingLinkFromNotes(data.observacoes) },
  });
  return NextResponse.json({ lead: redactFinancialFields(enrichSaleFields(data), guard.canViewCommercialFinancials) });
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
