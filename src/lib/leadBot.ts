import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { configureUazapiWebhook, normalizePhone, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';

type LeadRow = {
  id: string;
  corretor_id: string | null;
  responsavel_profile_id?: string | null;
  nome: string | null;
  telefone: string | null;
  idades?: string | null;
  cidade?: string | null;
  operadora?: string | null;
  possui_cnpj?: string | null;
  cnpj?: string | null;
  tem_plano_ativo?: string | null;
  plano_atual?: string | null;
  investimento?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
};

type ProfileRow = {
  id: string;
  nome: string | null;
  email?: string | null;
  tipo_usuario: string | null;
  telefone?: string | null;
  corretor_id?: string | null;
  nome_empresa?: string | null;
  status?: string | null;
};

type BrokerRow = {
  id: string;
  nome: string | null;
  nome_empresa: string | null;
};

type BotConfig = {
  id: string;
  corretora_id: string;
  nome: string;
  trigger_key: string;
  primeira_mensagem: string;
  fluxo?: unknown;
  status: string;
  sender_mode?: 'automatic' | 'profile' | 'dedicated' | null;
  sender_profile_id?: string | null;
  dedicated_instance_name?: string | null;
  corretoras?: { nome: string } | { nome: string }[] | null;
};

type ConversationRow = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
};

const DEFAULT_BOT_MESSAGE = `Olá, {primeiro_nome}! Tudo bem?

Você acabou de preencher nosso formulário para planos de saúde.

Logo um de nossos especialistas entrará em contato para te ajudar.`;

function firstName(value?: string | null) {
  return String(value || 'tudo bem').trim().split(/\s+/)[0] || 'tudo bem';
}

function normalizeNameKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function readCorretoraName(config?: BotConfig | null) {
  const raw = config?.corretoras;
  if (Array.isArray(raw)) return raw[0]?.nome || '';
  return raw?.nome || '';
}

function polishOutboundText(text: string) {
  let polished = String(text || '')
    .replace(/\bOla\b/gi, 'Olá')
    .replace(/\bvoce\b/gi, 'você')
    .replace(/\bformulario\b/gi, 'formulário')
    .replace(/\bsaude\b/gi, 'saúde')
    .replace(/\bentrara\b/gi, 'entrará')
    .replace(/\bcotacao\b/gi, 'cotação')
    .replace(/\bsimulacao\b/gi, 'simulação')
    .replace(/\binformacoes\b/gi, 'informações')
    .replace(/\bnao\b/gi, 'não')
    .replace(/\btambem\b/gi, 'também')
    .replace(/\bhorario\b/gi, 'horário')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,.!?;:])(?=\S)/g, '$1 ')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  if (!polished) return '';

  polished = polished.replace(/(^|[.!?]\s+)([a-záàâãéêíóôõúç])/g, (_full, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
  if (!/[.!?)]$/.test(polished)) polished += '.';

  return polished;
}

function renderBotMessage(template: string | null | undefined, lead: LeadRow, corretoraName: string) {
  const safeTemplate = template || DEFAULT_BOT_MESSAGE;
  const replacements: Record<string, string> = {
    nome: lead.nome || '',
    primeiro_nome: firstName(lead.nome),
    telefone: normalizePhone(lead.telefone),
    idades: lead.idades || '',
    cidade: lead.cidade || '',
    operadora: lead.operadora || lead.utm_term || lead.utm_content || '',
    concessionaria: corretoraName,
  };

  const rendered = Object.entries(replacements).reduce(
    (message, [key, value]) => message.replace(new RegExp(`\\{${key}\\}`, 'gi'), value),
    safeTemplate
  );

  return polishOutboundText(rendered);
}

async function findBroker(corretorId?: string | null) {
  if (!corretorId) return null;

  const { data } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  return data as BrokerRow | null;
}

async function findBotConfig(nomeEmpresa?: string | null) {
  if (!nomeEmpresa) return null;
  const targetName = normalizeNameKey(nomeEmpresa);

  const { data: corretoras } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .eq('status', 'ativo');

  const corretora = (corretoras || []).find((item) => normalizeNameKey(item.nome) === targetName);

  if (!corretora?.id) return null;

  const { data } = await supabaseAdmin
    .from('corretora_bot_configs')
    .select('*, corretoras(nome)')
    .eq('corretora_id', corretora.id)
    .eq('status', 'ativo')
    .maybeSingle();

  return data as BotConfig | null;
}

async function findBotSender(params: {
  responsavelProfileId?: string | null;
  configuredProfileId?: string | null;
  corretorId?: string | null;
  nomeEmpresa?: string | null;
}) {
  const { responsavelProfileId, configuredProfileId, corretorId, nomeEmpresa } = params;

  if (configuredProfileId) {
    const { data: configuredProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, tipo_usuario, telefone, corretor_id, nome_empresa, status')
      .eq('id', configuredProfileId)
      .in('status', ['active', 'ativo', 'Ativo'])
      .maybeSingle();
    if (configuredProfile?.id) return configuredProfile as ProfileRow;
    return null;
  }

  if (responsavelProfileId) {
    const { data: responsibleProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, tipo_usuario, telefone, corretor_id, nome_empresa, status')
      .eq('id', responsavelProfileId)
      .in('status', ['active', 'ativo', 'Ativo'])
      .maybeSingle();

    if (responsibleProfile?.id) return responsibleProfile as ProfileRow;
  }

  let query = supabaseAdmin
    .from('profiles')
    .select('id, nome, email, tipo_usuario, telefone, corretor_id, nome_empresa, status')
    .in('tipo_usuario', ['corretor_admin', 'corretor', 'corretor_membro'])
    .in('status', ['active', 'ativo', 'Ativo']);

  if (nomeEmpresa) {
    query = query.eq('nome_empresa', nomeEmpresa);
  } else if (corretorId) {
    query = query.eq('corretor_id', corretorId);
  } else {
    return null;
  }

  const { data } = await query.order('tipo_usuario', { ascending: true });
  const profiles = (data || []) as ProfileRow[];

  return profiles.find((profile) => profile.tipo_usuario === 'corretor_admin') || profiles[0] || null;
}

async function getOrCreateConversation(lead: LeadRow) {
  const phone = normalizePhone(lead.telefone);
  if (!phone) return null;

  const { data: existing } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('id, lead_id, corretor_id')
    .eq('lead_id', lead.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing as ConversationRow;

  const { data: byPhone } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('id, lead_id, corretor_id')
    .eq('telefone', phone)
    .eq('corretor_id', lead.corretor_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byPhone?.id) {
    if (!byPhone.lead_id) {
      await supabaseAdmin
        .from('whatsapp_conversas')
        .update({ lead_id: lead.id, nome_contato: lead.nome || null })
        .eq('id', byPhone.id);
    }
    return byPhone as ConversationRow;
  }

  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .insert({
      lead_id: lead.id,
      corretor_id: lead.corretor_id,
      telefone: phone,
      nome_contato: lead.nome || 'Lead',
      status: 'aberta',
      ultima_mensagem_at: new Date().toISOString(),
    })
    .select('id, lead_id, corretor_id')
    .single();

  if (error) throw error;
  return data as ConversationRow;
}

async function alreadySentFirstContact(conversationId: string) {
  const { data } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('id, metadata')
    .eq('conversa_id', conversationId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(30);

  return (data || []).some((message: any) => message.metadata?.bot_first_contact === true);
}

async function insertMessage(
  conversation: ConversationRow,
  text: string,
  sender: ProfileRow,
  providerPayload: any,
  instanceName: string
) {
  const providerId =
    providerPayload?.messageId ||
    providerPayload?.id ||
    providerPayload?.message?.id ||
    providerPayload?.key?.id ||
    randomUUID();

  const { error } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .insert({
      conversa_id: conversation.id,
      direction: 'outbound',
      remetente: sender.nome || 'Bot',
      mensagem: text,
      provider_message_id: String(providerId),
      metadata: {
        bot_first_contact: true,
        bot_sender_profile_id: sender.id,
        bot_sender_instance_name: instanceName,
        provider: 'uazapi',
        raw: providerPayload,
      },
    });

  if (error) throw error;

  await supabaseAdmin
    .from('whatsapp_conversas')
    .update({
      ultima_mensagem: text,
      ultima_mensagem_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);
}

async function sendBotText(instanceName: string, phone: string, text: string) {
  await configureUazapiWebhook(instanceName);

  return uazapiFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify({
      number: normalizePhone(phone),
      text,
      delay: 1200,
    }),
  }, { instanceName });
}

export async function startLeadBotIfEligible(leadId: string) {
  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, responsavel_profile_id, nome, telefone, idades, cidade, operadora, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, utm_source, utm_medium, utm_campaign, utm_term, utm_content')
    .eq('id', leadId)
    .maybeSingle();

  if (error) throw error;
  if (!lead?.id) return { eligible: false, started: false, reason: 'Lead nao encontrado.' };
  if (!normalizePhone(lead.telefone)) return { eligible: false, started: false, reason: 'Lead sem telefone.' };
  if (!lead.corretor_id) return { eligible: false, started: false, reason: 'Lead sem concessionaria.' };

  const broker = await findBroker(lead.corretor_id);
  const config = await findBotConfig(broker?.nome_empresa);
  if (!config?.id) return { eligible: false, started: false, reason: 'Bot nao configurado para a concessionaria.' };

  const sender = await findBotSender({
    responsavelProfileId: lead.responsavel_profile_id,
    configuredProfileId: config.sender_mode === 'profile' ? config.sender_profile_id : null,
    corretorId: lead.corretor_id,
    nomeEmpresa: broker?.nome_empresa,
  });
  if (!sender?.id) return { eligible: false, started: false, reason: 'Admin do bot nao encontrado.' };

  const instanceName = config.sender_mode === 'dedicated'
    ? String(config.dedicated_instance_name || '').trim()
    : uazapiInstanceName(sender.id);
  if (!instanceName) return { eligible: false, started: false, reason: 'WhatsApp do bot nao configurado.' };

  const conversation = await getOrCreateConversation(lead as LeadRow);
  if (!conversation?.id) return { eligible: false, started: false, reason: 'Conversa nao criada.' };

  if (await alreadySentFirstContact(conversation.id)) {
    return { eligible: true, started: false, reason: 'Primeiro atendimento ja enviado.' };
  }

  const message = renderBotMessage(config.primeira_mensagem, lead as LeadRow, readCorretoraName(config));
  const providerPayload = await sendBotText(instanceName, lead.telefone, message);
  await insertMessage(conversation, message, sender, providerPayload, instanceName);

  return {
    eligible: true,
    started: true,
    conversation_id: conversation.id,
    sender_profile_id: sender.id,
    sender_instance_name: instanceName,
    config_id: config.id,
  };
}
