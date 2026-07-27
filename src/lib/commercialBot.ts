import { supabaseAdmin } from '@/lib/supabase/admin';
import { COMMERCIAL_MASTER_INSTANCE, normalizePhone, uazapiFetch } from '@/lib/uazapi';
import { ensureCommercialConversation, normalizeSdrText } from '@/lib/commercialInbox';

const DEFAULT_MESSAGE = 'Ola, {primeiro_nome}! Tudo bem?\n\nVi que voce acabou de preencher nosso formulario. Vou te fazer algumas perguntas bem rapidinhas para entender seu momento e te direcionar melhor, tudo bem?';
const locks = new Set<string>();

function firstName(value: unknown) {
  return String(value || 'tudo bem').trim().split(/\s+/)[0] || 'tudo bem';
}

function renderMessage(template: string, name: unknown) {
  return normalizeSdrText(template || DEFAULT_MESSAGE)
    .replace(/\{primeiro_nome\}/gi, firstName(name))
    .replace(/\{nome\}/gi, String(name || ''));
}

/** Envia somente a abertura do bot comercial para leads novos. */
export async function startCommercialBotIfEligible(leadId: string) {
  if (locks.has(leadId)) return { started: false, reason: 'duplicate_locked' };
  locks.add(leadId);

  try {
    const [{ data: lead }, { data: config }] = await Promise.all([
      supabaseAdmin.from('comercial_leads').select('id,nome,telefone').eq('id', leadId).maybeSingle(),
      supabaseAdmin.from('comercial_config').select('bot_comercial_ativo,bot_comercial_prompt,ia_sdr_profile_id').eq('id', 1).maybeSingle(),
    ]);

    if (!lead?.id || !normalizePhone(lead.telefone)) return { started: false, reason: 'lead_without_phone' };
    if (config?.bot_comercial_ativo !== true) return { started: false, reason: 'bot_disabled' };
    if (!config.ia_sdr_profile_id) return { started: false, reason: 'commercial_sender_not_configured' };

    const conversation = await ensureCommercialConversation(lead.telefone, lead.nome);
    const { data: existing } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('id,metadata')
      .eq('conversa_id', conversation.id)
      .eq('direction', 'outbound')
      .limit(30);
    if ((existing || []).some((item: any) => item.metadata?.commercial_bot_first_contact === true)) {
      return { started: false, reason: 'first_message_already_sent' };
    }

    const phone = normalizePhone(lead.telefone);
    const message = renderMessage(config.bot_comercial_prompt, lead.nome);
    const providerPayload = await uazapiFetch('/send/text', {
      method: 'POST',
      body: JSON.stringify({ number: phone, text: message, delay: 1200 }),
    }, { instanceName: COMMERCIAL_MASTER_INSTANCE });

    await supabaseAdmin.from('whatsapp_mensagens').insert({
      conversa_id: conversation.id,
      direction: 'outbound',
      remetente: 'Orion',
      mensagem: message,
      provider_message_id: String(providerPayload?.messageId || providerPayload?.id || providerPayload?.key?.id || ''),
      metadata: { commercial_bot_first_contact: true, ai_agent: 'commercial_bot', provider: 'uazapi' },
    });
    await supabaseAdmin.from('whatsapp_conversas').update({ ultima_mensagem: message, ultima_mensagem_at: new Date().toISOString() }).eq('id', conversation.id);
    return { started: true, conversation_id: conversation.id };
  } finally {
    locks.delete(leadId);
  }
}
