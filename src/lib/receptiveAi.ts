import 'server-only';
import { startLeadAiIfEligible } from '@/lib/leadAiAgent';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, sendUazapiTypingPresence, uazapiFetch } from '@/lib/uazapi';
import { normalizeWhatsAppMessageId } from '@/lib/whatsappMessageId';
import { assinarMensagem } from '@/lib/atendimentoCompartilhado';
import { isClickToWhatsAppAd } from '@/lib/receptiveAdDetection';

type ReceptiveProfile = {
  id: string;
  corretor_id: string | null;
  nome_empresa?: string | null;
};

type ReceptiveConfig = {
  corretora_id: string;
  corretora_nome: string;
  persona: string;
  sender_profile_id: string | null;
};

const BUTTON_BENEFICIARY = 'orion_receptive_beneficiary';
const BUTTON_SALES = 'orion_receptive_sales';

type EntryChoice = 'beneficiary' | 'sales';
type LeadSource = 'redes_sociais' | 'google_site' | 'indicacao' | 'evento_panfleto' | 'sindicato_conselho' | 'outro';

type ReceptiveResult = {
  handled: boolean;
  leadId?: string | null;
  state?: string;
};

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

function selectedEntry(payload: unknown, text: string): EntryChoice | null {
  const selected = normalized(deepValue(payload, ['buttonorlistid', 'buttonid', 'selectedid', 'selected_id', 'id']));
  const combined = `${selected} ${normalized(text)}`;
  if (combined.includes(BUTTON_BENEFICIARY) || /^\s*1\s*$/.test(text) || combined.includes('ja sou beneficiario')) return 'beneficiary';
  if (combined.includes(BUTTON_SALES) || /^\s*2\s*$/.test(text) || combined.includes('quero contratar') || combined.includes('conhecer nossos planos')) return 'sales';
  return null;
}

function selectedSource(text: string): LeadSource | null {
  const value = normalized(text);
  if (/facebook|instagram|redes? sociais|rede social/.test(value)) return 'redes_sociais';
  if (/google|site/.test(value)) return 'google_site';
  if (/indicacao|indicado|amigo|familiar/.test(value)) return 'indicacao';
  if (/evento|panfleto/.test(value)) return 'evento_panfleto';
  if (/sindicato|conselho/.test(value)) return 'sindicato_conselho';
  if (/outro/.test(value)) return 'outro';
  return null;
}

function sourceFields(source: LeadSource) {
  const labels: Record<LeadSource, { utm_source: string; utm_campaign: string }> = {
    redes_sociais: { utm_source: 'redes_sociais', utm_campaign: 'contato_organico_whatsapp' },
    google_site: { utm_source: 'google_site', utm_campaign: 'contato_organico_whatsapp' },
    indicacao: { utm_source: 'indicacao', utm_campaign: 'contato_organico_whatsapp' },
    evento_panfleto: { utm_source: 'evento_panfleto', utm_campaign: 'contato_organico_whatsapp' },
    sindicato_conselho: { utm_source: 'sindicato_conselho', utm_campaign: 'contato_organico_whatsapp' },
    outro: { utm_source: 'outro', utm_campaign: 'contato_organico_whatsapp' },
  };
  return labels[source];
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
    .select('persona, receptive_enabled, sender_profile_id')
    .eq('corretora_id', corretora.id)
    .eq('status', 'ativo')
    .maybeSingle();
  if (error || !config?.receptive_enabled) return null;

  return {
    corretora_id: corretora.id,
    corretora_nome: corretora.nome,
    persona: String(config.persona || 'Aline'),
    sender_profile_id: config.sender_profile_id || null,
  };
}

async function sendText(instance: string, conversationId: string, phone: string, sender: string, text: string, metadata: Record<string, unknown>) {
  const whatsappText = assinarMensagem(text, sender);
  await sendUazapiTypingPresence(instance, phone, whatsappText);
  const payload = await uazapiFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify({ number: normalizePhone(phone), text: whatsappText }),
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

async function sendEntryButtons(instance: string, conversationId: string, phone: string, persona: string) {
  const text = `Olá! Eu sou a ${persona}, da Unity Saúde. Para eu te direcionar corretamente, escolha uma opção:`;
  const whatsappText = assinarMensagem(text, persona);
  await sendUazapiTypingPresence(instance, phone, whatsappText);
  const payload = await uazapiFetch('/send/menu', {
    method: 'POST',
    body: JSON.stringify({
      number: normalizePhone(phone),
      type: 'button',
      text: whatsappText,
      choices: [
        `JÁ SOU BENEFICIÁRIO|${BUTTON_BENEFICIARY}`,
        `QUERO CONTRATAR UM PLANO|${BUTTON_SALES}`,
      ],
      footerText: 'Unity Saúde',
    }),
  }, { instanceName: instance });
  await persistAiOutboundMessage({
    conversationId,
    sender: persona,
    text,
    providerMessageId: String(payload?.messageId || payload?.id || payload?.key?.id || '') || null,
    metadata: { instance, receptive_entry_buttons: true },
  });
}

async function sendSourceQuestion(instance: string, conversationId: string, phone: string, persona: string) {
  await sendText(
    instance,
    conversationId,
    phone,
    persona,
    [
      'Como você conheceu a Unity Saúde?',
      '',
      '• Facebook ou Instagram',
      '• Google ou site',
      '• Indicação',
      '• Evento ou panfleto',
      '• Sindicato ou conselho',
      '• Outro',
    ].join('\n'),
    { receptive_source_question: true },
  );
}

async function sendBeneficiaryChannels(instance: string, conversationId: string, phone: string, persona: string) {
  await sendText(
    instance,
    conversationId,
    phone,
    persona,
    [
      'Somos um canal de vendas, mas vou passar os contatos corretos para tirar suas dúvidas.',
      '',
      '*Boletos para CNPJ, carteirinha de CNPJ, reclamações e suporte:*',
      '(61) 3020-0320',
      '',
      '*Marcação de consultas, exames e consulta de rede:*',
      '(61) 3020-0804, apenas WhatsApp.',
      '',
      '*Para assuntos de contratos por CPF, fale com sua administradora:*',
      '',
      'Ctesk: (61) 99380-1944',
      'Esplendor: 0800 397 1799 ou (61) 2017-7011',
      'Extramed: (41) 3068-8700',
      'Grupo Contém: (21) 96774-1879',
      'Servix: (61) 3298-9000',
      '',
      'Obrigado pelo contato.',
    ].join('\n'),
    { receptive_beneficiary_channels: true },
  );
}

async function createSalesLead(options: { corretorId: string; phone: string; contactName: string; source: string; temporaryOwnerId?: string | null }) {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({
      corretor_id: options.corretorId,
      nome: options.contactName || 'Contato WhatsApp',
      telefone: normalizePhone(options.phone),
      status: 'Oportunidade',
      origem: 'Orion',
      utm_source: options.source === 'click_to_whatsapp' ? 'meta' : 'whatsapp',
      utm_medium: 'whatsapp',
      utm_campaign: options.source,
      // Evita que o trigger geral de rodizio entregue o lead antes da ISA
      // concluir a qualificacao. Logo depois do insert o dono temporario e
      // removido; no handoff o SDR ou vendedor correto sera definido.
      responsavel_profile_id: options.temporaryOwnerId || null,
      data_entrada: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  if (options.temporaryOwnerId) {
    const { error: releaseError } = await supabaseAdmin
      .from('leads')
      .update({ responsavel_profile_id: null, responsavel_membro_id: null })
      .eq('id', data.id);
    if (releaseError) throw releaseError;
  }
  return data;
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
  leadId?: string | null;
}): Promise<ReceptiveResult> {
  const autoAd = isClickToWhatsAppAd(options.payload);
  const entry = selectedEntry(options.payload, options.text);
  const { data: existingSession } = await supabaseAdmin
    .from('whatsapp_receptive_sessions')
    .select('*')
    .eq('conversa_id', options.conversationId)
    .maybeSingle();

  const ensureSession = async (state: string, updates: Record<string, unknown> = {}) => {
    const { data, error } = await supabaseAdmin
      .from('whatsapp_receptive_sessions')
      .upsert({
        conversa_id: options.conversationId,
        corretor_id: options.corretorId,
        telefone: normalizePhone(options.phone),
        state,
        updated_at: new Date().toISOString(),
        ...updates,
      }, { onConflict: 'conversa_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  };

  const linkLead = async (leadId: string, state: string, origin?: string | null) => {
    await ensureSession(state, { lead_id: leadId, origem: origin || null });
    const { error } = await supabaseAdmin
      .from('whatsapp_conversas')
      .update({
        lead_id: leadId,
        nome_contato: options.contactName || 'Contato WhatsApp',
        updated_at: new Date().toISOString(),
      })
      .eq('id', options.conversationId);
    if (error) throw error;
  };

  if (autoAd && existingSession?.state !== 'lead_created') {
    const leadId = options.leadId || existingSession?.lead_id || (await createSalesLead({
      corretorId: options.corretorId,
      phone: options.phone,
      contactName: options.contactName,
      source: 'click_to_whatsapp',
      temporaryOwnerId: options.config.sender_profile_id,
    })).id;
    await linkLead(leadId, 'lead_created', 'anuncio');
    await startLeadAiIfEligible(leadId, { entryChannel: 'whatsapp_ad' });
    return { handled: true, leadId, state: 'lead_created' };
  }

  // Leads que nasceram por formulario ou integracao externa seguem direto
  // para a IA comercial. O menu receptivo so controla conversas que ainda nao
  // eram lead ou que ja possuem uma sessao receptiva iniciada.
  if (options.leadId && !existingSession) {
    return { handled: false, leadId: options.leadId };
  }

  if (existingSession?.state === 'lead_created') {
    return { handled: false, leadId: options.leadId || existingSession.lead_id, state: 'lead_created' };
  }

  if (existingSession?.state === 'source_pending') {
    const source = selectedSource(options.text);
    if (!source) {
      await sendSourceQuestion(options.instance, options.conversationId, options.phone, options.config.persona);
      return { handled: true, leadId: options.leadId || existingSession.lead_id, state: 'source_pending' };
    }

    const leadId = options.leadId || existingSession.lead_id;
    if (!leadId) throw new Error('Lead comercial da recepcao nao foi criado.');
    const fields = sourceFields(source);
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ ...fields, utm_medium: 'whatsapp', updated_at: new Date().toISOString() })
      .eq('id', leadId);
    if (error) throw error;
    await ensureSession('lead_created', { lead_id: leadId, origem: source });
    await startLeadAiIfEligible(leadId, { entryChannel: 'whatsapp_organic' });
    return { handled: true, leadId, state: 'lead_created' };
  }

  if (entry === 'beneficiary') {
    await ensureSession('beneficiary_routed', { lead_id: null, origem: 'beneficiario_ativo' });
    await sendBeneficiaryChannels(options.instance, options.conversationId, options.phone, options.config.persona);
    return { handled: true, leadId: null, state: 'beneficiary_routed' };
  }

  if (entry === 'sales') {
    const leadId = options.leadId || existingSession?.lead_id || (await createSalesLead({
      corretorId: options.corretorId,
      phone: options.phone,
      contactName: options.contactName,
      source: 'contato_organico_whatsapp',
      temporaryOwnerId: options.config.sender_profile_id,
    })).id;
    await linkLead(leadId, 'source_pending');
    await sendSourceQuestion(options.instance, options.conversationId, options.phone, options.config.persona);
    return { handled: true, leadId, state: 'source_pending' };
  }

  if (existingSession?.state === 'beneficiary_routed') {
    return { handled: true, leadId: null, state: 'beneficiary_routed' };
  }

  await ensureSession('entry_pending');
  await sendEntryButtons(options.instance, options.conversationId, options.phone, options.config.persona);
  return { handled: true, leadId: null, state: 'entry_pending' };
}
