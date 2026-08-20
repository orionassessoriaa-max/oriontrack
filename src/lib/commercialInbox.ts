import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, phoneMatchKey } from '@/lib/uazapi';

// A operacao comercial nao pertence a nenhuma corretora: as conversas da IA SDR
// ficam com corretor_id nulo e lead_id nulo (o lead_id de whatsapp_conversas
// referencia public.leads, nao comercial_leads). O vinculo com o lead comercial
// e feito pelo telefone, igual ao inbox comercial.
export const COMMERCIAL_AI_AGENT = 'commercial_sdr';

export async function findCommercialConversation(phone: string) {
  const digits = normalizePhone(phone);
  if (digits.length < 8) return null;
  const last8 = digits.slice(-8);
  const { data } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .is('corretor_id', null)
    .or(`telefone.eq.${digits},telefone.ilike.%${last8}`)
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
    .limit(20);

  const key = phoneMatchKey(digits);
  return (data || []).find((row) => phoneMatchKey(row?.telefone) === key) || null;
}

export async function ensureCommercialConversation(phone: string, contactName?: string | null) {
  const digits = normalizePhone(phone);
  if (digits.length < 8) throw new Error('Telefone invalido para conversa comercial.');
  const existing = await findCommercialConversation(digits);
  if (existing) return existing;

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .insert([{
      corretor_id: null,
      lead_id: null,
      telefone: digits,
      nome_contato: String(contactName || '').trim() || digits,
      status: 'aberta',
      ultima_mensagem_at: now,
    }])
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// O prompt salvo no banco tem "\n" escrito de forma literal no exemplo de tom,
// e a IA as vezes copia isso na resposta. Vira quebra de linha de verdade.
export function normalizeSdrText(text: string) {
  return String(text || '').replace(/\\r\\n|\\n/g, '\n').trim();
}

export async function insertCommercialAiMessage(
  conversationId: string,
  text: string,
  metadata: Record<string, unknown> = {}
) {
  const { error } = await supabaseAdmin.from('whatsapp_mensagens').insert([{
    conversa_id: conversationId,
    direction: 'outbound',
    remetente: 'Orion',
    mensagem: text,
    metadata: { ...metadata, ai_agent: COMMERCIAL_AI_AGENT },
  }]);
  if (error) throw error;
}

function messageSignature(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * O outbound recebido pelo webhook e apenas o eco de uma mensagem que a IA
 * comercial acabou de enviar? Serve para nao confundir o proprio robo com um
 * humano assumindo a conversa pelo inbox.
 */
export async function isCommercialAiEcho(conversationId: string, text: string, windowMs = 300_000) {
  const signature = messageSignature(text);
  if (!signature) return false;
  const { data } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('mensagem,metadata,created_at')
    .eq('conversa_id', conversationId)
    .eq('direction', 'outbound')
    .gte('created_at', new Date(Date.now() - windowMs).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  return (data || []).some((row) => {
    const agent = (row?.metadata as Record<string, unknown> | null)?.ai_agent;
    if (agent !== COMMERCIAL_AI_AGENT && agent !== 'commercial_bot') return false;
    return messageSignature(row.mensagem || '') === signature;
  });
}

// A UAZAPI devolve por webhook as mensagens que a propria IA enviou (fromMe),
// e elas entram como outbound. Sem separar isso, qualquer resposta rapida do
// lead cai na trava de "alguem acabou de responder" e a IA fica muda.
export async function hasRecentHumanOutbound(conversationId: string, windowMs: number) {
  const { data } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('mensagem,metadata,created_at')
    .eq('conversa_id', conversationId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(40);

  const rows = (data || []) as Array<{ mensagem: string | null; metadata: Record<string, unknown> | null; created_at: string }>;
  const isAiRow = (row: { metadata: Record<string, unknown> | null }) => row?.metadata?.ai_agent === COMMERCIAL_AI_AGENT;
  const aiTexts = new Set(rows.filter(isAiRow).map((row) => messageSignature(row.mensagem || '')));

  const since = Date.now() - windowMs;
  return rows.some((row) => {
    if (new Date(row.created_at).getTime() < since) return false;
    if (isAiRow(row)) return false;
    return !aiTexts.has(messageSignature(row.mensagem || ''));
  });
}
