import { NextResponse } from 'next/server';
import { applyCommercialLeadScope, requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/api/security';
import { startCommercialFirstContact } from '@/lib/commercialFirstContact';
import { assignNextCommercialSdr } from '@/lib/commercialDistribution';
import { isCommercialMql } from '@/lib/commercialQualification';
import { notifyCommercialLeadAssignment } from '@/lib/commercialLeadNotifications';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';
import { generateOnboardingBriefing } from '@/lib/commercialOnboardingBriefing';

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

function isNegotiationStage(value: unknown) {
  return normalizeStage(value).trim() === 'em negociacao';
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

function enrichSaleFields<T extends Record<string, unknown>>(lead: T) {
  return { ...lead, vendedor_id: lead.closer_id || null, reuniao_link: lead.reuniao_link || meetingLinkFromNotes(lead.observacoes) };
}

function validMeetingLink(value: unknown) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function redactFinancialFields<T extends Record<string, unknown>>(lead: T, canView: boolean) {
  if (canView) return lead;
  const sanitized = { ...lead };
  // O valor em negociação faz parte da operação diária do SDR e precisa aparecer
  // no card. Dados do fechamento continuam restritos aos perfis financeiros.
  for (const field of ['valor_fechado', 'valor_pago', 'modelo_pagamento']) delete sanitized[field];
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
    await startCommercialFirstContact(data.id);
  } catch (botError) {
    // O lead deve continuar sendo criado mesmo que o provedor de WhatsApp
    // esteja temporariamente indisponivel.
    console.error('commercial_first_contact_failed', botError);
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

  let check = supabaseAdmin.from('comercial_leads').select('*').eq('id', id);
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
    'valor_pago', 'modelo_pagamento', 'reuniao_link',
  ];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const enteringNegotiation = isNegotiationStage(targetStatus) && !isNegotiationStage(allowed.status);
  const negotiationValue = Object.prototype.hasOwnProperty.call(body, 'valor_negociacao')
    ? Number(body.valor_negociacao)
    : Number(allowed.valor_negociacao || 0);
  if (enteringNegotiation && (!Number.isFinite(negotiationValue) || negotiationValue <= 0)) {
    return NextResponse.json({ error: 'Informe um valor de negociação maior que zero antes de mover o lead.' }, { status: 400 });
  }
  const closingSale = isClosedStage(targetStatus) && !isClosedStage(allowed.status);
  const editingSaleFields = Object.prototype.hasOwnProperty.call(body, 'vendedor_id')
    || Object.prototype.hasOwnProperty.call(body, 'reuniao_link')
    || Object.prototype.hasOwnProperty.call(body, 'valor_pago')
    || Object.prototype.hasOwnProperty.call(body, 'modelo_pagamento')
    || Object.prototype.hasOwnProperty.call(body, 'fechado_at');
  if (editingSaleFields && !closingSale && guard.commercialRole !== 'coordenador') {
    return NextResponse.json({ error: 'Somente o administrador pode editar os dados de uma venda concluida.' }, { status: 403 });
  }
  for (const field of allowedFields) {
    if (!guard.canViewCommercialFinancials && ['valor_fechado', 'valor_pago', 'modelo_pagamento'].includes(field)) continue;
    if (!guard.canViewCommercialFinancials && field === 'valor_negociacao' && !enteringNegotiation) continue;
    if (guard.commercialRole === 'sdr' && ['sdr_id', 'closer_id'].includes(field)) continue;
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field] === '' ? null : body[field];
  }
  if (enteringNegotiation) update.valor_negociacao = negotiationValue;
  if (closingSale) {
    const automaticSellerId = guard.commercialRole === 'closer' || guard.profile.id === PEDRO_GHISOLFI_PROFILE_ID
      ? guard.profile.id
      : null;
    const sellerId = String(body.vendedor_id || automaticSellerId || '').trim();
    const meetingLink = validMeetingLink(body.reuniao_link);
    const amountPaid = Number(body.valor_pago);
    const paymentModel = String(body.modelo_pagamento || '').trim().toLowerCase();
    const closedAt = body.fechado_at ? new Date(String(body.fechado_at)) : new Date();
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
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      return NextResponse.json({ error: 'Informe quanto o cliente pagou.' }, { status: 400 });
    }
    if (!['tcv', 'mrr', 'mesclado'].includes(paymentModel)) {
      return NextResponse.json({ error: 'Selecione o modelo de pagamento: TCV, MRR ou Mesclado.' }, { status: 400 });
    }
    if (Number.isNaN(closedAt.getTime())) {
      return NextResponse.json({ error: 'Informe uma data valida para o fechamento.' }, { status: 400 });
    }
    update.closer_id = sellerId;
    update.valor_pago = amountPaid;
    update.valor_fechado = amountPaid;
    update.modelo_pagamento = paymentModel;
    update.fechado_at = closedAt.toISOString();
    update.reuniao_link = meetingLink;
    update.observacoes = notesWithMeetingLink(body.observacoes ?? allowed.observacoes, meetingLink);
  } else if (editingSaleFields && guard.commercialRole === 'coordenador') {
    if (Object.prototype.hasOwnProperty.call(body, 'reuniao_link')) {
      const meetingLink = validMeetingLink(body.reuniao_link);
      if (!meetingLink) return NextResponse.json({ error: 'Informe um link valido da reuniao.' }, { status: 400 });
      update.reuniao_link = meetingLink;
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
    if (Object.prototype.hasOwnProperty.call(body, 'valor_pago')) {
      const amountPaid = Number(body.valor_pago);
      if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
        return NextResponse.json({ error: 'Informe quanto o cliente pagou.' }, { status: 400 });
      }
      update.valor_pago = amountPaid;
      update.valor_fechado = amountPaid;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'modelo_pagamento')) {
      const paymentModel = String(body.modelo_pagamento || '').trim().toLowerCase();
      if (!['tcv', 'mrr', 'mesclado'].includes(paymentModel)) {
        return NextResponse.json({ error: 'Selecione o modelo de pagamento: TCV, MRR ou Mesclado.' }, { status: 400 });
      }
      update.modelo_pagamento = paymentModel;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'fechado_at')) {
      const closedAt = new Date(String(body.fechado_at || ''));
      if (Number.isNaN(closedAt.getTime())) {
        return NextResponse.json({ error: 'Informe uma data valida para o fechamento.' }, { status: 400 });
      }
      update.fechado_at = closedAt.toISOString();
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
  let result = data;
  const shouldGenerateBriefing = isClosedStage(data.status)
    && (closingSale
      || Object.prototype.hasOwnProperty.call(body, 'reuniao_link')
      || Object.prototype.hasOwnProperty.call(body, 'valor_pago')
      || Object.prototype.hasOwnProperty.call(body, 'modelo_pagamento')
      || Object.prototype.hasOwnProperty.call(body, 'fechado_at'));
  if (shouldGenerateBriefing && data.reuniao_link) {
    const [{ data: seller }, { data: interactions }] = await Promise.all([
      data.closer_id
        ? supabaseAdmin.from('profiles').select('nome').eq('id', data.closer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from('comercial_lead_interacoes')
        .select('comentario,tipo,created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    const briefingLines = await generateOnboardingBriefing({
      lead: data,
      meetingLink: data.reuniao_link,
      sellerName: seller?.nome || null,
      interactions: interactions || [],
    });
    const briefingGeneratedAt = new Date().toISOString();
    const briefingUpdate = await supabaseAdmin
      .from('comercial_leads')
      .update({ onboarding_briefing: briefingLines.join('\n'), briefing_gerado_at: briefingGeneratedAt })
      .eq('id', id)
      .select('*')
      .single();
    if (!briefingUpdate.error && briefingUpdate.data) result = briefingUpdate.data;
  }
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
    metadata: { from_status: allowed.status, to_status: targetStatus || allowed.status, fields: changedFields, vendedor_id: result.closer_id || null, reuniao_link: result.reuniao_link || meetingLinkFromNotes(result.observacoes) },
  });
  if (result.sdr_id && result.sdr_id !== allowed.sdr_id) {
    try {
      await notifyCommercialLeadAssignment(result);
    } catch (notificationError) {
      console.error('commercial_lead_reassignment_notification_failed', notificationError);
    }
  }
  return NextResponse.json({ lead: redactFinancialFields(enrichSaleFields(result), guard.canViewCommercialFinancials) });
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
