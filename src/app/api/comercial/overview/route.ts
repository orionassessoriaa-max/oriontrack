import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';

function ratio(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

const LOST_STATES = new Set(['perdido', 'desqualificado', 'sem interesse', 'negocio fechado', 'venda realizada']);
function normalized(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function scopedQuery(query: any, role: string, profileId: string) {
  if (role === 'sdr') return query.eq('sdr_id', profileId);
  if (role === 'closer') return query.eq('closer_id', profileId);
  return query;
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const start = url.searchParams.get('start') || defaultStart;
  const end = url.searchParams.get('end') || now.toISOString().slice(0, 10);

  let leadQuery = supabaseAdmin
    .from('comercial_leads')
    .select('*')
    .gte('data_entrada', `${start}T00:00:00-03:00`)
    .lte('data_entrada', `${end}T23:59:59-03:00`)
    .order('data_entrada');
  leadQuery = scopedQuery(leadQuery, guard.commercialRole, guard.profile.id);

  const investmentQuery = guard.canViewMetaInvestment
    ? supabaseAdmin.from('comercial_investimentos').select('data,valor').gte('data', start).lte('data', end)
    : Promise.resolve({ data: [], error: null });
  const [leadResult, investmentResult, memberResult] = await Promise.all([
    leadQuery,
    investmentQuery,
    supabaseAdmin.from('comercial_membros').select('profile_id,papel,ativo').eq('ativo', true),
  ]);
  if (leadResult.error) return NextResponse.json({ error: leadResult.error.message }, { status: 500 });

  const leads = leadResult.data || [];
  const stateMap = new Map<string, { state: string; leads: number; active: number }>();
  leads.forEach((lead) => {
    const state = String(lead.estado || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) return;
    const current = stateMap.get(state) || { state, leads: 0, active: 0 };
    current.leads += 1;
    if (!LOST_STATES.has(normalized(lead.status))) current.active += 1;
    stateMap.set(state, current);
  });
  const investment = (investmentResult.data || []).reduce((sum, row) => sum + Number(row.valor || 0), 0);
  const qualified = leads.filter((lead) => lead.lead_qualificado).length;
  const scheduled = leads.filter((lead) => lead.reuniao_agendada_at).length;
  const realized = leads.filter((lead) => lead.reuniao_realizada_at).length;
  const qualifiedMeetings = leads.filter((lead) => lead.reuniao_realizada_at && lead.reuniao_qualificada === true).length;
  const disqualifiedMeetings = leads.filter((lead) => lead.reuniao_realizada_at && lead.reuniao_qualificada === false).length;
  const noShow = leads.filter((lead) => lead.no_show || lead.status === 'No-show').length;
  const closed = leads.filter((lead) => lead.status === 'Negócio fechado' || Number(lead.valor_fechado || 0) > 0);
  const revenue = closed.reduce((sum, lead) => sum + Number(lead.valor_fechado || 0), 0);
  const negotiation = leads
    .filter((lead) => !['Perdido', 'Desqualificado', 'Fora do MQL', 'Negócio fechado'].includes(lead.status))
    .reduce((sum, lead) => sum + Number(lead.valor_negociacao || 0), 0);
  const closeTimes = closed
    .map((lead) => {
      const created = new Date(lead.data_entrada).getTime();
      const closedAt = new Date(lead.fechado_at || lead.updated_at).getTime();
      return Number.isFinite(created) && Number.isFinite(closedAt) ? Math.max(0, (closedAt - created) / 86_400_000) : null;
    })
    .filter((value): value is number => value !== null);

  const trendMap = new Map<string, { date: string; leads: number; mql: number; meetings: number; sales: number; revenue: number; investment: number }>();
  const ensureDay = (date: string) => {
    if (!trendMap.has(date)) trendMap.set(date, { date, leads: 0, mql: 0, meetings: 0, sales: 0, revenue: 0, investment: 0 });
    return trendMap.get(date)!;
  };
  leads.forEach((lead) => {
    const day = ensureDay(String(lead.data_entrada).slice(0, 10));
    day.leads += 1;
    if (lead.lead_qualificado) day.mql += 1;
    if (lead.reuniao_agendada_at) day.meetings += 1;
    if (lead.status === 'Negócio fechado' || Number(lead.valor_fechado || 0) > 0) {
      day.sales += 1;
      day.revenue += Number(lead.valor_fechado || 0);
    }
  });
  (investmentResult.data || []).forEach((row) => { ensureDay(row.data).investment += Number(row.valor || 0); });

  const profileIds = (memberResult.data || []).map((member) => member.profile_id);
  const { data: profiles } = profileIds.length
    ? await supabaseAdmin.from('profiles').select('id,nome,foto_url').in('id', profileIds)
    : { data: [] };
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const team = (memberResult.data || []).map((member) => {
    const owned = leads.filter((lead) => member.papel === 'sdr' ? lead.sdr_id === member.profile_id : member.papel === 'closer' ? lead.closer_id === member.profile_id : false);
    return {
      id: member.profile_id,
      role: member.papel,
      name: profileMap.get(member.profile_id)?.nome || 'Usuario',
      photo: profileMap.get(member.profile_id)?.foto_url || null,
      leads: owned.length,
      mql: owned.filter((lead) => lead.lead_qualificado).length,
      meetings: owned.filter((lead) => lead.reuniao_agendada_at).length,
      sales: owned.filter((lead) => lead.status === 'Negócio fechado').length,
      ...(guard.canViewCommercialFinancials ? { revenue: owned.reduce((sum, lead) => sum + Number(lead.valor_fechado || 0), 0) } : {}),
    };
  });

  const metrics = {
    leads: leads.length,
    qualified,
    scheduled,
    realized,
    qualifiedMeetings,
    disqualifiedMeetings,
    noShow,
    closed: closed.length,
    conversionLeads: ratio(closed.length, leads.length),
    conversionMeetings: ratio(closed.length, realized),
    conversionQualifiedMeetings: ratio(closed.length, qualifiedMeetings),
    schedulingRate: ratio(scheduled, leads.length),
    qualifiedSchedulingRate: ratio(qualifiedMeetings, scheduled),
    averageCloseDays: closeTimes.length ? closeTimes.reduce((sum, value) => sum + value, 0) / closeTimes.length : 0,
    ...(guard.canViewCommercialFinancials ? {
      negotiation,
      revenue,
      averageTicket: closed.length ? revenue / closed.length : 0,
      investment,
      cpl: leads.length ? investment / leads.length : 0,
      costPerMql: qualified ? investment / qualified : 0,
      costPerMeeting: realized ? investment / realized : 0,
      costPerQualifiedMeeting: qualifiedMeetings ? investment / qualifiedMeetings : 0,
      cac: closed.length ? investment / closed.length : 0,
      roi: investment ? ((revenue - investment) / investment) * 100 : 0,
      roas: investment ? revenue / investment : 0,
    } : {}),
  };

  const trend = Array.from(trendMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => guard.canViewCommercialFinancials ? row : {
      date: row.date,
      leads: row.leads,
      mql: row.mql,
      meetings: row.meetings,
      sales: row.sales,
    });

  return NextResponse.json({ metrics, trend, states: Array.from(stateMap.values()).sort((a, b) => b.leads - a.leads), role: guard.commercialRole, updatedAt: new Date().toISOString() });
}
