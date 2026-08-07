import { NextResponse } from "next/server";
import { requireCommercialUser } from "@/lib/api/comercial";
import { recordCommercialTimelineEvent } from "@/lib/commercialTimeline";
import { supabaseAdmin } from "@/lib/supabase/admin";

const CALL_STATUSES = new Set(["iniciada", "atendida", "nao_atendida", "concluida"]);

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  const leadId = String(body.lead_id || "").trim();
  if (!leadId) return NextResponse.json({ error: "Lead obrigatório." }, { status: 400 });

  let leadQuery = supabaseAdmin.from("comercial_leads").select("id,nome,sdr_id,closer_id").eq("id", leadId);
  if (guard.commercialRole === "sdr") leadQuery = leadQuery.eq("sdr_id", guard.profile.id);
  if (guard.commercialRole === "closer") leadQuery = leadQuery.eq("closer_id", guard.profile.id);
  const { data: lead } = await leadQuery.maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead não encontrado ou sem permissão." }, { status: 404 });

  const ownerId = guard.commercialRole === "coordenador"
    ? String(body.sdr_id || lead.sdr_id || guard.profile.id)
    : guard.profile.id;
  const { data, error } = await supabaseAdmin.from("comercial_ligacoes").insert({
    lead_id: leadId,
    sdr_id: ownerId,
    status: "iniciada",
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordCommercialTimelineEvent({
    leadId,
    actorId: guard.profile.id,
    type: "call_started",
    description: `${guard.profile.nome || "Equipe comercial"} iniciou uma ligação pelo CRM.`,
    metadata: { call_id: data.id, sdr_id: ownerId },
  });
  return NextResponse.json({ call: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const status = String(body.status || "").trim();
  if (!id || !CALL_STATUSES.has(status)) return NextResponse.json({ error: "Ligação ou resultado inválido." }, { status: 400 });

  let check = supabaseAdmin.from("comercial_ligacoes").select("id,lead_id,sdr_id").eq("id", id);
  if (guard.commercialRole !== "coordenador") check = check.eq("sdr_id", guard.profile.id);
  const { data: call } = await check.maybeSingle();
  if (!call) return NextResponse.json({ error: "Ligação não encontrada ou sem permissão." }, { status: 404 });

  const duration = body.duracao_segundos === null || body.duracao_segundos === undefined
    ? null
    : Math.max(0, Number(body.duracao_segundos) || 0);
  const { data, error } = await supabaseAdmin.from("comercial_ligacoes").update({
    status,
    duracao_segundos: duration,
    observacoes: String(body.observacoes || "").trim() || null,
    finalizada_at: status === "iniciada" ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ call: data });
}
