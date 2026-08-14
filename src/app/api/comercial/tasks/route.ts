import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';
import { reconcileOverdueCommercialReturns } from '@/lib/commercialCadenceServer';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  await reconcileOverdueCommercialReturns();
  let query = supabaseAdmin.from('comercial_tarefas').select('*').order('status').order('vencimento', { ascending: true, nullsFirst: false }).limit(1000);
  if (guard.commercialRole !== 'coordenador') query = query.eq('responsavel_id', guard.profile.id);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leadIds = Array.from(new Set((data || []).map((task) => task.lead_id).filter(Boolean)));
  const { data: leads } = leadIds.length
    ? await supabaseAdmin.from('comercial_leads').select('id,nome,telefone,status').in('id', leadIds)
    : { data: [] };
  const leadMap = new Map((leads || []).map((lead) => [lead.id, lead]));
  return NextResponse.json({ tasks: (data || []).map((task) => ({ ...task, lead: task.lead_id ? leadMap.get(task.lead_id) || null : null })) });
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const titulo = String(body.titulo || '').trim();
  if (!titulo) return NextResponse.json({ error: 'Titulo obrigatorio.' }, { status: 400 });
  const taskType = body.tipo === 'retorno' ? 'retorno' : 'geral';
  const dueAt = body.vencimento ? new Date(String(body.vencimento)) : null;
  if (taskType === 'retorno' && (!body.lead_id || !dueAt || Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now())) {
    return NextResponse.json({ error: 'Informe uma data e hora futura para o retorno.' }, { status: 400 });
  }
  const responsavelId = guard.commercialRole === 'coordenador' ? String(body.responsavel_id || guard.profile.id) : guard.profile.id;
  if (taskType === 'retorno') {
    let leadQuery = supabaseAdmin.from('comercial_leads').select('id,sdr_id,closer_id,cadencia_ativa').eq('id', body.lead_id);
    if (guard.commercialRole === 'sdr') leadQuery = leadQuery.eq('sdr_id', guard.profile.id);
    if (guard.commercialRole === 'closer') leadQuery = leadQuery.eq('closer_id', guard.profile.id);
    const { data: lead } = await leadQuery.maybeSingle();
    if (!lead) return NextResponse.json({ error: 'Lead não encontrado ou sem permissão.' }, { status: 404 });
    await supabaseAdmin.from('comercial_tarefas').update({ status: 'cancelada', updated_at: new Date().toISOString() }).eq('lead_id', lead.id).eq('tipo', 'retorno').eq('status', 'pendente');
  }
  const { data, error } = await supabaseAdmin.from('comercial_tarefas').insert({
    lead_id: body.lead_id || null,
    responsavel_id: responsavelId,
    titulo,
    descricao: String(body.descricao || '').trim() || null,
    vencimento: taskType === 'retorno' && dueAt ? dueAt.toISOString() : body.vencimento || null,
    prioridade: ['baixa', 'normal', 'alta'].includes(body.prioridade) ? body.prioridade : 'normal',
    tipo: taskType,
    created_by: guard.profile.id,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (taskType === 'retorno' && data.lead_id && dueAt) {
    const now = new Date().toISOString();
    const { error: leadError } = await supabaseAdmin.from('comercial_leads').update({
      cadencia_ativa: false,
      cadencia_fim_at: now,
      retorno_agendado_at: dueAt.toISOString(),
      retorno_status: 'agendado',
      mql_reserva: null,
      updated_at: now,
    }).eq('id', data.lead_id);
    if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });
    const formatted = dueAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    await recordCommercialTimelineEvent({ leadId: data.lead_id, actorId: guard.profile.id, type: 'return_scheduled', description: `Retorno agendado para ${formatted.replace(',', ' às')}.`, metadata: { task_id: data.id, due_at: dueAt.toISOString() } });
    await recordCommercialTimelineEvent({ leadId: data.lead_id, actorId: guard.profile.id, type: 'cadence_cancelled_for_return', description: `Cadência cancelada — aguardando retorno em ${formatted.replace(',', ' às')}.`, metadata: { task_id: data.id, due_at: dueAt.toISOString() } });
  }
  return NextResponse.json({ task: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'Tarefa obrigatoria.' }, { status: 400 });
  let check = supabaseAdmin.from('comercial_tarefas').select('id,lead_id,responsavel_id,tipo').eq('id', id);
  if (guard.commercialRole !== 'coordenador') check = check.eq('responsavel_id', guard.profile.id);
  const { data: allowed } = await check.maybeSingle();
  if (!allowed) return NextResponse.json({ error: 'Tarefa sem permissao.' }, { status: 403 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of ['status', 'titulo', 'descricao', 'vencimento', 'prioridade', 'responsavel_id']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field];
  }
  const { error } = await supabaseAdmin.from('comercial_tarefas').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (allowed.tipo === 'retorno' && allowed.lead_id && body.status === 'concluida') {
    await supabaseAdmin.from('comercial_leads').update({ retorno_status: 'resolvido', updated_at: new Date().toISOString() }).eq('id', allowed.lead_id).eq('retorno_status', 'agendado');
    await recordCommercialTimelineEvent({ leadId: allowed.lead_id, actorId: guard.profile.id, type: 'return_resolved', description: 'Retorno concluído pelo SDR.', metadata: { task_id: id } });
  }
  return NextResponse.json({ ok: true });
}
