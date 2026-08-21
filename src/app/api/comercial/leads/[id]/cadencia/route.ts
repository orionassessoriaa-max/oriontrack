import { NextResponse } from "next/server";
import {
  applyCommercialLeadScope,
  requireCommercialUser,
} from "@/lib/api/comercial";
import { recordCommercialTimelineEvent } from "@/lib/commercialTimeline";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cadenceDayFromStage } from "@/lib/comercialCadencia";
import { commercialCadenceMaxDay } from "@/lib/commercialQualification";

const attemptTemplate = [
  { ordem: 1, canal: "ligacao_fixo", titulo: "Ligação (fixo)" },
  { ordem: 2, canal: "ligacao_fixo", titulo: "Ligação (fixo)" },
  { ordem: 3, canal: "ligacao_fixo", titulo: "Ligação (fixo)" },
  { ordem: 4, canal: "ligacao_whatsapp", titulo: "Ligação (WhatsApp)" },
  { ordem: 5, canal: "mensagem_whatsapp", titulo: "Mensagem (WhatsApp)" },
  { ordem: 6, canal: "audio_whatsapp", titulo: "Áudio (WhatsApp)" },
  { ordem: 7, canal: "ligacao_fixo", titulo: "Ligação (fixo)" },
  { ordem: 8, canal: "mensagem_whatsapp", titulo: "Mensagem (WhatsApp)" },
] as const;

async function allowedLead(
  id: string,
  guard: Awaited<ReturnType<typeof requireCommercialUser>>,
) {
  if ("error" in guard) return null;
  let query = supabaseAdmin
    .from("comercial_leads")
    .select(
      "id,status,sdr_id,closer_id,faturamento_mensal,investimento,status_started_at,contato_cadencia_ativa,contato_cadencia_inicio",
    )
    .eq("id", id);
  if (guard.commercialRole !== "coordenador")
    query = applyCommercialLeadScope(
      query,
      guard.commercialRole,
      guard.profile.id,
    );
  const { data } = await query.maybeSingle();
  return data;
}

async function ensureDay(leadId: string, day: number) {
  const rows = attemptTemplate.map((attempt) => ({
    lead_id: leadId,
    dia: day,
    ...attempt,
  }));
  const { error } = await supabaseAdmin
    .from("comercial_cadencia_tentativas")
    .upsert(rows, {
      onConflict: "lead_id,dia,ordem",
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

async function cadencePayload(lead: {
  id: string;
  status: string;
  faturamento_mensal: string | null;
  investimento: string | null;
  status_started_at: string | null;
  contato_cadencia_ativa: boolean;
  contato_cadencia_inicio: string | null;
}) {
  const stageDay = cadenceDayFromStage(lead.status);
  const maxDay = commercialCadenceMaxDay(lead.faturamento_mensal, lead.investimento);
  const limitReached = stageDay !== null && stageDay > maxDay;
  const active = stageDay !== null && !limitReached;
  const day = stageDay || 1;
  if (active) await ensureDay(lead.id, day);
  const { data, error } = await supabaseAdmin
    .from("comercial_cadencia_tentativas")
    .select("id,lead_id,dia,ordem,canal,titulo,status,concluido_at")
    .eq("lead_id", lead.id)
    .order("dia", { ascending: true })
    .order("ordem", { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const attempts = active ? rows.filter((item) => item.dia === day) : [];
  const historyDays = [...new Set(rows.map((item) => Number(item.dia)))]
    .filter((historyDay) => !active || historyDay !== day)
    .sort((left, right) => right - left);
  return {
    active,
    day,
    max_day: maxDay,
    limit_reached: limitReached,
    started_at: lead.status_started_at,
    completed: attempts.length > 0 && attempts.every((item) => item.status !== "pendente"),
    attempts,
    history: historyDays.map((historyDay) => {
      const historyAttempts = rows.filter((item) => item.dia === historyDay);
      const completedAttempts = historyAttempts.filter((item) => item.status !== "pendente").length;
      return {
        day: historyDay,
        completed: historyAttempts.length > 0 && completedAttempts === historyAttempts.length,
        completed_attempts: completedAttempts,
        attempts: historyAttempts,
      };
    }),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const lead = await allowedLead(id, guard);
  if (!lead)
    return NextResponse.json({ error: "Lead sem permissão." }, { status: 403 });
  try {
    return NextResponse.json({ cadence: await cadencePayload(lead) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar a cadência." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const lead = await allowedLead(id, guard);
  if (!lead)
    return NextResponse.json({ error: "Lead sem permissão." }, { status: 403 });
  const day = cadenceDayFromStage(lead.status);
  if (day === null)
    return NextResponse.json(
      { error: "A cadência só pode ser registrada nas etapas Dia 1 a Dia 10." },
      { status: 409 },
    );
  const maxDay = commercialCadenceMaxDay(lead.faturamento_mensal, lead.investimento);
  if (day > maxDay)
    return NextResponse.json(
      { error: `A cadência deste lead termina no Dia ${maxDay}. Mova-o para uma etapa fora da cadência.` },
      { status: 409 },
    );

  const body = await request.json().catch(() => ({}));
  const order = Number(body.ordem);
  const result = String(body.result || "");
  if (!Number.isInteger(order) || order < 1 || order > 8)
    return NextResponse.json({ error: "Tentativa inválida." }, { status: 400 });
  if (result !== "success" && result !== "no_answer")
    return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });

  try {
    await ensureDay(id, day);
    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from("comercial_cadencia_tentativas")
      .select("id,ordem,canal,titulo,status")
      .eq("lead_id", id)
      .eq("dia", day)
      .eq("ordem", order)
      .single();
    if (attemptError) throw attemptError;
    if (attempt.status !== "pendente")
      return NextResponse.json(
        { error: "Esta tentativa já foi concluída." },
        { status: 409 },
      );

    const isCall = String(attempt.canal).startsWith("ligacao");
    const status =
      result === "success"
        ? isCall
          ? "atendeu"
          : "respondeu"
        : isCall
          ? "nao_atendeu"
          : "sem_resposta";
    const concludedAt = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("comercial_cadencia_tentativas")
      .update({
        status,
        autor_id: guard.profile.id,
        concluido_at: concludedAt,
        updated_at: concludedAt,
      })
      .eq("id", attempt.id);
    if (updateError) throw updateError;

    if (result === "success") {
      const { error: remainingError } = await supabaseAdmin
        .from("comercial_cadencia_tentativas")
        .update({
          status: "nao_necessario",
          autor_id: guard.profile.id,
          concluido_at: concludedAt,
          updated_at: concludedAt,
        })
        .eq("lead_id", id)
        .eq("dia", day)
        .eq("status", "pendente");
      if (remainingError) throw remainingError;
    }

    const statusLabel: Record<string, string> = {
      atendeu: "atendeu",
      respondeu: "respondeu",
      nao_atendeu: "não atendeu",
      sem_resposta: "sem resposta",
    };
    await recordCommercialTimelineEvent({
      leadId: id,
      actorId: guard.profile.id,
      type: "cadencia_contato",
      description: `${order}. ${attempt.titulo} — ${statusLabel[status]}.`,
      metadata: { day, order, channel: attempt.canal, status },
    });
    if (result === "success")
      await recordCommercialTimelineEvent({
        leadId: id,
        actorId: guard.profile.id,
        type: "cadencia_dia_concluido",
        description: `Dia ${day} concluído — lead respondeu na ${order}ª tentativa; demais contatos marcados como não necessários.`,
        metadata: { day, answered_at_order: order },
      });

    return NextResponse.json({ cadence: await cadencePayload(lead) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar a cadência." },
      { status: 500 },
    );
  }
}
