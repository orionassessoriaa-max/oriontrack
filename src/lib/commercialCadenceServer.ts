import { COMMERCIAL_CADENCE_POINTS, cadenceDay, mqlReserveStage, statusResolvesReturn } from '@/lib/commercialCadence';
import { getCommercialMqlLevel } from '@/lib/commercialQualification';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function ensureCommercialCadencePoints(leadId: string, day: number) {
  const rows = COMMERCIAL_CADENCE_POINTS.map((item) => ({
    lead_id: leadId,
    dia: day,
    ponto: item.point,
    canal: item.channel,
  }));
  const { error } = await supabaseAdmin
    .from('comercial_cadencia_pontos')
    .upsert(rows, { onConflict: 'lead_id,dia,ponto', ignoreDuplicates: true });
  if (error) throw error;
}

export async function reconcileOverdueCommercialReturns() {
  const now = new Date().toISOString();
  const { data: leads, error } = await supabaseAdmin
    .from('comercial_leads')
    .select('id,status,faturamento_mensal,investimento,retorno_agendado_at')
    .eq('retorno_status', 'agendado')
    .lt('retorno_agendado_at', now)
    .limit(200);
  if (error) {
    if (/retorno_status|retorno_agendado_at|schema cache/i.test(error.message)) return;
    throw error;
  }

  for (const lead of leads || []) {
    if (statusResolvesReturn(lead.status)) {
      await supabaseAdmin
        .from('comercial_leads')
        .update({ retorno_status: 'resolvido', updated_at: now })
        .eq('id', lead.id)
        .eq('retorno_status', 'agendado');
      continue;
    }

    const level = getCommercialMqlLevel(lead.faturamento_mensal, lead.investimento);
    const stage = mqlReserveStage(level);
    const { data: updated } = await supabaseAdmin
      .from('comercial_leads')
      .update({
        status: stage,
        mql_reserva: level,
        retorno_status: 'nao_resolvido',
        cadencia_ativa: false,
        cadencia_fim_at: now,
        updated_at: now,
      })
      .eq('id', lead.id)
      .eq('retorno_status', 'agendado')
      .select('id')
      .maybeSingle();
    if (!updated) continue;

    await supabaseAdmin
      .from('comercial_tarefas')
      .update({ status: 'cancelada', updated_at: now })
      .eq('lead_id', lead.id)
      .eq('tipo', 'retorno')
      .eq('status', 'pendente');
    await recordCommercialTimelineEvent({
      leadId: lead.id,
      type: 'return_unresolved',
      description: `Retorno não resolvido — lead movido para MQL ${level}.`,
      metadata: { mql: level, retorno_agendado_at: lead.retorno_agendado_at },
    });
  }
}

export function activeCadenceDay(startValue: string | null | undefined) {
  return cadenceDay(startValue);
}
