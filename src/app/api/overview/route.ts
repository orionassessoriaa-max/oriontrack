import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { maybeSyncVoipRecordings } from '@/lib/voipRecordingSync';

export const dynamic = 'force-dynamic';

const TIMEZONE = 'America/Sao_Paulo';
const KRIPTO_REVENUE_GOAL = 185_000;
const KRIPTO_SALES_GOAL = 25;
const KRIPTO_CALLS_PER_SDR_GOAL = 100;
const KRIPTO_NO_SHOW_LIMIT = 20;
const KRIPTO_CONVERSION_GOAL = 40;
const APOLLO_GOAL = 30_000;
const APOLLO_SUPER_GOAL = 50_000;
const CLOSED_STATES = new Set(['negocio fechado', 'venda realizada']);

function normalize(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'OR';
}

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function isMissingTeamTable(error: { message?: string; code?: string } | null) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return ['42P01', '42703', 'PGRST205', 'PGRST202'].includes(code)
    || /equipe_(pontos|vendas)|schema cache|could not find/i.test(message);
}

function closedAt(lead: { fechado_at?: string | null; updated_at?: string | null; data_entrada?: string | null }) {
  return lead.fechado_at || lead.updated_at || lead.data_entrada || null;
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request);
  if ('error' in guard) return guard.error;

  const { data: commercialMember } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id,ativo')
    .eq('profile_id', guard.profile.id)
    .eq('ativo', true)
    .maybeSingle();

  const canView = guard.profile.tipo_usuario === 'admin'
    || guard.profile.equipe_orion === 'apollo'
    || guard.profile.equipe_orion === 'kripto_hunters'
    || Boolean(commercialMember);

  if (!canView) {
    return NextResponse.json({ error: 'Acesso restrito aos times Kripto e Apollo.' }, { status: 403 });
  }

  try {
    await maybeSyncVoipRecordings();
  } catch (error) {
    console.error('[overview_voip_sync]', error instanceof Error ? error.message : error);
  }

  const today = todayInSaoPaulo();
  const month = today.slice(0, 7);
  const monthStart = `${month}-01T00:00:00-03:00`;
  const todayStart = `${today}T00:00:00-03:00`;
  const todayEnd = `${today}T23:59:59-03:00`;

  const [
    leadsResult,
    callsResult,
    whatsappCallsResult,
    membersResult,
    apolloMembersResult,
    apolloPointsResult,
    apolloSalesResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('comercial_leads')
      .select('id,nome,status,valor_fechado,valor_negociacao,sdr_id,closer_id,fechado_at,updated_at,data_entrada,reuniao_agendada_at,reuniao_realizada_at,reuniao_qualificada,no_show,no_show_count')
      .or(`fechado_at.gte.${monthStart},data_entrada.gte.${monthStart}`)
      .limit(5000),
    supabaseAdmin
      .from('comercial_ligacoes')
      .select('sdr_id,status')
      .in('status', ['atendida', 'nao_atendida', 'concluida'])
      .or('origem.neq.click2call,voip_record_id.not.is.null')
      .gte('iniciada_at', todayStart)
      .lte('iniciada_at', todayEnd)
      .limit(5000),
    supabaseAdmin
      .from('comercial_cadencia_tentativas')
      .select('autor_id,status')
      .eq('canal', 'ligacao_whatsapp')
      .in('status', ['atendeu', 'nao_atendeu'])
      .gte('concluido_at', todayStart)
      .lte('concluido_at', todayEnd)
      .limit(5000),
    supabaseAdmin
      .from('comercial_membros')
      .select('profile_id,papel,ativo')
      .eq('ativo', true),
    supabaseAdmin
      .from('profiles')
      .select('id,nome,foto_url,tipo_usuario,equipe_orion,is_admin_master,email,email_real')
      .in('tipo_usuario', ['admin', 'gestor_trafego', 'designer', 'account_manager'])
      .in('status', ['active', 'ativo', 'Ativo'])
      .order('nome'),
    supabaseAdmin
      .from('equipe_pontos')
      .select('profile_id,pontos')
      .eq('equipe', 'apollo')
      .eq('mes', month),
    supabaseAdmin
      .from('equipe_vendas')
      .select('id,nome,vendido,valor,created_at')
      .eq('equipe', 'apollo')
      .eq('mes', month)
      .order('created_at', { ascending: false }),
  ]);

  const firstError = [leadsResult, callsResult, whatsappCallsResult, membersResult, apolloMembersResult]
    .find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });
  if (apolloPointsResult.error && !isMissingTeamTable(apolloPointsResult.error)) {
    return NextResponse.json({ error: apolloPointsResult.error.message }, { status: 500 });
  }

  let apolloSalesRows = apolloSalesResult.data || [];
  if (apolloSalesResult.error) {
    if (!isMissingTeamTable(apolloSalesResult.error)) {
      return NextResponse.json({ error: apolloSalesResult.error.message }, { status: 500 });
    }

    const { data: saleAudit, error: auditError } = await supabaseAdmin
      .from('audit_logs')
      .select('action,entity_id,metadata,created_at')
      .in('action', ['team.sale.create', 'team.sale.update', 'team.sale.delete'])
      .order('created_at', { ascending: true })
      .limit(500);
    if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });

    const reconstructed = new Map<string, { id: string; nome: string; vendido: string; valor: number; created_at: string }>();
    for (const entry of saleAudit || []) {
      const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata as Record<string, unknown> : {};
      if (metadata.equipe !== 'apollo' || metadata.mes !== month) continue;
      const id = String(entry.entity_id || metadata.sale_id || '');
      if (!id) continue;
      if (entry.action === 'team.sale.delete') {
        reconstructed.delete(id);
        continue;
      }
      const current = reconstructed.get(id);
      reconstructed.set(id, {
        id,
        nome: String(metadata.nome ?? current?.nome ?? 'Venda Apollo'),
        vendido: String(metadata.vendido ?? current?.vendido ?? 'Serviço Orion'),
        valor: Number(metadata.valor ?? current?.valor ?? 0),
        created_at: current?.created_at || String(entry.created_at),
      });
    }
    apolloSalesRows = Array.from(reconstructed.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const leads = leadsResult.data || [];
  const monthLeads = leads.filter((lead) => String(lead.data_entrada || '').slice(0, 7) === month);
  const monthClosed = leads.filter((lead) => {
    if (!CLOSED_STATES.has(normalize(lead.status))) return false;
    return String(closedAt(lead) || '').slice(0, 7) === month;
  });
  const revenue = monthClosed.reduce((sum, lead) => sum + Number(lead.valor_fechado || lead.valor_negociacao || 0), 0);
  const scheduled = monthLeads.filter((lead) => lead.reuniao_agendada_at).length;
  const qualifiedMeetings = monthLeads.filter((lead) => lead.reuniao_realizada_at && lead.reuniao_qualificada === true).length;
  const noShows = monthLeads.reduce(
    (sum, lead) => sum + Number(lead.no_show_count || (lead.no_show || normalize(lead.status) === 'no-show' ? 1 : 0)),
    0,
  );

  const commercialMembers = membersResult.data || [];
  const profileIds = commercialMembers.map((member) => member.profile_id).filter(Boolean);
  const { data: commercialProfiles, error: profilesError } = profileIds.length
    ? await supabaseAdmin.from('profiles').select('id,nome,foto_url').in('id', profileIds)
    : { data: [], error: null };
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const profilesById = new Map((commercialProfiles || []).map((profile) => [profile.id, profile]));
  const callBoard = new Map<string, { calls: number; answered: number }>();
  const addCall = (id: string, answered: boolean) => {
    const row = callBoard.get(id) || { calls: 0, answered: 0 };
    row.calls += 1;
    if (answered) row.answered += 1;
    callBoard.set(id, row);
  };
  for (const call of callsResult.data || []) {
    if (call.sdr_id) addCall(call.sdr_id, call.status === 'atendida' || call.status === 'concluida');
  }
  for (const call of whatsappCallsResult.data || []) {
    if (call.autor_id) addCall(call.autor_id, call.status === 'atendeu');
  }

  const activeSdrs = commercialMembers.filter((member) => member.papel === 'sdr');
  const callsRanking = activeSdrs
    .map((member) => {
      const profile = profilesById.get(member.profile_id);
      const calls = callBoard.get(member.profile_id) || { calls: 0, answered: 0 };
      const meetings = monthLeads.filter((lead) => lead.sdr_id === member.profile_id && lead.reuniao_agendada_at).length;
      const name = profile?.nome || 'Sem nome';
      return { id: member.profile_id, name, initials: initials(name), photo: profile?.foto_url || null, meetings, ...calls };
    })
    .sort((a, b) => b.calls - a.calls || b.meetings - a.meetings);

  const salesRanking = commercialMembers
    .map((member) => {
      const profile = profilesById.get(member.profile_id);
      const sales = monthClosed.filter((lead) => (lead.closer_id || lead.sdr_id) === member.profile_id);
      const name = profile?.nome || 'Sem nome';
      return {
        id: member.profile_id,
        name,
        initials: initials(name),
        photo: profile?.foto_url || null,
        role: member.papel,
        sales: sales.length,
        revenue: sales.reduce((sum, lead) => sum + Number(lead.valor_fechado || lead.valor_negociacao || 0), 0),
      };
    })
    .filter((row) => row.sales > 0 || row.role === 'closer')
    .sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);

  const teamCalls = callsRanking.reduce((sum, row) => sum + row.calls, 0);
  const teamAnswered = callsRanking.reduce((sum, row) => sum + row.answered, 0);
  const pointsByProfile = new Map<string, number>();
  for (const point of apolloPointsResult.data || []) {
    pointsByProfile.set(point.profile_id, (pointsByProfile.get(point.profile_id) || 0) + Number(point.pontos || 0));
  }
  const apolloMembers = (apolloMembersResult.data || [])
    .filter((member) => {
      const isMaster = Boolean(member.is_admin_master)
        || String(member.email || '').toLowerCase() === 'ewerttonherculano@gmail.com'
        || String(member.email_real || '').toLowerCase() === 'ewerttonherculano@gmail.com';
      return member.equipe_orion === 'apollo' || isMaster;
    })
    .map((member) => ({
      id: member.id,
      name: member.nome || 'Sem nome',
      initials: initials(member.nome || ''),
      photo: member.foto_url || null,
      role: member.tipo_usuario,
      points: pointsByProfile.get(member.id) || 0,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const apolloSales = apolloSalesRows.map((sale) => ({
    id: sale.id,
    name: sale.nome,
    product: sale.vendido,
    value: Number(sale.valor || 0),
    at: sale.created_at,
  }));
  const apolloRevenue = apolloSales.reduce((sum, sale) => sum + sale.value, 0);

  return NextResponse.json({
    month,
    today,
    updatedAt: new Date().toISOString(),
    kripto: {
      revenue: { actual: revenue, goal: KRIPTO_REVENUE_GOAL },
      sales: { actual: monthClosed.length, goal: KRIPTO_SALES_GOAL },
      calls: {
        actual: teamCalls,
        goal: KRIPTO_CALLS_PER_SDR_GOAL * Math.max(1, activeSdrs.length),
        perSdrGoal: KRIPTO_CALLS_PER_SDR_GOAL,
        answered: teamAnswered,
      },
      noShow: { actual: percent(noShows, scheduled), limit: KRIPTO_NO_SHOW_LIMIT, count: noShows, scheduled },
      conversion: { actual: percent(monthClosed.length, qualifiedMeetings), goal: KRIPTO_CONVERSION_GOAL, qualifiedMeetings },
      callsRanking,
      salesRanking,
    },
    apollo: {
      revenue: { actual: apolloRevenue, goal: APOLLO_GOAL, superGoal: APOLLO_SUPER_GOAL },
      salesCount: apolloSales.length,
      members: apolloMembers,
      sales: apolloSales.slice(0, 6),
    },
  });
}
