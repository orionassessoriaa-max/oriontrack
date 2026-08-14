import { NextResponse } from 'next/server';
import { requireCommercialUser, applyCommercialLeadScope } from '@/lib/api/comercial';
import {
  COMMERCIAL_CADENCE_DAYS,
  COMMERCIAL_CADENCE_POINTS,
  cadencePointLabel,
  cadenceResultIsResponse,
  type CommercialCadencePointStatus,
} from '@/lib/commercialCadence';
import { activeCadenceDay, ensureCommercialCadencePoints } from '@/lib/commercialCadenceServer';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';
import { supabaseAdmin } from '@/lib/supabase/admin';

const VALID_RESULTS = new Set<CommercialCadencePointStatus>([
  'nao_atendeu',
  'sem_resposta',
  'atendeu',
  'respondeu',
]);

async function allowedLead(id: string, guard: Awaited<ReturnType<typeof requireCommercialUser>>) {
  if ('error' in guard) return null;
  let query = supabaseAdmin
    .from('comercial_leads')
    .select('id,status,sdr_id,closer_id,cadencia_ativa,cadencia_inicio_at,cadencia_fim_at,retorno_status,retorno_agendado_at')
    .eq('id', id);
  if (guard.commercialRole !== 'coordenador') query = applyCommercialLeadScope(query, guard.commercialRole, guard.profile.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function cadencePayload(lead: NonNullable<Awaited<ReturnType<typeof allowedLead>>>) {
  if (lead.retorno_status === 'agendado') {
    return { active: false, return_active: true, return_at: lead.retorno_agendado_at, day: null, points: [] };
  }
  if (!lead.cadencia_ativa || !lead.cadencia_inicio_at) {
    return { active: false, return_active: false, return_at: null, day: null, points: [] };
  }

  const day = activeCadenceDay(lead.cadencia_inicio_at);
  if (day > COMMERCIAL_CADENCE_DAYS) {
    const now = new Date().toISOString();
    await supabaseAdmin.from('comercial_leads').update({ cadencia_ativa: false, cadencia_fim_at: now, updated_at: now }).eq('id', lead.id);
    await recordCommercialTimelineEvent({
      leadId: lead.id,
      type: 'cadence_finished',
      description: 'Cadência encerrada após 10 dias.',
      metadata: { days: COMMERCIAL_CADENCE_DAYS },
    });
    return { active: false, return_active: false, return_at: null, day: null, points: [] };
  }

  await ensureCommercialCadencePoints(lead.id, day);
  const { data, error } = await supabaseAdmin
    .from('comercial_cadencia_pontos')
    .select('id,dia,ponto,canal,status,registrado_at')
    .eq('lead_id', lead.id)
    .eq('dia', day)
    .order('ponto');
  if (error) throw error;
  return { active: true, return_active: false, return_at: null, day, points: data || [] };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const { id } = await context.params;
  try {
    const lead = await allowedLead(id, guard);
    if (!lead) return NextResponse.json({ error: 'Lead não encontrado ou sem permissão.' }, { status: 404 });
    return NextResponse.json(await cadencePayload(lead));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível carregar a cadência.' }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  if (guard.commercialRole === 'visualizador') return NextResponse.json({ error: 'Acesso somente para visualização.' }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const point = Number(body.point);
  const result = String(body.result || '') as CommercialCadencePointStatus;
  if (!COMMERCIAL_CADENCE_POINTS.some((item) => item.point === point) || !VALID_RESULTS.has(result)) {
    return NextResponse.json({ error: 'Ponto de contato ou resultado inválido.' }, { status: 400 });
  }

  try {
    const lead = await allowedLead(id, guard);
    if (!lead) return NextResponse.json({ error: 'Lead não encontrado ou sem permissão.' }, { status: 404 });
    if (!lead.cadencia_ativa || !lead.cadencia_inicio_at || lead.retorno_status === 'agendado') {
      return NextResponse.json({ error: 'Este lead não possui uma cadência ativa.' }, { status: 409 });
    }
    const day = activeCadenceDay(lead.cadencia_inicio_at);
    if (day > COMMERCIAL_CADENCE_DAYS) return NextResponse.json({ error: 'A cadência de 10 dias já terminou.' }, { status: 409 });
    await ensureCommercialCadencePoints(id, day);
    const { data: before, error: beforeError } = await supabaseAdmin
      .from('comercial_cadencia_pontos')
      .select('ponto,status')
      .eq('lead_id', id)
      .eq('dia', day)
      .order('ponto');
    if (beforeError) throw beforeError;
    const target = before?.find((item) => item.ponto === point);
    if (!target || target.status !== 'pendente') {
      return NextResponse.json({ error: 'Este ponto de contato já foi registrado.' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('comercial_cadencia_pontos')
      .update({ status: result, registrado_por: guard.profile.id, registrado_at: now, updated_at: now })
      .eq('lead_id', id)
      .eq('dia', day)
      .eq('ponto', point)
      .eq('status', 'pendente');
    if (updateError) throw updateError;

    if (cadenceResultIsResponse(result)) {
      const { error: remainingError } = await supabaseAdmin
        .from('comercial_cadencia_pontos')
        .update({ status: 'nao_necessario', registrado_por: guard.profile.id, registrado_at: now, updated_at: now })
        .eq('lead_id', id)
        .eq('dia', day)
        .eq('status', 'pendente');
      if (remainingError) throw remainingError;
    }

    const resultLabel = result === 'nao_atendeu' ? 'não atendeu' : result === 'sem_resposta' ? 'sem resposta' : result;
    await recordCommercialTimelineEvent({
      leadId: id,
      actorId: guard.profile.id,
      type: 'cadence_contact_registered',
      description: `${cadencePointLabel(point)} — ${resultLabel}.`,
      metadata: { day, point, result },
    });

    const { data: after, error: afterError } = await supabaseAdmin
      .from('comercial_cadencia_pontos')
      .select('ponto,status')
      .eq('lead_id', id)
      .eq('dia', day)
      .order('ponto');
    if (afterError) throw afterError;
    const hadPendingBefore = Boolean(before?.some((item) => item.status === 'pendente'));
    const hasPendingAfter = Boolean(after?.some((item) => item.status === 'pendente'));
    if (hadPendingBefore && !hasPendingAfter) {
      const attempts = (after || []).filter((item) => !['pendente', 'nao_necessario'].includes(item.status));
      const response = attempts.find((item) => ['atendeu', 'respondeu'].includes(item.status));
      await recordCommercialTimelineEvent({
        leadId: id,
        actorId: guard.profile.id,
        type: 'cadence_day_completed',
        description: response
          ? `Dia ${day} concluído — ${attempts.length}/8 tentativas, resposta no ${response.ponto}º ponto.`
          : `Dia ${day} concluído — ${attempts.length}/8 tentativas, sem resposta.`,
        metadata: { day, attempts: attempts.length, response_point: response?.ponto || null },
      });
    }

    const refreshed = await allowedLead(id, guard);
    return NextResponse.json(refreshed ? await cadencePayload(refreshed) : { active: false, points: [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível registrar o contato.' }, { status: 500 });
  }
}
