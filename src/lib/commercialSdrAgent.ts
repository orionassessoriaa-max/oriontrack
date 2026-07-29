import { supabaseAdmin } from '@/lib/supabase/admin';
import { COMMERCIAL_MASTER_INSTANCE, normalizePhone, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';
import { hasRecentHumanOutbound, insertCommercialAiMessage, normalizeSdrText } from '@/lib/commercialInbox';
import { registerAiOutbound } from '@/lib/leadAiAgent';

type CommercialIncomingOptions = {
  leadId: string;
  conversationId: string;
  customerMessage: string;
  phone: string;
};

const locks = new Map<string, number>();
const LOCK_TTL_MS = 45_000;

export async function continueCommercialSdrFromIncoming(options: CommercialIncomingOptions) {
  const now = Date.now();
  const lockedAt = locks.get(options.leadId);
  if (lockedAt && now - lockedAt < LOCK_TTL_MS) return { handled: false, reason: 'duplicate_locked' };
  locks.set(options.leadId, now);

  try {
    const [{ data: lead }, { data: config }] = await Promise.all([
      supabaseAdmin.from('comercial_leads').select('*').eq('id', options.leadId).maybeSingle(),
      supabaseAdmin.from('comercial_config').select('ia_sdr_ativa,ia_sdr_prompt,bot_comercial_ativo').eq('id', 1).maybeSingle(),
    ]);
    if (!lead) return { handled: false, reason: 'commercial_lead_not_found' };
    if (config?.bot_comercial_ativo === true) return { handled: false, reason: 'commercial_bot_enabled' };
    if (config?.ia_sdr_ativa === false) return { handled: false, reason: 'commercial_ai_disabled' };

    // Trava apenas quando um humano respondeu agora; o eco das mensagens da
    // propria IA nao pode calar o atendimento.
    if (await hasRecentHumanOutbound(options.conversationId, 90_000)) {
      return { handled: false, reason: 'recent_human_reply_exists' };
    }

    const { data: history } = await supabaseAdmin.from('whatsapp_mensagens')
      .select('direction,remetente,mensagem,created_at').eq('conversa_id', options.conversationId)
      .order('created_at', { ascending: true }).limit(40);
    const historyText = (history || []).map((item) =>
      `${item.direction === 'outbound' ? 'Aline' : 'Lead'}: ${String(item.mensagem || '').trim()}`
    ).filter(Boolean).slice(-20).join('\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada.');
    const systemPrompt = String(config?.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT);
    const prompt = `${systemPrompt}

DADOS ATUAIS DO LEAD:
Nome: ${lead.nome || 'nao informado'}
Empresa: ${lead.empresa || 'nao informada'}
E-mail: ${lead.email || 'nao informado'}
Ja investiu em trafego: ${lead.ja_investiu_trafego || 'nao informado'}
Faturamento mensal: ${lead.faturamento_mensal || 'nao informado'}
Investimento mensal: ${lead.investimento || 'nao informado'}
Prioridade: ${lead.prioridade || 'nao informada'}
Vidas/leads por mes: ${lead.vidas || 'nao informado'}
Etapa: ${lead.status || 'Oportunidade'}

HISTORICO REAL DA CONVERSA:
${historyText || 'Nenhuma mensagem anterior registrada.'}

ULTIMA MENSAGEM RECEBIDA DO LEAD:
${options.customerMessage}

Responda somente com a proxima mensagem que Aline deve enviar. Nao repita a abertura, nao invente dados e faca no maximo uma pergunta.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini', temperature: 0.65,
        messages: [{ role: 'system', content: 'Responda apenas com a mensagem final, sem aspas, titulos ou explicacoes.' }, { role: 'user', content: prompt }] }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || 'A IA comercial nao conseguiu gerar a resposta.');
    const reply = normalizeSdrText(String(payload?.choices?.[0]?.message?.content || ''));
    if (!reply) throw new Error('A IA comercial retornou uma resposta vazia.');

    const phone = normalizePhone(options.phone || lead.telefone);
    const instance = lead.sdr_id ? uazapiInstanceName(lead.sdr_id) : COMMERCIAL_MASTER_INSTANCE;
    registerAiOutbound(phone, reply);
    const providerPayload = await uazapiFetch('/send/text', {
      method: 'POST', body: JSON.stringify({ number: phone, text: reply, delay: 1200 }),
    }, { instanceName: instance });
    await insertCommercialAiMessage(options.conversationId, reply, {
      ...(providerPayload || {}), instance, sdr_id: lead.sdr_id,
    });
    const updatedAt = new Date().toISOString();
    await Promise.all([
      supabaseAdmin.from('whatsapp_conversas').update({ ultima_mensagem_at: updatedAt, updated_at: updatedAt }).eq('id', options.conversationId),
      supabaseAdmin.from('comercial_leads').update({ ultimo_contato_at: updatedAt, updated_at: updatedAt }).eq('id', options.leadId),
    ]);
    return { handled: true, reply };
  } finally {
    locks.delete(options.leadId);
  }
}
