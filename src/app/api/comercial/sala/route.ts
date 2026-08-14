import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getCommercialMqlLevel } from '@/lib/commercialQualification';
import { DDD_INFO, DDD_STATE, dddFromPhone, leadState } from '@/lib/comercialGeo';

// Payload unico da sala imersiva: as tres janelas da cabine carregam juntas
// para a rotacao nao disparar tres requisicoes no meio da animacao.

const LOST_STATES = new Set(['perdido', 'desqualificado', 'sem interesse']);
const CLOSED_STATES = new Set(['negocio fechado', 'venda realizada']);

function normalized(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Data local de Sao Paulo, que e o fuso da operacao. */
function saoPauloToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(new Date());
}

function periodStart(period: string, today: string) {
  const reference = new Date(`${today}T12:00:00-03:00`);
  if (period === 'hoje') return today;
  if (period === '7d') return new Date(reference.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  if (period === '30d') return new Date(reference.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  if (period === 'tudo') return '2020-01-01';
  return `${today.slice(0, 7)}-01`;
}

type Bucket = { leads: number; emVenda: number; perdidos: number; fechados: number };

function emptyBucket(): Bucket {
  return { leads: 0, emVenda: 0, perdidos: 0, fechados: 0 };
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'mes';
  const today = saoPauloToday();
  const start = periodStart(period, today);
  const month = `${today.slice(0, 7)}-01`;

  let leadQuery = supabaseAdmin
    .from('comercial_leads')
    .select('id,nome,telefone,estado,status,sdr_id,closer_id,mql_reserva,faturamento_mensal,investimento,valor_negociacao,valor_fechado,data_entrada,reuniao_agendada_at,reuniao_link')
    .gte('data_entrada', `${start}T00:00:00-03:00`)
    .lte('data_entrada', `${today}T23:59:59-03:00`)
    .order('data_entrada', { ascending: false });

  let meetingQuery = supabaseAdmin
    .from('comercial_leads')
    .select('id,nome,telefone,estado,status,sdr_id,closer_id,mql_reserva,faturamento_mensal,investimento,valor_negociacao,reuniao_agendada_at,reuniao_realizada_at,reuniao_link,no_show')
    .gte('reuniao_agendada_at', `${today}T00:00:00-03:00`)
    .lte('reuniao_agendada_at', `${today}T23:59:59-03:00`)
    .order('reuniao_agendada_at', { ascending: true });

  // Cada SDR enxerga a propria carteira, igual ao resto do comercial.
  if (guard.commercialRole === 'sdr') {
    leadQuery = leadQuery.eq('sdr_id', guard.profile.id);
    meetingQuery = meetingQuery.eq('sdr_id', guard.profile.id);
  }

  // As metas sao sempre do mes corrente, independente do periodo do mapa.
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const goalLeadsQuery = supabaseAdmin
    .from('comercial_leads')
    .select('status,valor_fechado,valor_negociacao')
    .gte('data_entrada', `${month}T00:00:00-03:00`)
    .lte('data_entrada', `${monthEnd}T23:59:59-03:00`);

  const [leadResult, meetingResult, goalResult, goalLeadsResult] = await Promise.all([
    leadQuery,
    meetingQuery,
    supabaseAdmin.from('comercial_metas').select('*').eq('mes', month).maybeSingle(),
    goalLeadsQuery,
  ]);

  if (leadResult.error) return NextResponse.json({ error: leadResult.error.message }, { status: 500 });

  const leads = leadResult.data || [];
  const meetings = meetingResult.data || [];

  const profileIds = Array.from(new Set([...leads, ...meetings].flatMap((lead) => [lead.sdr_id, lead.closer_id]).filter(Boolean) as string[]));
  const { data: profiles } = profileIds.length
    ? await supabaseAdmin.from('profiles').select('id,nome').in('id', profileIds)
    : { data: [] as Array<{ id: string; nome: string | null }> };
  const nameById = new Map((profiles || []).map((profile) => [profile.id, profile.nome || 'Sem responsavel']));

  const stateBuckets = new Map<string, Bucket>();
  const dddBuckets = new Map<string, Bucket>();
  let semOrigem = 0;

  for (const lead of leads) {
    const status = normalized(lead.status);
    const closed = CLOSED_STATES.has(status);
    const lost = LOST_STATES.has(status);
    const uf = leadState(lead);
    const ddd = dddFromPhone(lead.telefone);

    if (!uf) {
      semOrigem += 1;
      continue;
    }

    const stateBucket = stateBuckets.get(uf) || emptyBucket();
    stateBucket.leads += 1;
    if (closed) stateBucket.fechados += 1;
    else if (lost) stateBucket.perdidos += 1;
    else stateBucket.emVenda += 1;
    stateBuckets.set(uf, stateBucket);

    if (ddd) {
      const dddBucket = dddBuckets.get(ddd) || emptyBucket();
      dddBucket.leads += 1;
      if (closed) dddBucket.fechados += 1;
      else if (lost) dddBucket.perdidos += 1;
      else dddBucket.emVenda += 1;
      dddBuckets.set(ddd, dddBucket);
    }
  }

  const states = Array.from(stateBuckets.entries())
    .map(([uf, bucket]) => ({
      uf,
      ...bucket,
      ddds: Array.from(dddBuckets.entries())
        .filter(([ddd]) => DDD_STATE[ddd] === uf)
        .map(([ddd, dddBucket]) => ({ ddd, cidade: DDD_INFO[ddd]?.cidade || ddd, ...dddBucket }))
        .sort((a, b) => b.leads - a.leads),
    }))
    .sort((a, b) => b.leads - a.leads);

  const recent = leads.slice(0, 14).map((lead) => {
    const ddd = dddFromPhone(lead.telefone);
    return {
      id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      status: lead.status,
      uf: leadState(lead),
      ddd,
      cidade: ddd ? DDD_INFO[ddd]?.cidade || null : null,
      sdr: lead.sdr_id ? nameById.get(lead.sdr_id) || null : null,
      mql: lead.mql_reserva || getCommercialMqlLevel(lead.faturamento_mensal, lead.investimento),
      valor: Number(lead.valor_negociacao || 0),
      at: lead.data_entrada,
    };
  });

  const reunioes = meetings.map((lead) => ({
    id: lead.id,
    nome: lead.nome,
    telefone: lead.telefone,
    status: lead.status,
    uf: leadState(lead),
    sdr: lead.sdr_id ? nameById.get(lead.sdr_id) || null : null,
    closer: lead.closer_id ? nameById.get(lead.closer_id) || null : null,
    mql: lead.mql_reserva || getCommercialMqlLevel(lead.faturamento_mensal, lead.investimento),
    valor: Number(lead.valor_negociacao || 0),
    agendada_at: lead.reuniao_agendada_at,
    realizada: Boolean(lead.reuniao_realizada_at),
    no_show: Boolean(lead.no_show),
    link: lead.reuniao_link,
  }));

  const goalRows = goalLeadsResult.data || [];
  const vendido = goalRows.reduce((total, lead) => total + Number(lead.valor_fechado || 0), 0);
  const emNegociacao = goalRows
    .filter((lead) => !LOST_STATES.has(normalized(lead.status)) && !CLOSED_STATES.has(normalized(lead.status)))
    .reduce((total, lead) => total + Number(lead.valor_negociacao || 0), 0);
  const vendas = goalRows.filter((lead) => CLOSED_STATES.has(normalized(lead.status)) || Number(lead.valor_fechado || 0) > 0).length;

  const totals = {
    leads: leads.length,
    emVenda: leads.filter((lead) => {
      const status = normalized(lead.status);
      return !LOST_STATES.has(status) && !CLOSED_STATES.has(status);
    }).length,
    fechados: leads.filter((lead) => CLOSED_STATES.has(normalized(lead.status))).length,
    semOrigem,
    reunioesHoje: reunioes.length,
  };

  return NextResponse.json({
    period,
    range: { start, end: today },
    totals,
    states,
    recent,
    reunioes,
    metas: {
      mes: month,
      meta_valor: Number(goalResult.data?.meta_valor || 0),
      meta_vendas: Number(goalResult.data?.meta_vendas || 0),
      ticket_medio: Number(goalResult.data?.ticket_medio || 0),
      vendido,
      emNegociacao,
      vendas,
    },
    updatedAt: new Date().toISOString(),
  });
}
