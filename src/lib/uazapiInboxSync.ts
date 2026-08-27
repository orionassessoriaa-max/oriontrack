import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, phoneMatchKey, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';
import { normalizeWhatsAppMessageId } from '@/lib/whatsappMessageId';

type InboxConversationForSync = {
  id: string;
  telefone?: string | null;
  nome_contato?: string | null;
  ultima_mensagem_at?: string | null;
};

const SYNC_INTERVAL_MS = 25_000;
const MAX_CHANGED_CHATS_PER_RUN = 12;
const syncTimes = new Map<string, number>();
const syncLocks = new Map<string, Promise<void>>();

function asChats(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.chats)) return payload.chats;
  if (Array.isArray(payload?.data?.chats)) return payload.data.chats;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function asMessages(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function providerText(message: any) {
  const direct = String(message?.text || '').trim();
  if (direct) return direct;

  let content = message?.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      if (content.trim()) return content.trim();
    }
  }

  const candidates = [
    content?.conversation,
    content?.text,
    content?.caption,
    content?.extendedTextMessage?.text,
    content?.imageMessage?.caption,
    content?.videoMessage?.caption,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  const type = String(message?.messageType || '').toLowerCase();
  if (type.includes('audio') || type.includes('ptt')) return 'Mensagem de voz';
  if (type.includes('image')) return 'Imagem';
  if (type.includes('video')) return 'Video';
  if (type.includes('document') || message?.fileURL) return 'Arquivo';
  return '';
}

function providerDate(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function chatId(chat: any) {
  return String(chat?.wa_chatid || chat?.chatid || chat?.id || '').trim();
}

function chatTimestamp(chat: any) {
  return providerDate(chat?.wa_lastMsgTimestamp || chat?.lastMsgTimestamp || chat?.updatedAt || chat?.timestamp);
}

async function insertMissingMessages(
  instance: string,
  profileId: string,
  senderName: string,
  conversation: InboxConversationForSync,
  messages: any[],
) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('provider_message_id')
    .eq('conversa_id', conversation.id)
    .not('provider_message_id', 'is', null);
  if (existingError) throw existingError;

  const existingIds = new Set(
    (existing || []).map((row) => normalizeWhatsAppMessageId(row.provider_message_id)).filter(Boolean),
  );

  const rows = messages
    .map((message) => {
      const providerId = normalizeWhatsAppMessageId(message?.messageid || message?.id);
      const text = providerText(message);
      const createdAt = providerDate(message?.messageTimestamp);
      if (!providerId || existingIds.has(providerId) || !text || !createdAt) return null;
      existingIds.add(providerId);
      return {
        conversa_id: conversation.id,
        direction: message?.fromMe === true ? 'outbound' : 'inbound',
        remetente: message?.fromMe === true
          ? senderName
          : String(message?.senderName || conversation.nome_contato || normalizePhone(conversation.telefone)),
        mensagem: text,
        provider_message_id: providerId,
        created_at: createdAt,
        metadata: {
          ...message,
          instance,
          synced_from: 'uazapi_recent_chat_sync',
          sender_profile_id: message?.fromMe === true ? profileId : undefined,
          sender_name: message?.fromMe === true ? senderName : undefined,
          sender_type: message?.fromMe === true ? 'human' : undefined,
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (const row of rows) {
    const { error } = await supabaseAdmin.from('whatsapp_mensagens').insert(row);
    if (error && error.code !== '23505') throw error;
  }

  const latest = rows.reduce<string | null>((current, row: any) => (
    !current || row.created_at > current ? row.created_at : current
  ), null);
  if (latest) {
    const { error } = await supabaseAdmin
      .from('whatsapp_conversas')
      .update({ ultima_mensagem_at: latest, updated_at: new Date().toISOString() })
      .eq('id', conversation.id);
    if (error) throw error;
  }
}

async function runRecentSync(profileId: string, conversations: InboxConversationForSync[]) {
  const instance = uazapiInstanceName(profileId);
  const { data: sender } = await supabaseAdmin
    .from('profiles')
    .select('nome')
    .eq('id', profileId)
    .maybeSingle();
  const senderName = String(sender?.nome || 'Corretor');
  const byPhone = new Map<string, InboxConversationForSync>();
  for (const conversation of conversations) {
    const key = phoneMatchKey(conversation.telefone);
    if (key && !byPhone.has(key)) byPhone.set(key, conversation);
  }
  if (!byPhone.size) return;

  const payload = await uazapiFetch('/chat/find', {
    method: 'POST',
    body: JSON.stringify({ sort: '-wa_lastMsgTimestamp', limit: 300, offset: 0 }),
  }, { instanceName: instance });

  const changed = asChats(payload)
    .map((chat) => {
      const id = chatId(chat);
      if (!id || id.endsWith('@g.us')) return null;
      const conversation = byPhone.get(phoneMatchKey(id.split('@')[0]));
      const providerLatest = chatTimestamp(chat);
      if (!conversation || !providerLatest) return null;
      const localLatest = conversation.ultima_mensagem_at
        ? new Date(conversation.ultima_mensagem_at).getTime()
        : 0;
      if (new Date(providerLatest).getTime() <= localLatest + 1_000) return null;
      return { id, conversation };
    })
    .filter(Boolean)
    .slice(0, MAX_CHANGED_CHATS_PER_RUN) as Array<{ id: string; conversation: InboxConversationForSync }>;

  await Promise.all(changed.map(async ({ id, conversation }) => {
    const history = await uazapiFetch('/message/find', {
      method: 'POST',
      body: JSON.stringify({ chatid: id, limit: 250, offset: 0 }),
    }, { instanceName: instance });
    await insertMissingMessages(instance, profileId, senderName, conversation, asMessages(history));
  }));
}

export async function syncRecentInboxChats(profileId: string, conversations: InboxConversationForSync[]) {
  const key = String(profileId || '').trim();
  if (!key || !conversations.length) return;

  const running = syncLocks.get(key);
  if (running) return running;
  const lastRun = syncTimes.get(key) || 0;
  if (Date.now() - lastRun < SYNC_INTERVAL_MS) return;

  const operation = runRecentSync(key, conversations)
    .catch((error) => {
      console.warn('[Inbox recent sync] Falha ao reconciliar mensagens do celular:', {
        profileId: key,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      syncTimes.set(key, Date.now());
      syncLocks.delete(key);
    });

  syncLocks.set(key, operation);
  return operation;
}
