import { supabaseAdmin } from '@/lib/supabase/admin';
import { COMMERCIAL_MASTER_INSTANCE, normalizePhone, uazapiFetch } from '@/lib/uazapi';
import { COMMERCIAL_MESSAGE_SPLIT, DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';
import {
  ensureCommercialConversation,
  hasRecentHumanOutbound,
  insertCommercialAiMessage,
  normalizeSdrText,
} from '@/lib/commercialInbox';
import { registerAiOutbound } from '@/lib/leadAiAgent';
import {
  canCommercialAiSpeak,
  claimCommercialAiTurn,
  getCommercialAiSession,
  handoffCommercialAiToSdr,
  patchCommercialAiSession,
  releaseCommercialAiTurn,
} from '@/lib/commercialSdrSession';

type CommercialIncomingOptions = {
  leadId: string;
  conversationId: string;
  customerMessage: string;
  phone: string;
};

type CommercialLeadRow = {
  nome?: string | null;
  email?: string | null;
  ja_investiu_trafego?: string | null;
  faturamento_mensal?: string | null;
  investimento?: string | null;
  prioridade?: string | null;
  vidas?: string | null;
  status?: string | null;
};

// Espaco entre os baloes da rajada de abertura. Tres mensagens colando uma na
// outra no mesmo segundo entregam automacao na hora.
const BURST_GAP_MS = 1_500;
const MAX_QUESTIONS = 4;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function leadDataBlock(lead: CommercialLeadRow) {
  return [
    `Nome: ${lead.nome || 'nao informado'}`,
    `E-mail: ${lead.email || 'nao informado'}`,
    `Ja investiu em trafego: ${lead.ja_investiu_trafego || 'nao informado'}`,
    `Faturamento mensal: ${lead.faturamento_mensal || 'nao informado'}`,
    `Investimento pretendido: ${lead.investimento || 'nao informado'}`,
    `Prioridade: ${lead.prioridade || 'nao informada'}`,
    `Vidas na carteira: ${lead.vidas || 'nao informado'}`,
    `Etapa: ${lead.status || 'Oportunidade'}`,
  ].join('\n');
}

/**
 * O prompt fica editavel no banco, entao a resposta pode vir no contrato JSON
 * novo ou como texto puro de um prompt antigo que o coordenador salvou. Aceitar
 * os dois evita que a operacao pare depois de uma edicao na tela de IA.
 */
function parseAiReply(raw: string) {
  const text = normalizeSdrText(raw);
  if (!text) return { reply: '', repassar: false, resumo: null as string | null };

  const candidate = text.startsWith('{') ? text : (text.match(/\{[\s\S]*\}/)?.[0] || '');
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        reply: normalizeSdrText(String(parsed.reply ?? parsed.mensagem ?? '')),
        repassar: parsed.repassar === true || parsed.handoff === true,
        resumo: parsed.resumo ? String(parsed.resumo) : (parsed.summary ? String(parsed.summary) : null),
      };
    } catch {
      // Cai no texto puro abaixo.
    }
  }
  return { reply: text, repassar: false, resumo: null as string | null };
}

function splitBurst(reply: string, limit: number, splitOnBlankLines = false) {
  const marker = COMMERCIAL_MESSAGE_SPLIT.replace(/[[\]]/g, '\\$&');
  // Na abertura o modelo as vezes troca o marcador por uma linha em branco. Sem
  // aceitar as duas formas a rajada sai num balao unico e perde o efeito.
  const pattern = splitOnBlankLines
    ? `\\s*${marker}\\s*|(?:\\r?\\n){2,}`
    : `\\s*${marker}\\s*`;
  return reply
    .split(new RegExp(pattern, 'i'))
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function askOpenAi(systemPrompt: string, userPrompt: string, temperature: number) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada.');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || 'A IA comercial nao conseguiu gerar a resposta.');
  return String(payload?.choices?.[0]?.message?.content || '');
}

/**
 * Envia sempre pelo WhatsApp oficial da Orion. O numero pessoal do SDR do
 * rodizio nao entra nesta conversa: quem abre e a Orion, e o SDR aparece
 * depois, no repasse, por outro numero.
 */
async function sendCommercialMessages(
  conversationId: string,
  phone: string,
  messages: string[],
  extraMetadata: Record<string, unknown> = {},
) {
  for (const [index, text] of messages.entries()) {
    if (index > 0) await wait(BURST_GAP_MS);
    registerAiOutbound(phone, text);
    const providerPayload = await uazapiFetch('/send/text', {
      method: 'POST',
      body: JSON.stringify({ number: phone, text, delay: 1200 }),
    }, { instanceName: COMMERCIAL_MASTER_INSTANCE });
    await insertCommercialAiMessage(conversationId, text, {
      ...(providerPayload || {}),
      ...extraMetadata,
      instance: COMMERCIAL_MASTER_INSTANCE,
    });
  }
}

async function touchConversation(conversationId: string, leadId: string) {
  const now = new Date().toISOString();
  await Promise.all([
    supabaseAdmin.from('whatsapp_conversas').update({
      ultima_mensagem_at: now,
      updated_at: now,
    }).eq('id', conversationId),
    supabaseAdmin.from('comercial_leads').update({ ultimo_contato_at: now, updated_at: now }).eq('id', leadId),
  ]);
}

async function loadCommercialAiConfig() {
  const { data } = await supabaseAdmin
    .from('comercial_config')
    .select('ia_sdr_ativa,ia_sdr_prompt,bot_comercial_ativo')
    .eq('id', 1)
    .maybeSingle();
  return data;
}

/**
 * Primeira abordagem da IA, disparada quando o lead entra no CRM.
 *
 * Era o buraco do fluxo comercial: so o bot tinha gatilho de entrada, entao
 * ligar a IA SDR deixava o lead sem nenhuma mensagem e a IA so acordava se o
 * proprio lead escrevesse primeiro.
 */
export type CommercialOpeningOptions = {
  /**
   * Disparo manual do coordenador pelo botao de teste: ignora a chave de
   * ativacao e a trava de abertura ja enviada, para dar para repetir o teste
   * no mesmo numero.
   */
  manualTest?: boolean;
};

export async function startCommercialSdrOpeningIfEligible(leadId: string, options: CommercialOpeningOptions = {}) {
  const [{ data: lead }, config] = await Promise.all([
    supabaseAdmin.from('comercial_leads').select('*').eq('id', leadId).maybeSingle(),
    loadCommercialAiConfig(),
  ]);

  if (!lead?.id) return { started: false, reason: 'commercial_lead_not_found' };
  if (!config) return { started: false, reason: 'commercial_config_not_found' };
  if (!options.manualTest) {
    if (config.bot_comercial_ativo === true) return { started: false, reason: 'commercial_bot_enabled' };
    if (config.ia_sdr_ativa === false) return { started: false, reason: 'commercial_ai_disabled' };
  }

  const phone = normalizePhone(lead.telefone);
  if (!phone) return { started: false, reason: 'lead_without_phone' };

  if (!await claimCommercialAiTurn(leadId)) return { started: false, reason: 'duplicate_locked' };

  try {
    const session = await getCommercialAiSession(leadId);
    if (!options.manualTest) {
      if (session?.abertura_enviada_at) return { started: false, reason: 'opening_already_sent' };
      if (!canCommercialAiSpeak(session)) return { started: false, reason: `session_${session?.status}` };
    }

    const conversation = await ensureCommercialConversation(lead.telefone, lead.nome);

    // Segunda guarda, pela metadata da mensagem, igual a do bot. Cobre o caso da
    // migration da sessao ainda nao estar aplicada, quando abertura_enviada_at
    // nao persiste e um retry do webhook reenviaria a abertura.
    const { data: alreadySent } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('id,metadata')
      .eq('conversa_id', conversation.id)
      .eq('direction', 'outbound')
      .limit(30);
    const sentRows = (alreadySent || []) as Array<{ metadata: Record<string, unknown> | null }>;
    if (!options.manualTest && sentRows.some((item) => item.metadata?.commercial_ai_first_contact === true)) {
      return { started: false, reason: 'opening_already_sent' };
    }

    const systemPrompt = String(config.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT);
    const userPrompt = `DADOS ATUAIS DO LEAD:
${leadDataBlock(lead)}

Nao existe historico: esta e a primeira abordagem. Escreva a ABERTURA em tres mensagens separadas pelo marcador ${COMMERCIAL_MESSAGE_SPLIT}, seguindo as regras de abertura e confirmando os dados do formulario.`;

    const parsed = parseAiReply(await askOpenAi(systemPrompt, userPrompt, 0.6));
    const messages = splitBurst(parsed.reply, 3, true);
    if (!messages.length) throw new Error('A IA comercial retornou uma abertura vazia.');

    await sendCommercialMessages(conversation.id, phone, messages, { commercial_ai_first_contact: true });

    const now = new Date().toISOString();
    await patchCommercialAiSession(leadId, {
      conversa_id: conversation.id,
      status: 'ativa',
      abertura_enviada_at: now,
      ultima_mensagem_ia_at: now,
      // A confirmacao dos dados no terceiro balao ja e a primeira pergunta.
      perguntas_feitas: 1,
      motivo: null,
    });
    await touchConversation(conversation.id, leadId);

    return { started: true, conversation_id: conversation.id, messages };
  } catch (error) {
    await patchCommercialAiSession(leadId, {
      status: 'erro',
      motivo: error instanceof Error ? error.message : 'Falha ao enviar a abertura da IA.',
    });
    throw error;
  } finally {
    await releaseCommercialAiTurn(leadId);
  }
}

export async function continueCommercialSdrFromIncoming(options: CommercialIncomingOptions) {
  const [{ data: lead }, config] = await Promise.all([
    supabaseAdmin.from('comercial_leads').select('*').eq('id', options.leadId).maybeSingle(),
    loadCommercialAiConfig(),
  ]);
  if (!lead) return { handled: false, reason: 'commercial_lead_not_found' };
  if (config?.bot_comercial_ativo === true) return { handled: false, reason: 'commercial_bot_enabled' };
  if (config?.ia_sdr_ativa === false) return { handled: false, reason: 'commercial_ai_disabled' };

  const session = await getCommercialAiSession(options.leadId);
  if (!canCommercialAiSpeak(session)) return { handled: false, reason: `session_${session?.status}` };

  // Rede de seguranca curta para o caso do takeover pelo webhook nao ter
  // rodado. A trava principal agora e o status da sessao.
  if (await hasRecentHumanOutbound(options.conversationId, 90_000)) {
    return { handled: false, reason: 'recent_human_reply_exists' };
  }

  if (!await claimCommercialAiTurn(options.leadId)) return { handled: false, reason: 'duplicate_locked' };

  try {
    await patchCommercialAiSession(options.leadId, {
      conversa_id: options.conversationId,
      ultima_mensagem_lead_at: new Date().toISOString(),
    });

    const { data: history } = await supabaseAdmin.from('whatsapp_mensagens')
      .select('direction,remetente,mensagem,created_at').eq('conversa_id', options.conversationId)
      .order('created_at', { ascending: true }).limit(40);
    const historyText = (history || []).map((item) =>
      `${item.direction === 'outbound' ? 'Aline' : 'Lead'}: ${String(item.mensagem || '').trim()}`
    ).filter(Boolean).slice(-20).join('\n');

    const asked = session?.perguntas_feitas ?? 0;
    const remaining = Math.max(0, MAX_QUESTIONS - asked);
    const systemPrompt = String(config?.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT);
    const userPrompt = `DADOS ATUAIS DO LEAD:
${leadDataBlock(lead)}

HISTORICO REAL DA CONVERSA:
${historyText || 'Nenhuma mensagem anterior registrada.'}

ULTIMA MENSAGEM RECEBIDA DO LEAD:
${options.customerMessage}

CONTROLE: voce ja fez ${asked} de ${MAX_QUESTIONS} perguntas.${remaining <= 1
      ? ' Esta e a ultima. Nao faca nova pergunta de qualificacao: encerre pedindo permissao para o especialista chamar e defina "repassar": true.'
      : ` Restam ${remaining}.`}

Responda com uma unica mensagem, sem repetir a abertura, sem inventar dados e sem usar o marcador de quebra.`;

    const parsed = parseAiReply(await askOpenAi(systemPrompt, userPrompt, 0.65));
    const reply = splitBurst(parsed.reply, 1)[0] || '';

    // Repasse com reply vazio e proposital: lead irritado ou pedindo humano sai
    // do automatico sem receber mais nenhuma mensagem da IA.
    if (!reply && !parsed.repassar) throw new Error('A IA comercial retornou uma resposta vazia.');

    const phone = normalizePhone(options.phone || lead.telefone);
    if (reply) {
      await sendCommercialMessages(options.conversationId, phone, [reply]);
      await patchCommercialAiSession(options.leadId, {
        ultima_mensagem_ia_at: new Date().toISOString(),
        perguntas_feitas: asked + (reply.includes('?') ? 1 : 0),
      });
      await touchConversation(options.conversationId, options.leadId);
    }

    if (parsed.repassar) {
      await handoffCommercialAiToSdr(
        options.leadId,
        'IA concluiu a qualificacao e entregou a conversa.',
        parsed.resumo,
      );
    }

    return { handled: true, reply, repassou: parsed.repassar };
  } finally {
    await releaseCommercialAiTurn(options.leadId);
  }
}
