import 'server-only';

import { sendApoloWhatsApp } from '@/lib/apoloNotifications';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type CommercialAiSessionStatus = 'ativa' | 'repassada' | 'humano' | 'encerrada' | 'erro';

export type CommercialAiSession = {
  lead_id: string;
  conversa_id: string | null;
  status: CommercialAiSessionStatus;
  motivo: string | null;
  perguntas_feitas: number;
  abertura_enviada_at: string | null;
  ultima_mensagem_ia_at: string | null;
  ultima_mensagem_lead_at: string | null;
  bloqueado_ate: string | null;
  repassado_sdr_id: string | null;
  repassado_at: string | null;
};

const MISSING_TABLE = /comercial_ia_sessoes|schema cache|does not exist/i;

/**
 * Trava o turno da IA no banco. Devolve false quando outro processo ja esta
 * respondendo este lead. Substitui o Map em memoria, que nao valia para mais
 * de uma instancia do app nem sobrevivia a restart.
 */
export async function claimCommercialAiTurn(leadId: string, ttlSeconds = 45) {
  const { data, error } = await supabaseAdmin.rpc('claim_comercial_ia_turno', {
    p_lead_id: leadId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    // Migration ainda nao aplicada: seguir sem lock e melhor do que deixar a
    // operacao muda, mas precisa aparecer no log.
    if (MISSING_TABLE.test(error.message)) {
      console.error('[commercial_ai_session] claim indisponivel, rode a migration 2026-08-18_comercial_ia_sessao.sql:', error.message);
      return true;
    }
    throw new Error(`Nao consegui travar o turno da IA comercial: ${error.message}`);
  }
  return data === true;
}

export async function releaseCommercialAiTurn(leadId: string) {
  const { error } = await supabaseAdmin.rpc('release_comercial_ia_turno', { p_lead_id: leadId });
  if (error && !MISSING_TABLE.test(error.message)) {
    console.error('[commercial_ai_session] release falhou:', error.message);
  }
}

export async function getCommercialAiSession(leadId: string) {
  const { data, error } = await supabaseAdmin
    .from('comercial_ia_sessoes')
    .select('*')
    .eq('lead_id', leadId)
    .maybeSingle();
  if (error && !MISSING_TABLE.test(error.message)) throw error;
  return (data as CommercialAiSession | null) || null;
}

export async function patchCommercialAiSession(leadId: string, patch: Partial<CommercialAiSession>) {
  const { error } = await supabaseAdmin
    .from('comercial_ia_sessoes')
    .upsert([{ lead_id: leadId, ...patch, updated_at: new Date().toISOString() }], { onConflict: 'lead_id' });
  if (error && !MISSING_TABLE.test(error.message)) {
    console.error('[commercial_ai_session] update falhou:', error.message);
  }
}

/**
 * A IA so fala quando a sessao esta ativa ou ainda nem existe. Repassada,
 * assumida por humano ou encerrada significa silencio definitivo.
 */
export function canCommercialAiSpeak(session: CommercialAiSession | null) {
  if (!session) return true;
  return session.status === 'ativa';
}

/**
 * SDR respondeu pelo inbox: a IA cala na hora e nao volta.
 * Antes disso o comercial dependia de uma janela de 90 segundos, e a IA
 * voltava a escrever por cima do atendimento humano depois disso.
 */
export async function stopCommercialAiForHumanTakeover(leadId: string, humanName?: string | null) {
  const session = await getCommercialAiSession(leadId);
  if (!session || session.status !== 'ativa') return { stopped: false };

  const quem = String(humanName || '').trim() || 'A equipe comercial';
  await patchCommercialAiSession(leadId, {
    status: 'humano',
    motivo: `${quem} assumiu o atendimento pelo inbox.`,
    bloqueado_ate: null,
  });
  await recordCommercialTimelineEvent({
    leadId,
    type: 'ia_encerrada_humano',
    description: `${quem} assumiu a conversa e a IA SDR foi interrompida.`,
    metadata: { perguntas_feitas: session.perguntas_feitas },
  });
  return { stopped: true };
}

/**
 * Repasse ao SDR: marca a sessao, avisa o responsavel pelo Apolo e registra na
 * timeline. Depois disso a IA nao fala mais nesta conversa.
 */
export async function handoffCommercialAiToSdr(leadId: string, reason: string, summary?: string | null) {
  const { data: lead } = await supabaseAdmin
    .from('comercial_leads')
    .select('id,nome,telefone,email,empresa,status,sdr_id,faturamento_mensal,investimento,prioridade,vidas,ja_investiu_trafego,observacoes')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead?.id) return { handed: false, reason: 'lead_nao_encontrado' };

  await patchCommercialAiSession(leadId, {
    status: 'repassada',
    motivo: reason,
    repassado_sdr_id: lead.sdr_id || null,
    repassado_at: new Date().toISOString(),
    bloqueado_ate: null,
  });

  if (summary) {
    const merged = [lead.observacoes, `Qualificacao da IA: ${summary}`].filter(Boolean).join(' | ');
    await supabaseAdmin
      .from('comercial_leads')
      .update({ observacoes: merged, updated_at: new Date().toISOString() })
      .eq('id', leadId);
  }

  await recordCommercialTimelineEvent({
    leadId,
    type: 'ia_repassou_sdr',
    description: `IA SDR repassou o lead: ${reason}`,
    metadata: { sdr_id: lead.sdr_id, resumo: summary || null },
  });

  if (!lead.sdr_id) return { handed: true, notified: false, reason: 'lead_sem_sdr' };

  const { data: sdrProfile } = await supabaseAdmin
    .from('profiles')
    .select('id,nome,email,tipo_usuario,telefone')
    .eq('id', lead.sdr_id)
    .maybeSingle();
  if (!sdrProfile) return { handed: true, notified: false, reason: 'sdr_sem_profile' };

  const message = [
    'A IA acabou de qualificar um lead e ele e seu agora.',
    '',
    `Nome: ${lead.nome || 'Nao informado'}`,
    `Telefone: ${lead.telefone || 'Nao informado'}`,
    `Vidas na carteira: ${lead.vidas || 'Nao informado'}`,
    `Trafego pago: ${lead.ja_investiu_trafego || 'Nao informado'}`,
    `Prioridade: ${lead.prioridade || 'Nao informada'}`,
    '',
    `Motivo do repasse: ${reason}`,
    summary ? '' : null,
    summary ? summary : null,
    '',
    'A conversa esta aberta no inbox comercial e a IA ja parou de responder.',
  ].filter((line) => line !== null).join('\n');

  const delivery = await sendApoloWhatsApp({
    type: 'novo_lead',
    title: 'Lead qualificado pela IA',
    message,
    profiles: [sdrProfile],
    respectPreferences: false,
  });

  return { handed: true, notified: delivery.some((item) => item.status === 'success') };
}
