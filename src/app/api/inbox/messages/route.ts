import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { uazapiFetch, uazapiInstanceName, normalizePhone } from '@/lib/uazapi';
import { supabaseAdmin } from '@/lib/supabase/admin';

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
  const seenRecentContent = new Set<string>();
  const result: any[] = [];

  for (const message of messages || []) {
    const providerId = String(message?.provider_message_id || '').trim();
    if (providerId) {
      if (seenProviderIds.has(providerId)) continue;
      seenProviderIds.add(providerId);
    }

    const createdAt = message?.created_at ? new Date(message.created_at).getTime() : 0;
    const bucket = createdAt ? Math.floor(createdAt / 30_000) : 0;
    const contentKey = [
      message?.conversa_id || '',
      message?.direction || '',
      message?.remetente || '',
      String(message?.mensagem || '').trim(),
      bucket,
    ].join('|');

    if (contentKey.trim() && seenRecentContent.has(contentKey)) continue;
    seenRecentContent.add(contentKey);
    result.push(message);
  }

  return result;
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

async function canAccessConversation(profile: any, conversation: any) {
  if (!conversation) return false;
  if (profile.tipo_usuario === 'admin' || profile.tipo_usuario === 'account_manager') return true;
  if (profile.tipo_usuario === 'corretor_membro') {
    if (!conversation.lead_id) return false;
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('responsavel_profile_id')
      .eq('id', conversation.lead_id)
      .maybeSingle();
    return lead?.responsavel_profile_id === profile.id;
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

  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('id, lead_id, corretor_id, telefone')
    .or(`telefone.eq.${phone},telefone.ilike.%${last8}`)
    .limit(50);

  if (error) throw error;

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

    const { data, error } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('*')
      .in('conversa_id', conversationIds)
      .order('created_at', { ascending: true })
      .limit(300);

    if (error) throw error;
    return NextResponse.json({ messages: dedupeMessages(data || []) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao consegui carregar as mensagens.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
        if (leadAccess?.responsavel_profile_id !== guard.profile.id) {
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
    const viewingProfileId = request.headers.get('x-orion-view-profile-id');
    if (guard.profile.tipo_usuario === 'admin' && viewingProfileId) {
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

    const instance = uazapiInstanceName(senderProfileId);
    
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

    let messageTextDb = text;
    if (mediaBase64) {
      const typeLabel = mediatype === 'image' ? '📷 Imagem' : mediatype === 'audio' ? '🎤 Mensagem de voz' : mediatype === 'video' ? '🎥 Vídeo' : '📎 Arquivo';
      messageTextDb = text ? `${typeLabel}: ${text}` : `${typeLabel} (${fileName})`;
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .insert([{
        conversa_id: conversationId,
        direction: 'outbound',
        remetente: senderProfile.nome || senderProfile.email_real || senderProfile.email || 'Orion',
        mensagem: messageTextDb,
        provider_message_id: providerId,
        metadata: { ...(payload || {}), ...outboundMediaMetadata, instance },
      }])
      .select('*')
      .single();

    if (insertError) throw insertError;

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
    console.error('[POST /api/inbox/messages] ERROR:', error);
    const rawMessage = String(error?.message || '');
    if (WHATSAPP_REJECTION_RE.test(rawMessage)) {
      return NextResponse.json({
        error: 'O WhatsApp recusou essa mensagem. Tente enviar em partes menores ou confirme se o numero tem WhatsApp ativo.',
      }, { status: 422 });
    }
    return NextResponse.json({ error: rawMessage || 'Nao consegui enviar a mensagem agora.' }, { status: 500 });
  }
}
