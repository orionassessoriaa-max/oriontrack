import { supabaseAdmin } from '@/lib/supabase/admin';
import { evolutionFetch, evolutionInstanceName, getEvolutionInstanceApiKey, normalizePhone } from '@/lib/evolution';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

const AI_TEST_BROKERAGE = 'ORION TESTE';
const AI_PERSONA = 'Aline';

type ProfileRow = {
  id: string;
  nome: string | null;
  email?: string | null;
  email_real?: string | null;
  tipo_usuario: string | null;
  corretor_id?: string | null;
  nome_empresa?: string | null;
  telefone?: string | null;
};

type LeadRow = {
  id: string;
  corretor_id: string;
  nome: string | null;
  telefone: string | null;
  idades?: string | null;
  possui_cnpj?: string | null;
  cnpj?: string | null;
  tem_plano_ativo?: string | null;
  plano_atual?: string | null;
  investimento?: string | null;
  cidade?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  utm_campaign?: string | null;
  utm_medium?: string | null;
  utm_source?: string | null;
  responsavel_profile_id?: string | null;
};

function sameBrokerage(value?: string | null) {
  return String(value || '').trim().toUpperCase() === AI_TEST_BROKERAGE;
}

function plain(value?: unknown, fallback = 'Nao informado') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function adName(lead: LeadRow) {
  return plain(lead.utm_content || lead.utm_term || lead.utm_campaign || lead.utm_medium || lead.utm_source);
}

function leadFacts(lead: LeadRow) {
  return [
    `Nome: ${plain(lead.nome)}`,
    `Telefone: ${plain(lead.telefone)}`,
    `Idade(s): ${plain(lead.idades)}`,
    `Cidade: ${plain(lead.cidade)}`,
    `Possui CNPJ/MEI: ${plain(lead.possui_cnpj)}`,
    lead.cnpj ? `CNPJ informado: ${lead.cnpj}` : null,
    `Investimento pretendido: ${plain(lead.investimento)}`,
    `Tem plano de saude: ${plain(lead.tem_plano_ativo)}`,
    `Plano atual: ${plain(lead.plano_atual)}`,
    `Anuncio: ${adName(lead)}`,
  ].filter(Boolean).join('\n');
}

function splitReply(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function parseAiJson(raw: string) {
  const clean = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    return { reply: clean, handoff: false, summary: '' };
  }
}

async function findBroker(corretorId: string) {
  const { data } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  return data;
}

async function findLucasAdmin(corretorId: string): Promise<ProfileRow | null> {
  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  if (!sameBrokerage(broker?.nome_empresa)) return null;

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
    .eq('nome_empresa', AI_TEST_BROKERAGE)
    .ilike('nome', '%LUCAS%')
    .in('status', ['active', 'ativo', 'Ativo'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data || null;
}

async function findResponsibleProfile(profileId?: string | null) {
  if (!profileId) return null;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, tipo_usuario, telefone')
    .eq('id', profileId)
    .maybeSingle();

  return data;
}

async function getOrCreateConversation(lead: LeadRow) {
  const phone = normalizePhone(lead.telefone);
  if (!phone) return null;

  const { data: existing } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('corretor_id', lead.corretor_id)
    .eq('lead_id', lead.id)
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .insert([{
      corretor_id: lead.corretor_id,
      lead_id: lead.id,
      telefone: phone,
      nome_contato: lead.nome || phone,
      status: 'aberta',
      ultima_mensagem_at: new Date().toISOString(),
    }])
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function insertMessage(conversaId: string, direction: 'inbound' | 'outbound', remetente: string, mensagem: string, metadata: any = {}) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .insert([{
      conversa_id: conversaId,
      direction,
      remetente,
      mensagem,
      provider_message_id: metadata?.provider_message_id || null,
      metadata,
    }])
    .select('*')
    .single();

  if (error) throw error;

  await supabaseAdmin
    .from('whatsapp_conversas')
    .update({ ultima_mensagem_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conversaId);

  return data;
}

async function sendLucasText(adminProfile: ProfileRow, phone: string, text: string) {
  const instance = evolutionInstanceName(adminProfile.id);
  const instanceApiKey = await getEvolutionInstanceApiKey(instance);
  return evolutionFetch(`/message/sendText/${instance}`, {
    method: 'POST',
    body: JSON.stringify({ number: normalizePhone(phone), text }),
  }, instanceApiKey);
}

async function notifyResponsible(lead: LeadRow, summary: string) {
  const responsible = await findResponsibleProfile(lead.responsavel_profile_id);
  if (!responsible) return;

  const msg = [
    `A ${AI_PERSONA} terminou a qualificacao inicial do lead ${plain(lead.nome)}.`,
    '',
    summary || leadFacts(lead),
    '',
    'Agora e a hora do atendimento humano.',
  ].join('\n');

  await supabaseAdmin.from('notificacoes').insert([{
    titulo: 'Lead pronto para atendimento',
    mensagem: msg,
    destinatario_profile_id: responsible.id,
    lida: false,
  }]);

  await sendApoloWhatsApp({
    type: 'novo_lead',
    title: 'Lead pronto para atendimento',
    message: msg,
    profiles: [responsible],
  });
}

async function askAline(lead: LeadRow, history: Array<{ direction: string; remetente?: string | null; mensagem: string }>, customerMessage: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada.');

  const messages = history.slice(-16).map((item) => ({
    role: item.direction === 'inbound' ? 'user' : 'assistant',
    content: `${item.remetente || ''}: ${item.mensagem}`,
  }));

  const system = `Voce e ${AI_PERSONA}, atendente virtual humanizada do Orion Teste para planos de saude.
Fale em portugues do Brasil, com tom natural, simpatico, objetivo e profissional.
Voce esta assumindo uma conversa iniciada por um bot e deve continuar sem parecer robo.

Dados ja conhecidos do lead:
${leadFacts(lead)}

Regras:
- Nunca peca dados que ja estao nos dados conhecidos ou no historico.
- Valide de forma natural as idades e interesse.
- Colete, se faltar: CNPJ/MEI/PF, motivo da busca, hospital/regiao de preferencia, se ja tem plano e qual, melhor email.
- Nao informe valores, prazos, nem detalhes tecnicos de operadora.
- Se o cliente pedir humano, ficar confuso, se irritar, aprovar o resumo final ou a qualificacao estiver suficiente, marque handoff true.
- Quando handoff true, responda curto avisando que vai seguir com a analise/atendimento, sem dizer que e robo.
- Nao envie mensagens para grupos.
- Responda APENAS JSON valido, sem markdown, no formato:
{"reply":"mensagem para enviar ao cliente","handoff":false,"summary":"resumo atualizado do atendimento"}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.ORION_LEAD_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.45,
      max_tokens: 650,
      messages: [
        { role: 'system', content: system },
        ...messages,
        { role: 'user', content: customerMessage },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Erro ao chamar IA do lead.');
  }

  return parseAiJson(payload?.choices?.[0]?.message?.content || '');
}

export async function startLeadAiIfEligible(leadId: string) {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, cidade, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id')
    .eq('id', leadId)
    .maybeSingle();

  if (!lead?.corretor_id) return { started: false, eligible: false, reason: 'Lead sem corretor.' };

  const broker = await findBroker(lead.corretor_id);
  if (!sameBrokerage(broker?.nome_empresa)) return { started: false, eligible: false, reason: 'IA desativada para esta concessionaria.' };

  const adminProfile = await findLucasAdmin(lead.corretor_id);
  if (!adminProfile) return { started: false, eligible: true, reason: 'Lucas RO nao encontrado.' };

  const phone = normalizePhone(lead.telefone);
  if (!phone) return { started: false, eligible: true, reason: 'Lead sem telefone.' };

  const conversation = await getOrCreateConversation(lead);
  if (!conversation) return { started: false, eligible: true, reason: 'Conversa nao criada.' };

  const intro = [
    `Oi, ${plain(lead.nome, 'tudo bem')}! Tudo bem?`,
    `Aqui e a ${AI_PERSONA}, da equipe do Lucas.`,
    `Vi seu cadastro para plano de saude e vou confirmar rapidinho algumas informacoes para deixar seu atendimento certinho.`,
    lead.idades ? `As idades sao ${lead.idades}, certo?` : 'Quais idades entram na cotacao?',
  ].join('\n\n');

  const { data: existing } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('id, status')
    .eq('lead_id', lead.id)
    .maybeSingle();

  if (existing?.status === 'active') return { started: false, eligible: true, reason: 'Sessao ja ativa.' };

  await supabaseAdmin
    .from('lead_ai_sessions')
    .upsert([{
      lead_id: lead.id,
      corretor_id: lead.corretor_id,
      admin_profile_id: adminProfile.id,
      responsavel_profile_id: lead.responsavel_profile_id || null,
      persona: AI_PERSONA,
      status: 'active',
      summary: leadFacts(lead),
      last_ai_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }], { onConflict: 'lead_id' });

  try {
    const payload = await sendLucasText(adminProfile, phone, intro);
    await insertMessage(conversation.id, 'outbound', `${AI_PERSONA} IA`, intro, {
      ...(payload || {}),
      instance: evolutionInstanceName(adminProfile.id),
      ai_agent: AI_PERSONA,
    });
  } catch (error: any) {
    const errorMessage = error?.message || 'Erro ao enviar primeira mensagem da IA.';
    await supabaseAdmin
      .from('lead_ai_sessions')
      .update({
        status: 'error',
        summary: `${leadFacts(lead)}\n\nErro IA: ${errorMessage}`,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', lead.id);
    throw error;
  }

  return { started: true, eligible: true };
}

export async function continueLeadAiFromIncoming(options: {
  leadId: string;
  conversationId: string;
  customerMessage: string;
}) {
  const { data: session } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('*')
    .eq('lead_id', options.leadId)
    .eq('status', 'active')
    .maybeSingle();

  if (!session) return { handled: false, reason: 'Sem sessao ativa.' };

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, cidade, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id')
    .eq('id', options.leadId)
    .maybeSingle();

  if (!lead) return { handled: false, reason: 'Lead nao encontrado.' };

  const adminProfile = await findLucasAdmin(lead.corretor_id);
  if (!adminProfile) return { handled: false, reason: 'Lucas RO nao encontrado.' };

  const { data: history } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('direction, remetente, mensagem, created_at')
    .eq('conversa_id', options.conversationId)
    .order('created_at', { ascending: true })
    .limit(40);

  const ai = await askAline(lead, history || [], options.customerMessage);
  const reply = String(ai.reply || '').trim();
  if (!reply) return { handled: false, reason: 'IA sem resposta.' };

  for (const part of splitReply(reply)) {
    const payload = await sendLucasText(adminProfile, lead.telefone || '', part);
    await insertMessage(options.conversationId, 'outbound', `${AI_PERSONA} IA`, part, {
      ...(payload || {}),
      instance: evolutionInstanceName(adminProfile.id),
      ai_agent: AI_PERSONA,
    });
  }

  const status = ai.handoff ? 'handoff' : 'active';
  await supabaseAdmin
    .from('lead_ai_sessions')
    .update({
      status,
      summary: ai.summary || session.summary || null,
      last_customer_message_at: new Date().toISOString(),
      last_ai_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  if (ai.handoff) {
    await notifyResponsible(lead, ai.summary || '');
  }

  return { handled: true, handoff: Boolean(ai.handoff) };
}
