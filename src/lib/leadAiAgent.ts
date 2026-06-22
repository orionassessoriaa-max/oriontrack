import { supabaseAdmin } from '@/lib/supabase/admin';
import { evolutionFetch, evolutionInstanceName, getEvolutionInstanceApiKey, normalizePhone } from '@/lib/evolution';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

export const recentAiOutboundMessages = new Set<string>();

function cleanSignatureText(text: string) {
  return String(text || '').replace(/\s+/g, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').toLowerCase();
}

export function registerAiOutbound(phone: string, text: string) {
  const signature = `${normalizePhone(phone)}:${cleanSignatureText(text)}`;
  recentAiOutboundMessages.add(signature);
  
  if (recentAiOutboundMessages.size > 200) {
    const first = recentAiOutboundMessages.values().next().value;
    if (first) recentAiOutboundMessages.delete(first);
  }
}

export function isAiOutbound(phone: string, text: string) {
  const signature = `${normalizePhone(phone)}:${cleanSignatureText(text)}`;
  return recentAiOutboundMessages.has(signature);
}

const AI_TEST_BROKERAGE = 'ORION TESTE';
const AI_PERSONA = 'Aline';
const DEFAULT_ELEVENLABS_VOICE_ID = '33B4UnXyTNbgLmdEDh5P';

export const DEFAULT_SYSTEM_PROMPT = `Voce e {persona}, uma consultora de vendas e atendente comercial humana e simpatica da corretora de planos de saude Vida Protegida.
Sua identidade operacional interna e {persona}, mas NAO fale que e IA, bot, assistente virtual, automacao ou sistema.
Nao assine mensagens, nao coloque prefixo de atendente e nunca comece a resposta com "{persona}:".
Nao repita seu nome in toda resposta. Se precisar se apresentar, apresente-se apenas uma vez, de forma natural.
Fale em portugues do Brasil, como uma pessoa real no WhatsApp: de forma humana, simpatica, simples, objetiva e sem cara de script.
Sua missao nao e fazer uma qualificacao longa, e sim confirmar o interesse, coletar de forma gentil as informacoes essenciais pendentes e agendar uma ligacao rapida de 15 minutos.

Dados ja conhecidos do lead:
{lead_facts}

Regras de Conversacao:
- Escreva respostas curtas, normalmente com 1 ou 2 frases. Evite textao.
- Fale com o cliente pelo primeiro nome quando souber, de forma natural.
- Nao use linguagem corporativa formal ou robotica como "daremos continuidade", "estarei verificando", "seguirei com a tratativa", "com base nas informacoes fornecidas" ou "para facilitar a comunicacao".
- Nao comece toda resposta com "Perfeito", "Entendi" ou "Certo". Varie naturalmente ou va direto ao ponto.
- Use um tom conversado e amigavel: "Boa", "show", "me diz uma coisa", "pra eu te direcionar melhor", mas sem exagerar em girias.
- Nao use ponto de exclamacao in toda mensagem.
- Nunca peca dados que ja constam nos dados conhecidos ou no historico.
- Faca no maximo uma pergunta por mensagem, seguindo rigorosamente o fluxo abaixo.

Fluxo linear de perguntas (siga esta ordem, sempre pulando o que ja estiver respondido ou conhecido):
1. Confirmacao de Idades:
   A primeira mensagem automatica ja enviou a confirmacao do interesse e das idades. Se o cliente respondeu concordando, prossiga.
2. CNPJ/MEI (Seja muito gentil, sutil e corretora de verdade, nunca direta demais):
   - Se o lead ja tem CNPJ nos dados conhecidos: "Legal, [Nome]! Vi aqui que você mencionou que tem CNPJ, está certinho? Só para confirmar se fazemos a simulação empresarial."
   - Se o lead tem MEI nos dados conhecidos: "Ah, que bacana, [Nome]! Vi que você tem MEI. Há quanto tempo ele foi aberto, mais ou menos?"
   - Se nao souber se tem CNPJ/MEI/CPF nos dados conhecidos: pergunte de forma sutil e natural se o plano seria feito usando CNPJ/MEI ou no CPF (Pessoa Fisica).
3. Confirmacao de quantidade de pessoas:
   - Se souber as idades do lead, conte a quantidade de idades (ex: se idades for "23, 45", sao 2 pessoas) e pergunte: "Só pra confirmar, o plano seria para essas [X] pessoas?" (substituindo [X] pelo numero correto).
4. Hospital ou Clinica de Preferencia:
   - Pergunte de forma sutil: "Você tem algum hospital ou clínica de preferência na sua região?"
5. Necessidade Especifica (Use exatamente esta frase):
   - "Beleza, [Nome]. Você está buscando mais por prevenção, urgência ou algum atendimento específico?"
6. Atendimento Nacional ou Regional:
   - Pergunte: "Vocês estão procurando algo para atendimento nacional ou apenas regional, [Nome]?"
7. Investimento Pretendido (Use exatamente esta frase):
   - "Perfeito, [Nome]. Quanto vocês estão dispostos a investir nesse plano de saúde? Pra que eu consiga trazer a opção que mais se adeque ao que estão procurando."
8. Coleta de E-mail (Use exatamente esta frase):
   - "Entendi, perfeito, [Nome]. Me passa agora seu e-mail para eu te enviar por lá a proposta direitinho?"
9. Agendamento de Ligacao Rapida (Use exatamente esta frase):
   - "Acredito que já tenho todas as informações, [Nome]. Teria disponibilidade de uma ligação rápida de 15 minutos amanhã? Me fala aqui o melhor horário para eu deixar agendado."

Regras de Handoff (Transferencia para Especialista):
- Se o cliente responder de forma positiva marcando o horario da ligacao de 15 minutos: registre "agendado: true" no summary, defina "handoff": true e responda na "reply" de forma natural exatamente esta frase: "Perfeito! Já tenho todos os dados, agora um especialista vai entrar em contato por outro número para confirmar o horário contigo, ok?"
- Se a IA tiver qualquer duvida ou problema, se o cliente pedir valores/precos/detalhes tecnicos de operadoras, se demonstrar pressa, ficar confuso, reclamar, mandar algo desconexo ou se voce nao tiver seguranca do que responder: defina "handoff": true e use exatamente esta resposta humanizada e gentil no campo "reply" (nunca deixe reply vazio):
  "Olha, para te passar a informação bem certinha e te ajudar da melhor forma, vou passar seu contato para o nosso especialista do time. Ele vai te chamar de outro número para continuar o atendimento, tudo bem?"
- Se o cliente enviar a palavra "alvorada", defina "handoff": true e responda com a mensagem do especialista acima.

Nao envie ao cliente nomes de ferramentas internas. O resumo (summary) deve ficar apenas no banco de dados interno.

Use o campo summary como a tool dados_lead para registrar as informacoes de forma organizada, pulando linha para cada campo, exatamente neste formato (com as chaves dos atributos em negrito usando asteriscos, por exemplo *Nome*):
*Nome*: [nome]
*Telefone*: [telefone]
*Idades*: [idades]
*CNPJ/MEI*: [cnpj/mei/pf]
*Cidade*: [cidade]
*Investimento*: [investimento]
*Plano Atual*: [plano atual]
*Motivo*: [motivo]
*Hospital/Regiao*: [hospital/regiao]
*Email*: [email]
*Agendado*: [se agendou, preencha com o dia e horario que foi marcado de forma amigavel, por exemplo: "Terca-feira as 14:00" ou "Amanha as 15h". Caso contrario, preencha com "Nao"]
*Pendente*: [o que ficou pendente]

Responda APENAS JSON valido, sem markdown, no formato:
{"reply":"mensagem para enviar ao cliente","handoff":false,"summary":"resumo atualizado do atendimento"}`;

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
  email?: string | null;
  motivo_busca?: string | null;
  hospital_preferencia?: string | null;
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

function hasKnownValue(value?: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return !['-', 'nao informado', 'não informado', 'sem informacao', 'sem informação'].includes(text.toLowerCase());
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
    lead.email ? `E-mail: ${lead.email}` : null,
    lead.motivo_busca ? `Motivo da busca: ${lead.motivo_busca}` : null,
    lead.hospital_preferencia ? `Hospital/Região de preferência: ${lead.hospital_preferencia}` : null,
    `Anuncio: ${adName(lead)}`,
  ].filter(Boolean).join('\n');
}

function initialLeadQuestion(lead: LeadRow) {
  if (hasKnownValue(lead.idades)) {
    return `Você gostaria de receber uma cotação para as idades ${plain(lead.idades, '')}, correto?`;
  }

  return 'Você gostaria de receber uma cotação, correto?';
}

function splitReply(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function stripPersonaPrefix(text: string) {
  return text
    .replace(/^\s*(?:aline|aline\s+ia|ia\s+aline)\s*[:\-–—]\s*/i, '')
    .trim();
}

function parseAiJson(raw: string) {
  const clean = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return {
      ...parsed,
      reply: stripPersonaPrefix(String(parsed?.reply || '')),
    };
  } catch {
    return { reply: stripPersonaPrefix(clean), handoff: false, summary: '' };
  }
}

function providerMessageId(payload: any) {
  return String(
    payload?.key?.id ||
    payload?.message?.key?.id ||
    payload?.data?.key?.id ||
    payload?.id ||
    ''
  ).trim() || null;
}

async function findBroker(corretorId: string) {
  const { data } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  return data;
}

async function findAiAdmin(corretorId: string): Promise<ProfileRow | null> {
  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  if (!broker?.nome_empresa) return null;

  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
    .eq('corretor_id', corretorId)
    .eq('tipo_usuario', 'corretor_admin')
    .in('status', ['active', 'ativo', 'Ativo'])
    .order('created_at', { ascending: true })
    .limit(10);

  const activeAdmins = admins || [];
  const configuredPhone = normalizePhone(process.env.ORION_TEST_AI_ADMIN_PHONE || '556181625459');
  const phoneMatch = activeAdmins.find((profile) => normalizePhone(profile.telefone) === configuredPhone);

  return phoneMatch || activeAdmins.find((profile) => normalizePhone(profile.telefone)) || activeAdmins[0] || null;
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
      provider_message_id: metadata?.provider_message_id || providerMessageId(metadata),
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

async function sendAiAdminText(adminProfile: ProfileRow, phone: string, text: string) {
  const instance = evolutionInstanceName(adminProfile.id);
  const instanceApiKey = await getEvolutionInstanceApiKey(instance);
  return evolutionFetch(`/message/sendText/${instance}`, {
    method: 'POST',
    body: JSON.stringify({ number: normalizePhone(phone), text }),
  }, instanceApiKey);
}

function cleanTextForSpeech(text: string) {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\bCNPJ\b/gi, 'C N P J')
    .replace(/\bMEI\b/gi, 'M E I')
    .replace(/\bPME\b/gi, 'P M E')
    .replace(/\bCPF\b/gi, 'C P F')
    .replace(/\bHapvida\b/gi, 'Hapvida')
    .replace(/\s+/g, ' ')
    .trim();
}

async function formatTextForSpeech(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  const cleanText = cleanTextForSpeech(text);
  if (!apiKey || cleanText.length < 20) return cleanText;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.ORION_LEAD_AI_SPEECH_FORMAT_MODEL || process.env.ORION_LEAD_AI_MODEL || 'gpt-4o-mini',
        temperature: 0.25,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content: [
              'Voce e um assistente especialista em preparar texto para audio de WhatsApp.',
              'Receba um texto curto e reescreva para soar humano, leve e natural quando falado.',
              'Nao use SSML, XML, tags, markdown, listas ou emojis.',
              'Mantenha o mesmo sentido original, sem adicionar novas perguntas ou novas informacoes.',
              'Use frases curtas, pontuacao natural e pequenas pausas com virgulas e pontos.',
              'Deixe a fala mais calma, com ritmo de atendimento humano no WhatsApp, sem pressa.',
              'Prefira um jeito conversado, como uma consultora real falando em audio curto para um cliente.',
              'Nao deixe o texto com cara de leitura formal, comercial gravado ou locucao.',
              'Evite linguagem robotica, formal demais ou com cara de script.',
              'Datas e horas devem ficar naturais quando faladas, por exemplo 10:00 vira dez horas.',
              'Telefones devem ficar naturais: DDD em dezena e blocos separados por virgula.',
              'Remova qualquer prefixo de atendente.',
              'Nao inclua nenhuma informacao alem do texto final para ser falado.',
              'Nunca inclua caractere de nova linha na saida.',
              'Nunca coloque aspas ou explicacoes ao redor do texto.',
            ].join(' '),
          },
          { role: 'user', content: cleanText },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return cleanText;

    return cleanTextForSpeech(payload?.choices?.[0]?.message?.content || cleanText);
  } catch {
    return cleanText;
  }
}

async function openAiTextToSpeechBase64(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada.');

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.ORION_LEAD_AI_TTS_MODEL || 'tts-1-hd',
      voice: process.env.ORION_LEAD_AI_TTS_VOICE || 'nova',
      input: text,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || 'Erro ao gerar audio da IA.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

async function elevenLabsTextToSpeechBase64(text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ORION_ELEVENLABS_API_KEY;
  const voiceId = process.env.ORION_LEAD_AI_ELEVEN_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return null;

  const outputFormat = process.env.ORION_LEAD_AI_ELEVEN_OUTPUT_FORMAT || 'mp3_44100_128';
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ORION_LEAD_AI_ELEVEN_MODEL || 'eleven_multilingual_v2',
      voice_settings: {
        stability: Number(process.env.ORION_LEAD_AI_ELEVEN_STABILITY || 0.50),
        similarity_boost: Number(process.env.ORION_LEAD_AI_ELEVEN_SIMILARITY || 0.75),
        style: Number(process.env.ORION_LEAD_AI_ELEVEN_STYLE || 0.0),
        speed: Number(process.env.ORION_LEAD_AI_ELEVEN_SPEED || 1.0),
        use_speaker_boost: String(process.env.ORION_LEAD_AI_ELEVEN_SPEAKER_BOOST || 'true').toLowerCase() === 'true',
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.detail?.message || payload?.message || 'Erro ao gerar audio no ElevenLabs.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

async function textToSpeechBase64(text: string) {
  const speechText = cleanTextForSpeech(text);
  const elevenAudio = await elevenLabsTextToSpeechBase64(speechText);
  if (elevenAudio) return { audio: elevenAudio, provider: 'elevenlabs', speechText };

  return {
    audio: await openAiTextToSpeechBase64(speechText),
    provider: 'openai',
    speechText,
  };
}

async function sendAiAdminAudio(adminProfile: ProfileRow, phone: string, text: string) {
  const instance = evolutionInstanceName(adminProfile.id);
  const instanceApiKey = await getEvolutionInstanceApiKey(instance);
  const { audio, provider, speechText } = await textToSpeechBase64(text);

  const payload = await evolutionFetch(`/message/sendWhatsAppAudio/${instance}`, {
    method: 'POST',
    body: JSON.stringify({
      number: normalizePhone(phone),
      audio,
      delay: 2000,
      options: {
        delay: 1200,
        presence: 'recording',
        encoding: true,
      },
    }),
  }, instanceApiKey);

  return { ...(payload || {}), tts_provider: provider, tts_text: speechText };
}

async function notifyResponsible(lead: LeadRow, summary: string) {
  const responsible = await findResponsibleProfile(lead.responsavel_profile_id);
  const admin = await findAiAdmin(lead.corretor_id);

  const targets: any[] = [];
  if (responsible) {
    targets.push(responsible);
  }
  if (admin && (!responsible || admin.id !== responsible.id)) {
    targets.push(admin);
  }

  if (targets.length === 0) return;

  for (const target of targets) {
    const isOwner = admin && target.id === admin.id;
    const bodyParts = [
      `Atendimento inicial concluído para o lead *${plain(lead.nome)}*.`,
    ];
    if (isOwner && responsible && responsible.id !== admin.id) {
      bodyParts.push(`Agora é com o *${responsible.nome}*.`);
    }
    bodyParts.push('');
    bodyParts.push(summary || leadFacts(lead));
    bodyParts.push('');
    bodyParts.push('Agora é a hora do atendimento humano.');

    const msg = bodyParts.join('\n');

    await supabaseAdmin.from('notificacoes').insert([{
      titulo: 'Lead pronto para atendimento',
      mensagem: msg,
      destinatario_profile_id: target.id,
      lida: false,
    }]);

    await sendApoloWhatsApp({
      type: 'novo_lead',
      title: 'Lead pronto para atendimento',
      message: msg,
      profiles: [target],
    });
  }
}

async function askAline(
  lead: LeadRow, 
  history: Array<{ direction: string; remetente?: string | null; mensagem: string; metadata?: any }>, 
  customerMessage: string,
  aiConfig: { persona: string; system_prompt: string }
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada.');

  const messages = history.slice(-16).map((item) => {
    let content = item.mensagem;
    if (item.direction === 'inbound') {
      content = item.metadata?.audio_transcript || item.metadata?.ai_customer_message?.replace(/^Audio transcrito do cliente:\s*/i, '') || item.mensagem;
    } else {
      content = item.metadata?.ai_text || item.mensagem;
    }
    return {
      role: item.direction === 'inbound' ? 'user' : 'assistant',
      content,
    };
  });

  const system = (aiConfig.system_prompt || DEFAULT_SYSTEM_PROMPT)
    .replace(/{persona}/gi, aiConfig.persona)
    .replace(/{lead_facts}/gi, leadFacts(lead));

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.ORION_LEAD_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.65,
      max_tokens: 650,
      messages: [
        { role: 'system', content: system },
        ...messages,
        { role: 'user', content: customerMessage },
      ],
      response_format: { type: 'json_object' },
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
  if (!broker?.nome_empresa) return { started: false, eligible: false, reason: 'Lead sem concessionaria.' };

  const { data: corretora } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .ilike('nome', broker.nome_empresa)
    .maybeSingle();

  if (!corretora) return { started: false, eligible: false, reason: 'Concessionaria nao cadastrada no registro.' };

  const { data: aiConfig } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('*')
    .eq('corretora_id', corretora.id)
    .eq('status', 'ativo')
    .maybeSingle();

  if (!aiConfig) return { started: false, eligible: false, reason: 'IA desativada para esta concessionaria.' };

  const adminProfile = await findAiAdmin(lead.corretor_id);
  if (!adminProfile) return { started: false, eligible: true, reason: 'Admin IA da concessionaria nao encontrado.' };

  const phone = normalizePhone(lead.telefone);
  if (!phone) return { started: false, eligible: true, reason: 'Lead sem telefone.' };

  const conversation = await getOrCreateConversation(lead);
  if (!conversation) return { started: false, eligible: true, reason: 'Conversa nao criada.' };

  const rawName = corretora.nome || broker.nome_empresa;
  const cleanName = rawName.replace(/\bcorretora\b/gi, '').replace(/\s+/g, ' ').trim();
  const formattedBrokerageName = cleanName
    .toLowerCase()
    .split(' ')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const intro = [
    `Olá, ${plain(lead.nome, 'tudo bem')}! Tudo bem?`,
    `Me chamo ${aiConfig.persona} da corretora ${formattedBrokerageName}`,
    'Você clicou em um anúncio nosso e preencheu o formulário de interesse da Hapvida PME.',
    initialLeadQuestion(lead),
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
      persona: aiConfig.persona,
      status: 'active',
      summary: leadFacts(lead),
      last_ai_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }], { onConflict: 'lead_id' });

  try {
    registerAiOutbound(phone, intro);
    const payload = await sendAiAdminText(adminProfile, phone, intro);
    await insertMessage(conversation.id, 'outbound', aiConfig.persona, intro, {
      ...(payload || {}),
      instance: evolutionInstanceName(adminProfile.id),
      ai_agent: aiConfig.persona,
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
  incomingWasAudio?: boolean;
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

  const broker = await findBroker(lead.corretor_id);
  if (!broker?.nome_empresa) return { handled: false, reason: 'Lead sem concessionaria.' };

  const { data: corretora } = await supabaseAdmin
    .from('corretoras')
    .select('id')
    .ilike('nome', broker.nome_empresa)
    .maybeSingle();

  if (!corretora) return { handled: false, reason: 'Concessionaria nao cadastrada no registro.' };

  const { data: aiConfig } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('*')
    .eq('corretora_id', corretora.id)
    .eq('status', 'ativo')
    .maybeSingle();

  if (!aiConfig) return { handled: false, reason: 'IA desativada para esta concessionaria.' };

  const adminProfile = await findAiAdmin(lead.corretor_id);
  if (!adminProfile) return { handled: false, reason: 'Admin IA da concessionaria nao encontrado.' };

  const { data: history } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('direction, remetente, mensagem, metadata, created_at')
    .eq('conversa_id', options.conversationId)
    .order('created_at', { ascending: true })
    .limit(40);

  const ai = await askAline(lead, history || [], options.customerMessage, aiConfig);
  const reply = String(ai.reply || '').trim();

  for (const part of reply ? splitReply(reply) : []) {
    if (options.incomingWasAudio) {
      try {
        registerAiOutbound(lead.telefone || '', '🎤 Mensagem de voz');
        const payload = await sendAiAdminAudio(adminProfile, lead.telefone || '', part);
        await insertMessage(options.conversationId, 'outbound', aiConfig.persona, 'Mensagem de voz', {
          ...(payload || {}),
          instance: evolutionInstanceName(adminProfile.id),
          provider_message_id: providerMessageId(payload),
          ai_agent: aiConfig.persona,
          ai_text: part,
          messageType: 'audioMessage',
          mediaType: 'audio',
          mediatype: 'audio',
          mimetype: 'audio/mpeg',
          fileName: 'aline-resposta.mp3',
        });
        continue;
      } catch (audioErr) {
        console.error('[lead_ai_agent] Failed sending audio reply, falling back to text:', audioErr);
      }
    }

    registerAiOutbound(lead.telefone || '', part);
    const payload = await sendAiAdminText(adminProfile, lead.telefone || '', part);
    await insertMessage(options.conversationId, 'outbound', aiConfig.persona, part, {
      ...(payload || {}),
      instance: evolutionInstanceName(adminProfile.id),
      ai_agent: aiConfig.persona,
    });
  }

  if (!reply && !ai.handoff) return { handled: false, reason: 'IA sem resposta.' };

  const status = ai.handoff ? 'handoff' : 'active';
  const currentSummary = ai.summary || session.summary || null;
  await supabaseAdmin
    .from('lead_ai_sessions')
    .update({
      status,
      summary: currentSummary,
      last_customer_message_at: new Date().toISOString(),
      last_ai_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  if (currentSummary) {
    await updateLeadFromSummary(lead.id, currentSummary);
  }

  if (ai.handoff) {
    await notifyResponsible(lead, ai.summary || '');
    const scheduledVal = extractAgendadoValue(ai.summary);
    if (scheduledVal) {
      await createAutoScheduledTask(lead, scheduledVal, adminProfile.id);
    }
  }

  return { handled: true, handoff: Boolean(ai.handoff) };
}

export async function checkLeadAiTimeouts() {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  
  // Find all active sessions where the last AI message was sent more than 15 minutes ago
  const { data: activeSessions, error } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('*')
    .eq('status', 'active')
    .lte('last_ai_message_at', fifteenMinutesAgo);
    
  if (error) {
    console.error('[cron_timeout] Error fetching active sessions:', error);
    return { count: 0, error };
  }
  
  let handoffCount = 0;
  
  for (const session of activeSessions || []) {
    // 1. Get the last message of the conversation to see if it was the schedule question
    const { data: conv } = await supabaseAdmin
      .from('whatsapp_conversas')
      .select('id')
      .eq('lead_id', session.lead_id)
      .maybeSingle();
      
    if (!conv) continue;
    
    const { data: lastMsg } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('*')
      .eq('conversa_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
      
    if (!lastMsg) continue;
    
    // We check:
    // - if the last message is outbound (sent by AI)
    // - if it contains the keywords from the schedule question (Step 9)
    const isLastMessageOutbound = lastMsg.direction === 'outbound';
    const msgText = String(lastMsg.mensagem || '').toLowerCase();
    const isScheduleQuestion = msgText.includes('disponibilidade de uma ligação') || 
                               msgText.includes('ligação rápida de 15 minutos') || 
                               msgText.includes('melhor horário para eu deixar agendado');
                               
    if (isLastMessageOutbound && isScheduleQuestion) {
      console.log(`[cron_timeout] Lead ${session.lead_id} timed out on schedule question.`);
      
      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id, corretor_id, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, cidade, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id')
        .eq('id', session.lead_id)
        .maybeSingle();
        
      if (!lead) continue;
      
      const suffix = '\n\nIA encerrada: Lead não respondeu à pergunta de agendamento por mais de 15 minutos.';
      const newSummary = `${session.summary || leadFacts(lead)}${suffix}`.trim();
      
      // Update session status to handoff
      await supabaseAdmin
        .from('lead_ai_sessions')
        .update({
          status: 'handoff',
          summary: newSummary,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id);
        
      await updateLeadFromSummary(lead.id, newSummary);
        
      // Notify responsible broker
      await notifyResponsible(lead, newSummary);
      handoffCount++;
    }
  }
  
  return { count: handoffCount };
}

function extractAgendadoValue(summary?: string | null): string | null {
  if (!summary) return null;
  const match = summary.match(/(?:\*?Agendado\*?:?\s*)([^\r\n]+)/i);
  if (match && match[1]) {
    const value = match[1].trim();
    const lowerVal = value.toLowerCase();
    if (lowerVal && lowerVal !== 'false' && lowerVal !== 'não' && lowerVal !== 'nao' && lowerVal !== 'null' && lowerVal !== 'no') {
      return value;
    }
  }
  return null;
}

async function createAutoScheduledTask(lead: LeadRow, scheduledText: string, fallbackProfileId?: string | null) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('lead_tarefas')
      .select('id')
      .eq('lead_id', lead.id)
      .ilike('titulo', `%Reunião agendada pela IA%`)
      .limit(1)
      .maybeSingle();

    if (existing) return;

    const title = `Reunião agendada pela IA: ${scheduledText}`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const vencimento = tomorrow.toISOString();

    const targetProfileId = lead.responsavel_profile_id || fallbackProfileId || null;

    const { error } = await supabaseAdmin
      .from('lead_tarefas')
      .insert([{
        lead_id: lead.id,
        corretor_id: lead.corretor_id,
        responsavel_profile_id: targetProfileId,
        titulo: title,
        vencimento: vencimento,
        prioridade: 'alta',
        status: 'pendente'
      }]);

    if (error) throw error;

    await supabaseAdmin
      .from('lead_atividades')
      .insert([{
        lead_id: lead.id,
        profile_id: targetProfileId,
        tipo: 'tarefa',
        titulo: 'Tarefa criada automaticamente',
        descricao: `Lembrete agendado pela IA: ${title}`
      }]);

    console.log(`[auto_task] Created task successfully: ${title}`);
  } catch (err) {
    console.error('[auto_task] Failed to create auto task:', err);
  }
}

async function updateLeadFromSummary(leadId: string, summary?: string | null) {
  if (!summary) return;
  try {
    const updates: any = {};
    
    const getValue = (key: string) => {
      const regex = new RegExp(`(?:\\*?${key}\\*?:?\\s*)([^\\r\\n]+)`, 'i');
      const match = summary.match(regex);
      if (match && match[1]) {
        const val = match[1].trim();
        if (
          val &&
          !val.startsWith('[') &&
          !val.endsWith(']') &&
          !['não informado', 'nao informado', '-', 'sem informação', 'sem informacao', 'não', 'nao'].includes(val.toLowerCase())
        ) {
          return val;
        }
      }
      return null;
    };

    const nome = getValue('Nome');
    if (nome) updates.nome = nome;

    const idades = getValue('Idades');
    if (idades) updates.idades = idades;

    const cidade = getValue('Cidade');
    if (cidade) updates.cidade = cidade;

    const investimento = getValue('Investimento');
    if (investimento) updates.investimento = investimento;

    const planoAtual = getValue('Plano\\s+Atual');
    if (planoAtual) updates.plano_atual = planoAtual;

    const email = getValue('Email');
    if (email) updates.email = email;

    const motivo = getValue('Motivo');
    if (motivo) updates.motivo_busca = motivo;

    const hospital = getValue('Hospital/Regiao');
    if (hospital) updates.hospital_preferencia = hospital;

    const cnpjMei = getValue('CNPJ/MEI');
    if (cnpjMei) {
      const lower = cnpjMei.toLowerCase();
      if (lower.includes('mei')) {
        updates.possui_cnpj = 'Tenho MEI';
      } else if (lower.includes('cnpj') || lower.includes('sim')) {
        updates.possui_cnpj = 'Sim';
      } else if (lower.includes('não') || lower.includes('nao') || lower.includes('pf') || lower.includes('fisica') || lower.includes('física')) {
        updates.possui_cnpj = 'Não';
      }
      
      const digits = cnpjMei.replace(/\D/g, '');
      if (digits.length >= 11) {
        updates.cnpj = cnpjMei;
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update(updates)
        .eq('id', leadId);
      if (error) throw error;
      console.log(`[lead_ai_agent] Updated lead ${leadId} from summary:`, updates);
    }
  } catch (err) {
    console.error('[lead_ai_agent] Failed to update lead from summary:', err);
  }
}
