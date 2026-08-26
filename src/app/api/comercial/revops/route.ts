import { NextResponse } from "next/server";
import { requireCommercialUser } from "@/lib/api/comercial";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signedRecordingUrl } from "@/lib/voipRecordingAccess";
import { maybeSyncVoipRecordings } from "@/lib/voipRecordingSync";

function normalized(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function inPeriod(value: unknown, start: string, end: string) {
  const date = String(value || "").slice(0, 10);
  return Boolean(date && date >= start && date <= end);
}

function isClosed(lead: Record<string, unknown>) {
  // Venda e o que esta na etapa de venda. Lead estornado volta de etapa e mantem
  // o valor no campo; contar pelo valor fazia ele seguir somando no relatorio.
  return normalized(lead.status) === "negocio fechado";
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard.error;
  try {
    await maybeSyncVoipRecordings();
  } catch (error) {
    console.error("[revops_voip_sync]", error instanceof Error ? error.message : error);
  }
  const url = new URL(request.url);
  const now = new Date();
  const start = url.searchParams.get("start") || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = url.searchParams.get("end") || now.toISOString().slice(0, 10);

  let leadQuery = supabaseAdmin.from("comercial_leads").select("*").order("data_entrada", { ascending: false }).limit(5000);
  let callQuery = supabaseAdmin.from("comercial_ligacoes")
    .select("id,lead_id,sdr_id,status,iniciada_at,finalizada_at,duracao_segundos,gravacao_url,observacoes,voip_record_id")
    .in("status", ["atendida", "nao_atendida", "concluida"])
    .or("origem.neq.click2call,voip_record_id.not.is.null")
    .gte("iniciada_at", `${start}T00:00:00-03:00`)
    .lte("iniciada_at", `${end}T23:59:59-03:00`)
    .order("iniciada_at", { ascending: false })
    .limit(3000);
  if (guard.commercialRole === "sdr") {
    leadQuery = leadQuery.eq("sdr_id", guard.profile.id);
    callQuery = callQuery.eq("sdr_id", guard.profile.id);
  }
  if (guard.commercialRole === "closer") leadQuery = leadQuery.eq("closer_id", guard.profile.id);

  const [leadResult, callResult, memberResult] = await Promise.all([
    leadQuery,
    callQuery,
    supabaseAdmin.from("comercial_membros").select("profile_id,papel,ativo").eq("ativo", true),
  ]);
  if (leadResult.error) return NextResponse.json({ error: leadResult.error.message }, { status: 500 });
  if (callResult.error) return NextResponse.json({ error: callResult.error.message }, { status: 500 });

  const allLeads = leadResult.data || [];
  const calls = callResult.data || [];
  const enteredLeads = allLeads.filter((lead) => inPeriod(lead.data_entrada, start, end));
  const scheduledLeads = allLeads.filter((lead) => inPeriod(lead.reuniao_agendada_at, start, end));
  const realizedLeads = allLeads.filter((lead) => inPeriod(lead.reuniao_realizada_at, start, end));
  const sales = allLeads.filter((lead) => isClosed(lead) && inPeriod(lead.fechado_at || lead.updated_at, start, end));

  const profileIds = Array.from(new Set([
    ...(memberResult.data || []).map((member) => member.profile_id),
    ...calls.map((call) => call.sdr_id),
    ...sales.map((lead) => lead.closer_id).filter(Boolean),
  ]));
  const { data: profiles } = profileIds.length
    ? await supabaseAdmin.from("profiles").select("id,nome,foto_url").in("id", profileIds)
    : { data: [] };
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const leadMap = new Map(allLeads.map((lead) => [lead.id, lead]));

  const sdrMembers = (memberResult.data || []).filter((member) => member.papel === "sdr"
    && (guard.commercialRole !== "sdr" || member.profile_id === guard.profile.id));
  const team = sdrMembers.map((member, index) => {
    const leads = enteredLeads.filter((lead) => lead.sdr_id === member.profile_id);
    const memberCalls = calls.filter((call) => call.sdr_id === member.profile_id);
    const meetings = scheduledLeads.filter((lead) => lead.sdr_id === member.profile_id);
    const realized = realizedLeads.filter((lead) => lead.sdr_id === member.profile_id);
    const sold = sales.filter((lead) => lead.sdr_id === member.profile_id);
    const noShows = meetings.reduce((sum, lead) => sum + Number(lead.no_show_count || (lead.no_show ? 1 : 0)), 0);
    const qualified = realized.filter((lead) => lead.reuniao_qualificada === true).length;
    const disqualified = realized.filter((lead) => lead.reuniao_qualificada === false).length;
    return {
      id: member.profile_id,
      name: profileMap.get(member.profile_id)?.nome || "SDR",
      photo: profileMap.get(member.profile_id)?.foto_url || null,
      color: ["#20a4f3", "#28d7a1", "#a78bfa", "#f0b84b", "#f06f86"][index % 5],
      leads: leads.length,
      calls: memberCalls.length,
      answeredCalls: memberCalls.filter((call) => ["atendida", "concluida"].includes(call.status)).length,
      meetings: meetings.length,
      realized: realized.length,
      noShows,
      qualified,
      disqualified,
      sales: sold.length,
      ...(guard.canViewCommercialFinancials ? {
        revenue: sold.reduce((sum, lead) => sum + Number(lead.valor_fechado || lead.valor_pago || 0), 0),
        receivedRevenue: sold.reduce((sum, lead) => sum + Number(lead.valor_pago || 0), 0),
      } : {}),
    };
  });

  const dailyMap = new Map<string, { date: string; leads: number; calls: number; meetings: number; realized: number; noShows: number; qualified: number; disqualified: number; sales: number; revenue: number }>();
  const day = (date: string) => {
    if (!dailyMap.has(date)) dailyMap.set(date, { date, leads: 0, calls: 0, meetings: 0, realized: 0, noShows: 0, qualified: 0, disqualified: 0, sales: 0, revenue: 0 });
    return dailyMap.get(date)!;
  };
  enteredLeads.forEach((lead) => { day(String(lead.data_entrada).slice(0, 10)).leads += 1; });
  calls.forEach((call) => { day(String(call.iniciada_at).slice(0, 10)).calls += 1; });
  scheduledLeads.forEach((lead) => {
    const row = day(String(lead.reuniao_agendada_at).slice(0, 10));
    row.meetings += 1;
    row.noShows += Number(lead.no_show_count || (lead.no_show ? 1 : 0));
  });
  realizedLeads.forEach((lead) => {
    const row = day(String(lead.reuniao_realizada_at).slice(0, 10));
    row.realized += 1;
    if (lead.reuniao_qualificada === true) row.qualified += 1;
    if (lead.reuniao_qualificada === false) row.disqualified += 1;
  });
  sales.forEach((lead) => {
    const row = day(String(lead.fechado_at || lead.updated_at).slice(0, 10));
    row.sales += 1;
    row.revenue += Number(lead.valor_fechado || lead.valor_pago || 0);
  });

  const revenue = sales.reduce((sum, lead) => sum + Number(lead.valor_fechado || lead.valor_pago || 0), 0);
  const receivedRevenue = sales.reduce((sum, lead) => sum + Number(lead.valor_pago || 0), 0);
  const paymentModels = ["tcv", "mrr", "mesclado"].map((model) => {
    const modelSales = sales.filter((lead) => normalized(lead.modelo_pagamento) === model);
    return {
      model,
      sales: modelSales.length,
      revenue: modelSales.reduce((sum, lead) => sum + Number(lead.valor_fechado || lead.valor_pago || 0), 0),
    };
  });
  const originMap = new Map<string, { origin: string; leads: number; scheduled: number; realized: number; noShows: number; qualified: number; disqualified: number; sales: number; revenue: number }>();
  const originName = (lead: Record<string, unknown>) => String(lead.origem || lead.utm_source || "Nao informado").trim() || "Nao informado";
  const originRow = (lead: Record<string, unknown>) => {
    const origin = originName(lead);
    if (!originMap.has(origin)) originMap.set(origin, { origin, leads: 0, scheduled: 0, realized: 0, noShows: 0, qualified: 0, disqualified: 0, sales: 0, revenue: 0 });
    return originMap.get(origin)!;
  };
  enteredLeads.forEach((lead) => { originRow(lead).leads += 1; });
  scheduledLeads.forEach((lead) => {
    originRow(lead).scheduled += 1;
    originRow(lead).noShows += Number(lead.no_show_count || (lead.no_show ? 1 : 0));
  });
  realizedLeads.forEach((lead) => {
    originRow(lead).realized += 1;
    if (lead.reuniao_qualificada === true) originRow(lead).qualified += 1;
    if (lead.reuniao_qualificada === false) originRow(lead).disqualified += 1;
  });
  sales.forEach((lead) => {
    originRow(lead).sales += 1;
    originRow(lead).revenue += Number(lead.valor_fechado || lead.valor_pago || 0);
  });
  const qualifiedMeetings = realizedLeads.filter((lead) => lead.reuniao_qualificada === true).length;
  const disqualifiedMeetings = realizedLeads.filter((lead) => lead.reuniao_qualificada === false).length;
  const fullyReceivedSales = sales.filter((lead) => Number(lead.valor_pago || 0) >= Number(lead.valor_fechado || lead.valor_pago || 0) && Number(lead.valor_pago || 0) > 0).length;
  return NextResponse.json({
    start,
    end,
    summary: {
      leads: enteredLeads.length,
      calls: calls.length,
      answeredCalls: calls.filter((call) => ["atendida", "concluida"].includes(call.status)).length,
      scheduled: scheduledLeads.length,
      realized: realizedLeads.length,
      qualified: qualifiedMeetings,
      disqualified: disqualifiedMeetings,
      noShows: scheduledLeads.reduce((sum, lead) => sum + Number(lead.no_show_count || (lead.no_show ? 1 : 0)), 0),
      sales: sales.length,
      fullyReceivedSales,
      ...(guard.canViewCommercialFinancials ? { revenue, receivedRevenue, receivableRevenue: Math.max(0, revenue - receivedRevenue), averageTicket: sales.length ? revenue / sales.length : 0 } : {}),
    },
    team,
    daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    calls: calls.slice(0, 200).map((call) => ({
      ...call,
      gravacao_url: call.voip_record_id ? signedRecordingUrl(Number(call.voip_record_id)) : call.gravacao_url,
      lead_name: leadMap.get(call.lead_id)?.nome || "Lead",
      lead_phone: leadMap.get(call.lead_id)?.telefone || null,
      sdr_name: profileMap.get(call.sdr_id)?.nome || "SDR",
    })),
    sales: sales.map((lead) => ({
      id: lead.id,
      lead_name: lead.nome,
      company: lead.empresa,
      sdr_name: profileMap.get(lead.sdr_id)?.nome || "Sem SDR",
      seller_name: profileMap.get(lead.closer_id)?.nome || "Não informado",
      closed_at: lead.fechado_at || lead.updated_at,
      meeting_at: lead.reuniao_realizada_at || lead.reuniao_agendada_at,
      origin: originName(lead),
      payment_model: lead.modelo_pagamento,
      ...(guard.canViewCommercialFinancials ? { amount: Number(lead.valor_fechado || lead.valor_pago || 0), received_amount: Number(lead.valor_pago || 0) } : {}),
    })),
    paymentModels: guard.canViewCommercialFinancials ? paymentModels : [],
    origins: Array.from(originMap.values()).sort((a, b) => b.leads - a.leads),
    canViewFinancials: guard.canViewCommercialFinancials,
    updatedAt: new Date().toISOString(),
  });
}
