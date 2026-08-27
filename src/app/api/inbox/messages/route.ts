import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { uazapiFetch, uazapiInstanceName, normalizePhone } from '@/lib/uazapi';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeWhatsAppMessageId } from '@/lib/whatsappMessageId';
import { reciboAvanca, reciboDoProvedor } from '@/lib/whatsappRecibo';

const INBOX_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;
const WHATSAPP_REJECTION_RE = /whatsapp server rejected|rejected this message|not an internal api error|server rejected/i;

function normalizeOutboundText(text: string) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function splitSequenceText(text: string, maxChars = 650) {
  const normalized = normalizeOutboundText(text);
  if (!normalized) return [];

  const primaryParts = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const parts = primaryParts.length > 1
    ? primaryParts
    : normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const part of parts) {
    if (part.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      const words = part.split(/\s+/).filter(Boolean);
      let wordChunk = '';
      for (const word of words) {
        const next = wordChunk ? `${wordChunk} ${word}` : word;
        if (next.length > maxChars && wordChunk) {
          chunks.push(wordChunk);
          wordChunk = word;
        } else {
          wordChunk = next;
        }
      }
      if (wordChunk) chunks.push(wordChunk);
      continue;
    }

    const next = current ? `${current}\n\n${part}` : part;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [normalized];
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTextWithSequenceFallback(instance: string, phone: string, text: string) {
  const cleanText = normalizeOutboundText(text);
  const send = (message: string) => uazapiFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      text: message,
    }),
  }, { instanceName: instance });

  try {
    const payload = await send(cleanText);
    return { payload, text: cleanText, split: false, count: 1 };
  } catch (error: any) {
    const message = String(error?.message || '');
    const chunks = splitSequenceText(cleanText);
    const shouldRetryAsSequence = WHATSAPP_REJECTION_RE.test(message) && chunks.length > 1;

    if (!shouldRetryAsSequence) {
      throw error;
    }

    const payloads: any[] = [];
    for (const chunk of chunks) {
      payloads.push(await send(chunk));
      await wait(850);
    }

    return {
      payload: payloads[payloads.length - 1] || null,
      text: cleanText,
      split: true,
      count: payloads.length,
      payloads,
    };
  }
}

function dedupeMessages(messages: any[]) {
  const seenProviderIds = new Set<string>();
  const result: any[] = [];

  for (const message of messages || []) {
    const providerId = normalizeWhatsAppMessageId(message?.provider_message_id);
    if (providerId) {
      if (seenProviderIds.has(providerId)) continue;
      seenProviderIds.add(providerId);
    }
    result.push(message);
  }

  return result;
}

function providerMessages(payload: any): any[] {
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function providerChats(payload: any): any[] {
  if (Array.isArray(payload?.chats)) return payload.chats;
  if (Array.isArray(payload?.data?.chats)) return payload.data.chats;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function providerChatIds(instance: string, phone: string) {
  const digits = String(phone || '').replace(/\D/g, '');
  const last8 = digits.slice(-8);
  if (!last8) return [`${digits}@s.whatsapp.net`];

  const payload = await uazapiFetch('/chat/find', {
    method: 'POST',
    body: JSON.stringify({
      operator: 'OR',
      sort: '-wa_lastMsgTimestamp',
      limit: 50,
      offset: 0,
      wa_chatid: `~${last8}`,
      wa_fastid: `~${last8}`,
    }),
  }, { instanceName: instance });

  const ids = providerChats(payload)
    .map((chat) => String(chat?.wa_chatid || chat?.chatid || chat?.id || '').trim())
    .filter((chatId) => {
      if (!chatId || chatId.endsWith('@g.us')) return false;
      const chatDigits = chatId.split('@')[0].replace(/\D/g, '');
      return chatDigits.slice(-8) === last8;
    });

  return [...new Set(ids.length ? ids : [`${digits}@s.whatsapp.net`])];
}

function providerMessageText(message: any) {
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

  const messageType = String(message?.messageType || '').toLowerCase();
  if (messageType.includes('audio') || messageType.includes('ptt')) return 'Mensagem de voz';
  if (messageType.includes('image')) return 'Imagem';
  if (messageType.includes('video')) return 'Video';
  if (messageType.includes('document')) return 'Arquivo';
  if (message?.fileURL) return 'Arquivo';
  return '';
}

function providerCreatedAt(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date().toISOString();
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toISOString();
}

async function historyInstanceNames(conversation: any) {
  const profileIds = new Set<string>();
  if (conversation?.lead_id) {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('responsavel_profile_id')
      .eq('id', conversation.lead_id)
      .maybeSingle();
    if (lead?.responsavel_profile_id) profileIds.add(String(lead.responsavel_profile_id));
  }

  if (conversation?.corretor_id) {
    const { data: owners } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('corretor_id', conversation.corretor_id)
      .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro']);
    (owners || []).forEach((owner) => profileIds.add(String(owner.id)));
  }

  if (!profileIds.size) return [];
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, nome')
    .in('id', [...profileIds]);
  if (error) throw error;
  return (profiles || []).map((profile) => ({
    instance: uazapiInstanceName(String(profile.id)),
    senderName: String(profile.nome || 'Corretor'),
  }));
}

async function syncProviderHistory(conversation: any) {
  const phone = normalizePhone(conversation?.telefone || '');
  if (!phone) return;

  const instances = await historyInstanceNames(conversation);
  if (!instances.length) return;

  const collected = new Map<string, { message: any; instance: string }>();
  await Promise.all(instances.map(async ({ instance, senderName }) => {
    try {
      const chatIds = await providerChatIds(instance, phone);
      for (const chatid of chatIds) {
        let offset = 0;
        const limit = 500;
        for (let page = 0; page < 20; page += 1) {
          const payload = await uazapiFetch('/message/find', {
            method: 'POST',
            body: JSON.stringify({ chatid, limit, offset }),
          }, { instanceName: instance });
          const messages = providerMessages(payload);
          for (const message of messages) {
            const providerId = normalizeWhatsAppMessageId(message?.messageid || message?.id);
            if (providerId) collected.set(providerId, { message: { ...message, orionSenderName: senderName }, instance });
          }
          const hasMore = payload?.hasMore === true || payload?.data?.hasMore === true;
          if (!hasMore || messages.length === 0) break;
          offset = Number(payload?.nextOffset ?? payload?.data?.nextOffset ?? (offset + messages.length));
        }
      }
    } catch (error) {
      console.warn('[inbox_messages] Nao foi possivel sincronizar o historico da instancia.', {
        instance,
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  if (!collected.size) return;
  const existingIds = new Set<string>();
  const existingRows = new Map<string, { id: string; metadata: any }>();
  const existingPageSize = 1000;
  for (let from = 0; ; from += existingPageSize) {
    const { data: page, error } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('id, provider_message_id, metadata')
      .eq('conversa_id', conversation.id)
      .not('provider_message_id', 'is', null)
      .range(from, from + existingPageSize - 1);
    if (error) throw error;
    (page || []).forEach((row) => {
      const providerId = normalizeWhatsAppMessageId(row.provider_message_id);
      if (!providerId) return;
      existingIds.add(providerId);
      existingRows.set(providerId, { id: row.id, metadata: row.metadata });
    });
    if (!page || page.length < existingPageSize) break;
  }

  // O historico do provedor ja diz se cada mensagem foi entregue ou lida. O
  // evento de atualizacao nem sempre chega, entao o recibo e conferido aqui:
  // abrir a conversa e o momento em que o corretor precisa saber se o que ele
  // mandou chegou mesmo. So as ultimas, para nao virar enxurrada de update.
  const pendentesDeRecibo = [...collected.entries()]
    .filter(([providerId]) => existingRows.has(providerId))
    .map(([providerId, entry]) => ({ providerId, entry, recibo: reciboDoProvedor(entry.message?.status) }))
    .filter(({ recibo, providerId }) => recibo && reciboAvanca(existingRows.get(providerId)?.metadata?.recibo, recibo))
    .slice(-40);

  for (const { providerId, recibo } of pendentesDeRecibo) {
    const linha = existingRows.get(providerId);
    if (!linha) continue;
    await supabaseAdmin
      .from('whatsapp_mensagens')
      .update({ metadata: { ...(linha.metadata || {}), recibo, recibo_at: new Date().toISOString() } })
      .eq('id', linha.id);
  }

  const rows = [...collected.entries()]
    .filter(([providerId]) => !existingIds.has(providerId))
    .map(([providerId, entry]) => {
      const message = entry.message;
      const text = providerMessageText(message);
      if (!text) return null;
      return {
        conversa_id: conversation.id,
        direction: message?.fromMe === true ? 'outbound' : 'inbound',
        remetente: message?.fromMe === true
          ? String(message?.orionSenderName || 'Corretor')
          : String(message?.senderName || conversation.nome_contato || phone),
        mensagem: text,
        provider_message_id: providerId,
        created_at: providerCreatedAt(message?.messageTimestamp),
        metadata: { ...message, instance: entry.instance, synced_from: 'uazapi_message_find' },
      };
    })
    .filter(Boolean);

  for (let index = 0; index < rows.length; index += 250) {
    const batch = rows.slice(index, index + 250) as any[];
    const { error } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .insert(batch);
    if (!error) continue;
    if (error.code !== '23505') throw error;

    // Existe um indice unico parcial para provider_message_id. O PostgREST
    // nao consegue usa-lo como alvo de ON CONFLICT, entao em uma corrida entre
    // webhook e sincronizacao repetimos individualmente e ignoramos somente a
    // duplicidade confirmada.
    for (const row of batch) {
      const { error: rowError } = await supabaseAdmin
        .from('whatsapp_mensagens')
        .insert(row);
      if (rowError && rowError.code !== '23505') throw rowError;
    }
  }

  const latest = rows.reduce<string | null>((current, row: any) => (
    !current || row.created_at > current ? row.created_at : current
  ), null);
  if (latest) {
    await supabaseAdmin
      .from('whatsapp_conversas')
      .update({ ultima_mensagem_at: latest, updated_at: new Date().toISOString() })
      .eq('id', conversation.id);
  }
}

async function getConversation(id: string) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function canParticipateInSharedLead(profileId: string, leadId: string) {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('responsavel_profile_id, corretor:corretor_id(nome_empresa)')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead || lead.responsavel_profile_id) return false;
  const broker = Array.isArray(lead.corretor) ? lead.corretor[0] : lead.corretor;
  const brokerageName = String((broker as any)?.nome_empresa || '').trim();
  if (!brokerageName) return false;
  const { data: config } = await supabaseAdmin.from('corretoras')
    .select('distribuicao_modelo').ilike('nome', brokerageName).maybeSingle();
  if (config?.distribuicao_modelo !== 'fila_compartilhada') return false;
  const { data: membership } = await supabaseAdmin.from('corretor_time_membros')
    .select('id, time:time_id!inner(ativo, corretor:corretor_id!inner(nome_empresa))')
    .eq('profile_id', profileId)
    .in('status', ['active', 'ativo', 'Ativo'])
    .neq('participa_rodizio', false);
  return (membership || []).some((item: any) => {
    const team = Array.isArray(item.time) ? item.time[0] : item.time;
    const owner = Array.isArray(team?.corretor) ? team.corretor[0] : team?.corretor;
    return team?.ativo !== false && String(owner?.nome_empresa || '').trim().toLowerCase() === brokerageName.toLowerCase();
  });
}

async function canAccessConversation(profile: any, conversation: any) {
  if (!conversation) return false;
  if (profile.tipo_usuario === 'admin' || profile.tipo_usuario === 'account_manager') return true;

  // O papel no Kripto Hunter prevalece sobre o papel operacional do profile.
  // Assim SDRs ficam isolados mesmo quando o cadastro base e "corretor", e
  // closer/coordenador conseguem supervisionar as conversas comerciais.
  const { data: commercialMember } = await supabaseAdmin
    .from('comercial_membros')
    .select('papel,ativo')
    .eq('profile_id', profile.id)
    .eq('ativo', true)
    .maybeSingle();
  if (commercialMember) {
    const commercialPhone = String(conversation.telefone || '').replace(/\D/g, '');
    const commercialLast8 = commercialPhone.slice(-8);
    if (commercialLast8) {
      const commercialLast4 = commercialLast8.slice(-4);
      const { data: commercialCandidates } = await supabaseAdmin
        .from('comercial_leads')
        .select('id,sdr_id,closer_id,telefone')
        .ilike('telefone', `%${commercialLast4}`)
        .limit(100);
      const commercialLead = (commercialCandidates || []).find((lead) => {
        const leadPhone = String(lead.telefone || '').replace(/\D/g, '');
        const samePhone = leadPhone.slice(-8) === commercialLast8;
        return samePhone && (commercialMember.papel !== 'sdr' || lead.sdr_id === profile.id);
      });
      if (commercialLead) return true;
    }
    // Se e conversa comercial mas nao pertence ao SDR, nao deixa a regra de
    // corretora abaixo abrir acesso cruzado por coincidencia de corretor_id.
    if (commercialMember.papel === 'sdr' && !conversation.corretor_id) return false;
  }

  if (conversation.lead_id && profile.tipo_usuario !== 'corretor_membro') {
    const { data: assignedLead } = await supabaseAdmin
      .from('leads')
      .select('responsavel_profile_id')
      .eq('id', conversation.lead_id)
      .maybeSingle();
    if (assignedLead?.responsavel_profile_id === profile.id) return true;
  }
  if (profile.tipo_usuario === 'corretor_membro') {
    if (conversation.lead_id) {
      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('responsavel_profile_id')
        .eq('id', conversation.lead_id)
        .maybeSingle();
      if (lead?.responsavel_profile_id === profile.id) return true;
      if (!lead?.responsavel_profile_id && await canParticipateInSharedLead(profile.id, conversation.lead_id)) return true;
    }

    if (commercialMember) return false;
  }
  if (!profile.corretor_id) return false;
  if (profile.corretor_id === conversation.corretor_id) return true;

  if (profile.nome_empresa && conversation.corretor_id) {
    const { data: convBroker } = await supabaseAdmin
      .from('corretores')
      .select('nome_empresa')
      .eq('id', conversation.corretor_id)
      .maybeSingle();

    if (convBroker?.nome_empresa && convBroker.nome_empresa.trim().toLowerCase() === profile.nome_empresa.trim().toLowerCase()) {
      return true;
    }
  }
  return false;
}

async function findExistingConversation(corretorId: string, phone: string, leadId?: string | null) {
  if (leadId) {
    const { data } = await supabaseAdmin
      .from('whatsapp_conversas')
      .select('*')
      .eq('corretor_id', corretorId)
      .eq('lead_id', leadId)
      .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (data) return data;
  }

  const digits = phone.replace(/\D/g, '');
  const last8 = digits.length >= 8 ? digits.slice(-8) : '';

  let query = supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('corretor_id', corretorId);

  if (last8) {
    query = query.or(`telefone.eq.${phone},telefone.ilike.%${last8}`);
  } else {
    query = query.eq('telefone', phone);
  }

  const { data } = await query
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return data;
}

async function findAccessibleConversationIdsByPhone(profile: any, conversation: any) {
  const phone = normalizePhone(conversation?.telefone || '');
  const digits = phone.replace(/\D/g, '');
  const last8 = digits.length >= 8 ? digits.slice(-8) : '';

  if (!last8) return [conversation.id];

  const data: any[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabaseAdmin
      .from('whatsapp_conversas')
      .select('id, lead_id, corretor_id, telefone')
      .or(`telefone.eq.${phone},telefone.ilike.%${last8}`)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    data.push(...(page || []));
    if (!page || page.length < pageSize) break;
  }

  const accessible: string[] = [];
  for (const candidate of data || []) {
    if (await canAccessConversation(profile, candidate)) {
      accessible.push(candidate.id);
    }
  }

  return Array.from(new Set([conversation.id, ...accessible])).filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'inbox:messages:read', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, [...INBOX_ROLES]);
    if ('error' in guard) return guard.error;

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversation_id');
    if (!conversationId) {
      return NextResponse.json({ error: 'Selecione uma conversa.' }, { status: 400 });
    }

    const conversation = await getConversation(conversationId);
    if (!(await canAccessConversation(guard.profile, conversation))) {
      return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
    }

    const conversationIds = await findAccessibleConversationIdsByPhone(guard.profile, conversation);

    // Reserva orfa: a linha e gravada antes de chamar o provedor e apagada
    // quando o envio falha. Se o processo morre no meio, ela fica no banco com
    // cara de mensagem enviada e o corretor jura que mandou algo que nunca
    // chegou ao WhatsApp. O provedor tem 15s de limite, entao qualquer reserva
    // parada ha mais de tres minutos e envio morto.
    await supabaseAdmin
      .from('whatsapp_mensagens')
      .delete()
      .in('conversa_id', conversationIds)
      .like('provider_message_id', 'orion-client:%')
      .lt('created_at', new Date(Date.now() - 3 * 60_000).toISOString());

    // O banco local pode estar incompleto quando mensagens foram trocadas
    // diretamente no WhatsApp ou chegaram durante uma falha do webhook.
    // Ao abrir a conversa, reconcilia o historico mantido pela instancia antes
    // de montar a timeline exibida no Inbox.
    await syncProviderHistory(conversation);

    // Um mesmo contato pode possuir conversas diferentes quando foi atendido
    // por integrantes/instancias distintas. O Inbox deve apresentar uma unica
    // timeline, respeitando somente as conversas que o usuario pode acessar.
    const history: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: page, error } = await supabaseAdmin
        .from('whatsapp_mensagens')
        .select('*')
        .in('conversa_id', conversationIds)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      history.push(...(page || []));
      if (!page || page.length < pageSize) break;
    }

    return NextResponse.json({
      messages: dedupeMessages(history),
      conversation_ids: conversationIds,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao consegui carregar as mensagens.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const limited = rateLimit(request, 'inbox:conversation:status', { limit: 30, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, [...INBOX_ROLES]);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const conversationId = String(body.conversation_id || '').trim();
    const requestedStatus = String(body.status || '').trim().toLowerCase();
    const dbStatus = requestedStatus === 'fechada'
      ? 'resolvida'
      : requestedStatus === 'espera'
        ? 'aguardando'
        : requestedStatus === 'aberta' || requestedStatus === 'pausada'
          ? 'aberta'
          : '';

    if (!conversationId || !dbStatus) {
      return NextResponse.json({ error: 'Conversa ou status invalido.' }, { status: 400 });
    }

    const conversation = await getConversation(conversationId);
    if (!(await canAccessConversation(guard.profile, conversation))) {
      return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
    }

    // O Inbox consolida conversas do mesmo telefone em uma unica timeline.
    // O arquivamento precisa acompanhar essa mesma regra para que um registro
    // duplicado nao devolva o contato para a caixa ativa apos o F5.
    const conversationIds = await findAccessibleConversationIdsByPhone(guard.profile, conversation);
    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('whatsapp_conversas')
      .update({ status: dbStatus, updated_at: now })
      .in('id', conversationIds)
      .select('id');

    if (error) throw error;
    const updatedIds = (updated || []).map((item) => String(item.id));
    if (!updatedIds.length) {
      return NextResponse.json({ error: 'Nenhuma conversa foi atualizada.' }, { status: 409 });
    }

    await writeAuditLog(request, guard.profile, {
      action: dbStatus === 'resolvida' ? 'whatsapp.conversation.close' : 'whatsapp.conversation.reopen',
      entity_type: 'whatsapp_conversa',
      entity_id: conversationId,
      metadata: { status: dbStatus, conversation_ids: updatedIds },
    });

    return NextResponse.json({ success: true, status: dbStatus, conversation_ids: updatedIds });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel atualizar a conversa.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let reservedMessageId: string | null = null;

  try {
    const limited = rateLimit(request, 'inbox:messages:send', { limit: 30, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, [...INBOX_ROLES]);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    let conversationId = String(body.conversation_id || '');
    const text = String(body.mensagem || '').trim();
    const phoneParam = String(body.telefone || '').trim();
    const leadIdParam = String(body.lead_id || '').trim();
    const nameParam = String(body.nome_contato || '').trim();
    const clientMessageId = String(body.client_message_id || '')
      .replace(/[^a-zA-Z0-9:_-]/g, '')
      .slice(0, 160);

    // Novas propriedades de mídia
    const mediaBase64 = String(body.media || '').trim();
    const mimetype = String(body.mimetype || '').trim();
    const fileName = String(body.fileName || '').trim();
    const mediatype = String(body.mediatype || '').trim();

    if ((!conversationId && !phoneParam) || (!text && !mediaBase64)) {
      return NextResponse.json({ error: 'Escreva uma mensagem ou envie um arquivo.' }, { status: 400 });
    }

    let conversation: any = null;

    if (conversationId && !conversationId.startsWith('new-')) {
      conversation = await getConversation(conversationId);
      if (!(await canAccessConversation(guard.profile, conversation))) {
        return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
      }
    } else {
      let corretorId = guard.profile.corretor_id;

      // Se for admin/gerente e não tiver corretor_id, tenta obter do lead
      if (!corretorId && leadIdParam) {
        const { data: leadData } = await supabaseAdmin
          .from('leads')
          .select('corretor_id')
          .eq('id', leadIdParam)
          .maybeSingle();
        if (leadData?.corretor_id) {
          corretorId = leadData.corretor_id;
        }
      }

      if (!corretorId) {
        return NextResponse.json({ 
          error: 'Apenas corretores vinculados ou administradores atendendo a um lead com corretor podem iniciar conversas.' 
        }, { status: 400 });
      }

      if (guard.profile.tipo_usuario === 'corretor_membro') {
        if (!leadIdParam) {
          return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
        }
        const { data: leadAccess } = await supabaseAdmin
          .from('leads')
          .select('responsavel_profile_id')
          .eq('id', leadIdParam)
          .maybeSingle();
        if (leadAccess?.responsavel_profile_id !== guard.profile.id && !(await canParticipateInSharedLead(guard.profile.id, leadIdParam))) {
          return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
        }
      }

      const phone = normalizePhone(phoneParam || conversationId.replace('new-', ''));
      if (!phone) {
        return NextResponse.json({ error: 'Telefone do contato invalido.' }, { status: 400 });
      }

      const existing = await findExistingConversation(corretorId, phone, leadIdParam || null);

      if (existing) {
        conversation = existing;
        conversationId = existing.id;
      } else {
        let contactName = nameParam || phone;
        if (leadIdParam && (!nameParam || nameParam === 'Novo Contato')) {
          const { data: leadData } = await supabaseAdmin
            .from('leads')
            .select('nome')
            .eq('id', leadIdParam)
            .maybeSingle();
          if (leadData?.nome) {
            contactName = leadData.nome;
          }
        }
        const { data: created, error: createError } = await supabaseAdmin
          .from('whatsapp_conversas')
          .insert([{
            corretor_id: corretorId,
            lead_id: leadIdParam || null,
            telefone: phone,
            nome_contato: contactName,
            status: 'aberta',
            ultima_mensagem_at: new Date().toISOString(),
          }])
          .select('*')
          .single();

        if (createError) throw createError;
        conversation = created;
        conversationId = created.id;
      }

      if (!(await canAccessConversation(guard.profile, conversation))) {
        return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
      }
    }

    const phone = normalizePhone(conversation.telefone);
    if (!phone) {
      return NextResponse.json({ error: 'Telefone do contato invalido.' }, { status: 400 });
    }

    let senderProfile: any = guard.profile;
    let senderProfileId = guard.profile.id;
    const viewingProfileId = request.headers.get('x-commercial-view-profile-id')
      || request.headers.get('x-orion-view-profile-id');
    if (viewingProfileId && (guard.profile.tipo_usuario === 'admin' || viewingProfileId === guard.profile.id)) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, email_real, tipo_usuario, corretor_id')
        .eq('id', viewingProfileId)
        .maybeSingle();
      if (data) {
        senderProfile = data;
        senderProfileId = data.id;
      }
    }

    if (conversation.lead_id && ['corretor', 'corretor_admin', 'corretor_membro'].includes(senderProfile.tipo_usuario)) {
      const { data: claimResult, error: claimError } = await supabaseAdmin.rpc('claim_shared_lead', {
        target_lead_id: conversation.lead_id,
        claimant_profile_id: senderProfileId,
      });
      if (claimError && !/not_shared_queue/i.test(claimError.message || '')) throw claimError;
      const claim = claimResult as any;
      const enforceExclusiveOwnership = senderProfile.tipo_usuario === 'corretor_membro';

      // Donos e administradores da corretora mantêm a supervisão do inbox e
      // podem responder leads do próprio time. A exclusividade evita apenas
      // que dois integrantes operacionais atendam o mesmo lead.
      if (enforceExclusiveOwnership && claim?.reason === 'already_claimed' && claim?.responsavel_profile_id !== senderProfileId) {
        return NextResponse.json({ error: 'Este lead acabou de ser assumido por outro atendente. Atualize a conversa para ver o responsável.' }, { status: 409 });
      }
      if (enforceExclusiveOwnership && claim?.reason === 'not_participant') {
        return NextResponse.json({ error: 'Você não participa da distribuição de novos leads desta concessionária.' }, { status: 403 });
      }
    }

    const instance = uazapiInstanceName(senderProfileId);
    const reservationProviderId = clientMessageId ? `orion-client:${clientMessageId}` : null;
    let messageTextDb = text;
    if (mediaBase64) {
      const typeLabel = mediatype === 'image' ? '📷 Imagem' : mediatype === 'audio' ? '🎤 Mensagem de voz' : mediatype === 'video' ? '🎥 Vídeo' : '📎 Arquivo';
      messageTextDb = text ? `${typeLabel}: ${text}` : `${typeLabel} (${fileName})`;
    }

    if (reservationProviderId) {
      const { data: reserved, error: reservationError } = await supabaseAdmin
        .from('whatsapp_mensagens')
        .insert([{
          conversa_id: conversationId,
          direction: 'outbound',
          remetente: senderProfile.nome || senderProfile.email_real || senderProfile.email || 'Orion',
          mensagem: messageTextDb,
          provider_message_id: reservationProviderId,
          metadata: {
            instance,
            client_message_id: clientMessageId,
            send_status: 'sending',
            sender_profile_id: senderProfileId,
            sender_name: senderProfile.nome || senderProfile.email_real || senderProfile.email || 'Orion',
            sender_type: 'human',
          },
        }])
        .select('*')
        .single();

      if (reservationError?.code === '23505') {
        const { data: existing } = await supabaseAdmin
          .from('whatsapp_mensagens')
          .select('*')
          .eq('conversa_id', conversationId)
          .eq('provider_message_id', reservationProviderId)
          .maybeSingle();

        return NextResponse.json({
          success: true,
          message: existing,
          conversation,
          deduplicated: true,
        });
      }
      if (reservationError) throw reservationError;
      reservedMessageId = reserved.id;
    }
    
    let payload: any = null;
    let outboundMediaMetadata: Record<string, any> = {};

    if (mediaBase64) {
      const dataUrl = mediaBase64.includes(';base64,') 
        ? mediaBase64 
        : `data:${mimetype || 'application/octet-stream'};base64,${mediaBase64}`;

      const mediaTypeMapped = mediatype === 'audio' ? 'ptt' : (mediatype || 'document');
      const cleanBase64 = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : dataUrl;
      outboundMediaMetadata = {
        media_base64: cleanBase64,
        media_mimetype: mimetype || 'application/octet-stream',
        media_file_name: fileName || null,
        mediaType: mediaTypeMapped,
      };

      const audioDelay = mediatype === 'audio' ? 2500 : undefined;

      if (mediatype === 'audio') {
        try {
          await uazapiFetch('/message/presence', {
            method: 'POST',
            body: JSON.stringify({
              number: phone,
              presence: 'recording',
              delay: audioDelay || 2500,
            }),
          }, { instanceName: instance });
        } catch (presenceErr) {
          console.warn('[inbox_messages] Failed sending recording presence before audio:', presenceErr);
        }
      }

      payload = await uazapiFetch('/send/media', {
        method: 'POST',
        body: JSON.stringify({
          number: phone,
          file: dataUrl,
          type: mediaTypeMapped,
          text: text || undefined,
          mimetype: mimetype || undefined,
          delay: audioDelay,
        }),
      }, { instanceName: instance });
    } else {
      const result = await sendTextWithSequenceFallback(instance, phone, text);
      payload = {
        ...(result.payload || {}),
        orion_sequence_sent: result.split,
        orion_sequence_count: result.count,
        orion_sequence_payloads: result.payloads,
      };
    }

    const providerId =
      payload?.key?.id ||
      payload?.message?.key?.id ||
      payload?.data?.key?.id ||
      payload?.id ||
      null;

    const persistedMessage = {
      mensagem: messageTextDb,
      provider_message_id: providerId || reservationProviderId,
      metadata: {
        ...(payload || {}),
        ...outboundMediaMetadata,
        instance,
        client_message_id: clientMessageId || null,
        send_status: 'sent',
        sender_profile_id: senderProfileId,
        sender_name: senderProfile.nome || senderProfile.email_real || senderProfile.email || 'Orion',
        sender_type: 'human',
      },
    };

    const persistenceResult = reservedMessageId
      ? await supabaseAdmin
          .from('whatsapp_mensagens')
          .update(persistedMessage)
          .eq('id', reservedMessageId)
          .select('*')
          .single()
      : await supabaseAdmin
          .from('whatsapp_mensagens')
          .insert([{
            conversa_id: conversationId,
            direction: 'outbound',
            remetente: senderProfile.nome || senderProfile.email_real || senderProfile.email || 'Orion',
            ...persistedMessage,
          }])
          .select('*')
          .single();

    let inserted = persistenceResult.data;
    let insertError = persistenceResult.error;

    // O webhook do provedor pode registrar a mensagem antes de a resposta do
    // envio voltar. Nesse caso, mantém o registro do webhook e remove apenas
    // a reserva local, sem informar falha para uma mensagem que já foi enviada.
    if (insertError?.code === '23505' && providerId) {
      if (reservedMessageId) {
        await supabaseAdmin
          .from('whatsapp_mensagens')
          .delete()
          .eq('id', reservedMessageId);
      }

      const { data: providerMessage } = await supabaseAdmin
        .from('whatsapp_mensagens')
        .select('*')
        .eq('conversa_id', conversationId)
        .eq('provider_message_id', providerId)
        .maybeSingle();

      if (providerMessage) {
        inserted = providerMessage;
        insertError = null;
        reservedMessageId = null;
      }
    }

    if (insertError) throw insertError;
    reservedMessageId = null;

    await supabaseAdmin
      .from('whatsapp_conversas')
      .update({ ultima_mensagem_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    await writeAuditLog(request, guard.profile, {
      action: 'whatsapp.message.send',
      entity_type: 'whatsapp_conversa',
      entity_id: conversationId,
      metadata: { phone },
    });

    return NextResponse.json({ success: true, message: inserted, conversation });
  } catch (error: any) {
    if (reservedMessageId) {
      await supabaseAdmin
        .from('whatsapp_mensagens')
        .delete()
        .eq('id', reservedMessageId);
    }
    console.error('[POST /api/inbox/messages] ERROR:', error);
    const rawMessage = String(error?.message || '');
    if (/not connected|disconnected|logged out|session.+(?:close|offline)|connection closed/i.test(rawMessage)) {
      return NextResponse.json({
        error: 'O WhatsApp esta desconectado. Reconecte a conta pelo QR Code antes de enviar novamente.',
      }, { status: 409 });
    }
    if (WHATSAPP_REJECTION_RE.test(rawMessage)) {
      return NextResponse.json({
        error: 'O WhatsApp recusou essa mensagem. Tente enviar em partes menores ou confirme se o numero tem WhatsApp ativo.',
      }, { status: 422 });
    }
    return NextResponse.json({ error: rawMessage || 'Nao consegui enviar a mensagem agora.' }, { status: 500 });
  }
}
