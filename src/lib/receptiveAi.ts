import 'server-only';
import { openaiFetch } from '@/lib/openaiUso';
import { startLeadAiIfEligible } from '@/lib/leadAiAgent';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, uazapiFetch } from '@/lib/uazapi';
import { normalizeWhatsAppMessageId } from '@/lib/whatsappMessageId';

type ReceptiveProfile = {
  id: string;
  corretor_id: string | null;
  nome_empresa?: string | null;
};

type ReceptiveConfig = {
  corretora_id: string;
  corretora_nome: string;
  persona: string;
};

const BUTTON_AD = 'orion_receptive_ad';
const BUTTON_INDICATION = 'orion_receptive_indication';
const BUTTON_INSTAGRAM = 'orion_receptive_instagram';
const BUTTON_ORGANIC = 'orion_receptive_organic';

function normalized(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function deepValue(value: unknown, keys: string[], depth = 0): string {
  if (!value || depth > 5) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepValue(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key.toLowerCase()) && typeof item === 'string' && item.trim()) return item.trim();
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = deepValue(item, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

function isClickToWhatsAppAd(payload: unknown) {
  const referral = deepValue(payload, ['source_type', 'sourceurl', 'source_url', 'ctwa_clid', 'ctwa_clid']);
  return normalized(referral).includes('ad') || Boolean(referral);
}

function selectedOrigin(payload: unknown, text: string) {
  const selected = normalized(deepValue(payload, ['buttonorlistid', 'buttonid', 'selectedid', 'selected_id', 'id']));
  const combined = `${selected} ${normalized(text)}`;
  if (combined.includes(BUTTON_AD) || combined.includes('vim por anuncio')) return 'anuncio';
  if (combined.includes(BUTTON_INDICATION) || combined.includes('indicacao')) return 'indicacao';
  if (combined.includes(BUTTON_INSTAGRAM) || combined.includes('instagram')) return 'instagram';
  if (combined.includes(BUTTON_ORGANIC) || combined.includes('outro')) return 'organico';
  return null;
}

export async function getReceptiveAiConfig(profile: ReceptiveProfile): Promise<ReceptiveConfig | null> {
  if (!profile.corretor_id || !profile.nome_empresa) return null;
  const { data: corretora } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .ilike('nome', profile.nome_empresa)
    .maybeSingle();
  if (!corretora) return null;

  const { data: config, error } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('persona, receptive_enabled')
    .eq('corretora_id', corretora.id)
    .eq('status', 'ativo')
    .maybeSingle();
  if (error || !config?.receptive_enabled) return null;

  return {
    corretora_id: corretora.id,
    corretora_nome: corretora.nome,
    persona: String(config.persona || 'Aline'),
  };
}

async function sendText(instance: string, conversationId: string, phone: string, sender: string, text: string, metadata: Record<string, unknown>) {
  const payload = await uazapiFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify({ number: normalizePhone(phone), text }),
  }, { instanceName: instance });
  await persistAiOutboundMessage({
    conversationId,
    sender,
    text,
    providerMessageId: String(payload?.messageId || payload?.id || payload?.key?.id || '') || null,
    metadata: { ...metadata, instance },
  });
}

async function persistAiOutboundMessage(options: {
  conversationId: string;
  sender: string;
  text: string;
  providerMessageId: string | null;
  metadata: Record<string, unknown>;
}) {
  const normalizedProviderMessageId = normalizeWhatsAppMessageId(options.providerMessageId) || null;
  const attributedMetadata = {
    ...options.metadata,
    ai_agent: options.sender,
    sender_name: options.sender,
    sender_type: 'ai',
  };
  const row = {
    conversa_id: options.conversationId,
    direction: 'outbound',
    remetente: options.sender,
    mensagem: options.text,
    provider_message_id: normalizedProviderMessageId,
    metadata: attributedMetadata,
  };
  const { error } = await supabaseAdmin.from('whatsapp_mensagens').insert(row);
  if (!error) return;
  if (error.code !== '23505' || !normalizedProviderMessageId) throw error;

  // O webhook pode confirmar a mensagem antes desta gravacao e atribui-la ao
  // perfil tecnico do WhatsApp. Nesse caso, preserve o registro confirmado,
  // mas corrija a autoria para a atendente que realmente enviou a mensagem.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('id, metadata')
    .eq('provider_message_id', normalizedProviderMessageId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw error;

  const { error: updateError } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .update({
      remetente: options.sender,
      mensagem: options.text,
      metadata: { ...(existing.metadata || {}), ...attributedMetadata },
    })
    .eq('id', existing.id);
  if (updateError) throw updateError;
}

async function sendOriginButtons(instance: string, conversationId: string, phone: string, persona: string) {
  const text = `Olá! Eu sou a ${persona}, da Unity Saúde. Para eu te direcionar certinho, como você chegou até a gente?`;
  const payload = await uazapiFetch('/send/menu', {
    method: 'POST',
    body: JSON.stringify({
      number: normalizePhone(phone),
      type: 'button',
      text,
      choices: [
        `VIM POR ANÚNCIO|${BUTTON_AD}`,
        `INDICAÇÃO|${BUTTON_INDICATION}`,
        `INSTAGRAM|${BUTTON_INSTAGRAM}`,
        `OUTRO|${BUTTON_ORGANIC}`,
      ],
      footerText: 'Unity Saúde',
    }),
  }, { instanceName: instance });
  await persistAiOutboundMessage({
    conversationId,
    sender: persona,
    text,
    providerMessageId: String(payload?.messageId || payload?.id || payload?.key?.id || '') || null,
    metadata: { instance, receptive_origin_buttons: true },
  });
}

async function createAdLead(options: { corretorId: string; phone: string; contactName: string; source: string }) {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({
      corretor_id: options.corretorId,
      nome: options.contactName || 'Contato WhatsApp',
      telefone: normalizePhone(options.phone),
      status: 'Oportunidade',
      origem: 'Orion',
      utm_source: 'meta',
      utm_medium: 'whatsapp',
      utm_campaign: options.source,
      data_entrada: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function respondToOrganicMessage(options: { conversationId: string; phone: string; instance: string; persona: string; corretoraNome: string; text: string }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;
  const { data: history } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('direction, mensagem')
    .eq('conversa_id', options.conversationId)
    .order('created_at', { ascending: false })
    .limit(12);
  const messages = (history || []).reverse().map((item) => ({
    role: item.direction === 'inbound' ? 'user' : 'assistant',
    content: String(item.mensagem || ''),
  }));
  const response = await openaiFetch('ia_receptiva_unity', 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.ORION_LEAD_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 280,
      messages: [{
        role: 'system',
        content: `Você é ${options.persona}, consultora humana da ${options.corretoraNome}. Atenda em português do Brasil, de forma curta, simpática e natural. Esta conversa é orgânica e ainda NÃO é um lead no CRM. Não diga que é IA e não afirme que criou cadastro. Colete somente o necessário para entender o interesse e responda uma pergunta por vez.`,
      }, ...messages],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const reply = String(payload?.choices?.[0]?.message?.content || '').trim();
  if (reply) await sendText(options.instance, options.conversationId, options.phone, options.persona, reply, { receptive_ai: true });
}

export async function handleReceptiveIncoming(options: {
  config: ReceptiveConfig;
  conversationId: string;
  corretorId: string;
  phone: string;
  contactName: string;
  instance: string;
  text: string;
  payload: unknown;
}) {
  const autoAd = isClickToWhatsAppAd(options.payload);
  const selected = selectedOrigin(options.payload, options.text);
  const origin = autoAd ? 'anuncio' : selected;

  const { data: session } = await supabaseAdmin
    .from('whatsapp_receptive_sessions')
    .upsert({
      conversa_id: options.conversationId,
      corretor_id: options.corretorId,
      telefone: normalizePhone(options.phone),
      origem: origin,
      state: origin ? 'origin_identified' : 'origin_pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'conversa_id' })
    .select('*')
    .single();

  if (origin === 'anuncio') {
    if (session?.lead_id) return;
    const lead = await createAdLead({
      corretorId: options.corretorId,
      phone: options.phone,
      contactName: options.contactName,
      source: autoAd ? 'click_to_whatsapp' : 'origem_confirmada_no_whatsapp',
    });
    await supabaseAdmin
      .from('whatsapp_receptive_sessions')
      .update({ lead_id: lead.id, state: 'lead_created', updated_at: new Date().toISOString() })
      .eq('conversa_id', options.conversationId);
    await supabaseAdmin
      .from('whatsapp_conversas')
      .update({ lead_id: lead.id, nome_contato: options.contactName || 'Contato WhatsApp', updated_at: new Date().toISOString() })
      .eq('id', options.conversationId);
    await startLeadAiIfEligible(lead.id, { entryChannel: 'whatsapp_ad' });
    return;
  }

  if (!origin) {
    if (session?.state !== 'origin_pending') return;
    await sendOriginButtons(options.instance, options.conversationId, options.phone, options.config.persona);
    return;
  }

  if (session?.state === 'origin_identified') {
    await supabaseAdmin.from('whatsapp_receptive_sessions')
      .update({ state: 'organic_ai_active', updated_at: new Date().toISOString() })
      .eq('conversa_id', options.conversationId);
    await sendText(options.instance, options.conversationId, options.phone, options.config.persona,
      'Perfeito. Me conta: você está buscando plano para quantas pessoas?',
      { receptive_ai: true, origin });
    return;
  }

  if (session?.state === 'organic_ai_active') {
    await respondToOrganicMessage({
      conversationId: options.conversationId,
      phone: options.phone,
      instance: options.instance,
      persona: options.config.persona,
      corretoraNome: options.config.corretora_nome,
      text: options.text,
    });
  }
}
