import { supabaseAdmin } from '@/lib/supabase/admin';
import { COMMERCIAL_MASTER_INSTANCE, normalizePhone, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';
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
    const [{ data: lead, error: leadError }, { data: config, error: configError }] = await Promise.all([
      supabaseAdmin.from('comercial_leads').select('id,nome,telefone,sdr_id').eq('id', leadId).maybeSingle(),
      // O remetente comercial e o numero oficial da Orion. Ele nao depende de
      // um perfil de corretor/coordenador selecionado na configuracao.
      supabaseAdmin.from('comercial_config').select('bot_comercial_ativo,bot_comercial_prompt').eq('id', 1).maybeSingle(),
    ]);

    if (leadError) throw new Error(`Nao consegui ler o lead do bot: ${leadError.message}`);
    if (configError) throw new Error(`Nao consegui ler a configuracao do bot: ${configError.message}`);
    if (!lead?.id || !normalizePhone(lead.telefone)) return { started: false, reason: 'lead_without_phone' };
    if (!config) return { started: false, reason: 'bot_config_not_found' };
    if (config.bot_comercial_ativo !== true) return { started: false, reason: 'bot_disabled' };

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
    const instance = lead.sdr_id ? uazapiInstanceName(lead.sdr_id) : COMMERCIAL_MASTER_INSTANCE;
    const providerPayload = await uazapiFetch('/send/text', {
      method: 'POST',
      body: JSON.stringify({ number: phone, text: message, delay: 1200 }),
    }, { instanceName: instance });

    const { error: messageError } = await supabaseAdmin.from('whatsapp_mensagens').insert({
      conversa_id: conversation.id,
      direction: 'outbound',
      remetente: 'Orion',
      mensagem: message,
      provider_message_id: String(providerPayload?.messageId || providerPayload?.id || providerPayload?.key?.id || ''),
      metadata: { commercial_bot_first_contact: true, ai_agent: 'commercial_bot', provider: 'uazapi', instance, sdr_id: lead.sdr_id },
    });
    if (messageError) throw new Error(`Mensagem enviada, mas nao foi registrada no Inbox: ${messageError.message}`);
    const { error: conversationError } = await supabaseAdmin.from('whatsapp_conversas').update({ ultima_mensagem: message, ultima_mensagem_at: new Date().toISOString() }).eq('id', conversation.id);
    if (conversationError) throw new Error(`Mensagem enviada, mas nao foi atualizada no Inbox: ${conversationError.message}`);
    return { started: true, conversation_id: conversation.id };
  } finally {
    locks.delete(leadId);
  }
}
