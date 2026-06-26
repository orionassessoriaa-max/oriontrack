import { NextResponse } from 'next/server';
import { normalizePhone, profileIdFromUazapiInstance, uazapiFetch } from '@/lib/uazapi';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { continueLeadAiFromIncoming, isAiOutbound } from '@/lib/leadAiAgent';

function readText(body: any) {
  return String(
    body?.content ||
    body?.text ||
    body?.caption ||
    body?.message ||
    body?.messageText ||
    body?.message?.conversation ||
    body?.message?.extendedTextMessage?.text ||
    body?.message?.imageMessage?.caption ||
    body?.message?.videoMessage?.caption ||
    ''
  ).trim();
}

function pickString(...values: any[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stripDataUrl(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.includes(';base64,') ? raw.split(';base64,')[1] : raw;
}

function byteObjectToBase64(value: any) {
  if (!value || typeof value !== 'object') return '';
  const bytes = value?.data && typeof value.data === 'object' ? value.data : value;
  const numbers = Object.keys(bytes)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => Number(bytes[key]));

  if (!numbers.length || numbers.some((item) => Number.isNaN(item))) return '';
  return Buffer.from(numbers).toString('base64');
}

function longToNumber(value: any) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  if (value && typeof value === 'object') {
    if (typeof value.low === 'number') return value.low;
    if (typeof value.low === 'string') return Number(value.low);
  }
  return undefined;
}

function pickMediaMessage(body: any) {
  return (
    body?.audioMessage ||
    body?.imageMessage ||
    body?.videoMessage ||
    body?.documentMessage ||
    body?.message?.audioMessage ||
    body?.message?.imageMessage ||
    body?.message?.videoMessage ||
    body?.message?.documentMessage ||
    body?.data?.message?.audioMessage ||
    body?.data?.message?.imageMessage ||
    body?.data?.message?.videoMessage ||
    body?.data?.message?.documentMessage ||
    null
  );
}

function readUazapiMediaMetadata(body: any) {
  const mediaMessage = pickMediaMessage(body);

  const mediaUrl = pickString(
    body?.media_url,
    body?.mediaUrl,
    body?.fileUrl,
    body?.fileURL,
    body?.downloadUrl,
    body?.url,
    body?.data?.media_url,
    body?.data?.mediaUrl,
    body?.data?.fileUrl,
    body?.data?.fileURL,
    body?.data?.downloadUrl,
    body?.data?.url,
    mediaMessage?.mediaUrl,
    mediaMessage?.fileUrl,
    mediaMessage?.fileURL,
    mediaMessage?.downloadUrl,
    mediaMessage?.url
  );

  return {
    media_base64: stripDataUrl(pickString(
      body?.media_base64,
      body?.mediaBase64,
      body?.base64,
      body?.file,
      body?.media,
      body?.data?.media_base64,
      body?.data?.mediaBase64,
      body?.data?.base64,
      body?.data?.file,
      body?.data?.media,
      mediaMessage?.base64,
      mediaMessage?.file,
      mediaMessage?.media
    )) || undefined,
    media_url: mediaUrl && /^https?:\/\//i.test(mediaUrl) ? mediaUrl : undefined,
    media_mimetype: pickString(
      body?.media_mimetype,
      body?.mimetype,
      body?.mimeType,
      body?.contentType,
      body?.data?.mimetype,
      body?.data?.mimeType,
      mediaMessage?.mimetype,
      mediaMessage?.mimeType
    ) || undefined,
    media_file_name: pickString(
      body?.media_file_name,
      body?.fileName,
      body?.filename,
      body?.name,
      body?.data?.fileName,
      body?.data?.filename,
      mediaMessage?.fileName,
      mediaMessage?.filename
    ) || undefined,
  };
}

function buildUazapiDownloadBody(providerId: string, mediaMessage: any) {
  const mediaKey = pickString(mediaMessage?.mediaKey, byteObjectToBase64(mediaMessage?.mediaKey));
  const fileSha256 = pickString(mediaMessage?.fileSha256, byteObjectToBase64(mediaMessage?.fileSha256));
  const fileEncSha256 = pickString(mediaMessage?.fileEncSha256, byteObjectToBase64(mediaMessage?.fileEncSha256));
  const fileLength = longToNumber(mediaMessage?.fileLength);

  const message: any = {
    key: { id: providerId },
    message: {},
  };

  if (mediaMessage?.url) message.message.Url = mediaMessage.url;
  if (mediaMessage?.mimetype) message.message.Mimetype = mediaMessage.mimetype;
  if (mediaKey) message.message.MediaKey = mediaKey;
  if (fileSha256) message.message.FileSHA256 = fileSha256;
  if (fileEncSha256) message.message.FileEncSHA256 = fileEncSha256;
  if (typeof fileLength === 'number' && !Number.isNaN(fileLength)) message.message.FileLength = fileLength;
  if (mediaMessage?.directPath) message.message.DirectPath = mediaMessage.directPath;

  return {
    message,
    convertToMp4: true,
  };
}

function pickProviderPayloadBase64(payload: any) {
  return stripDataUrl(pickString(
    payload?.base64,
    payload?.media_base64,
    payload?.mediaBase64,
    payload?.file,
    payload?.data?.base64,
    payload?.data?.media_base64,
    payload?.data?.mediaBase64,
    payload?.data?.file,
    payload?.message?.base64,
    payload?.message?.mediaBase64
  ));
}

async function downloadUazapiMediaBase64(instance: string, providerId: string, body: any) {
  const mediaMessage = pickMediaMessage(body);
  if (!instance || !providerId || !mediaMessage) return null;

  try {
    const payload = await uazapiFetch('/message/download', {
      method: 'POST',
      body: JSON.stringify(buildUazapiDownloadBody(providerId, mediaMessage)),
    }, { instanceName: instance });

    const mediaBase64 = pickProviderPayloadBase64(payload);
    if (!mediaBase64) return null;

    return {
      media_base64: mediaBase64,
      media_mimetype: pickString(
        payload?.mimetype,
        payload?.mimeType,
        payload?.data?.mimetype,
        payload?.data?.mimeType,
        mediaMessage?.mimetype,
        mediaMessage?.mimeType
      ) || undefined,
      media_file_name: pickString(
        payload?.fileName,
        payload?.filename,
        payload?.name,
        payload?.data?.fileName,
        payload?.data?.filename,
        mediaMessage?.fileName,
        mediaMessage?.filename
      ) || undefined,
    };
  } catch (error) {
    console.error('[uazapi_webhook] Failed to cache media from UAZAPI:', error);
    return null;
  }
}

function isCallEvent(body: any, event: string) {
  const messageType = String(body?.type || body?.messageType || '').toLowerCase();
  return (
    event.includes('CALL') ||
    messageType.includes('call') ||
    Boolean(body?.call)
  );
}

function readCallText(body: any) {
  const status = String(body?.status || body?.call?.status || '').trim();
  let statusText = status;
  if (status === 'offer') statusText = 'chamando';
  else if (status === 'accept') statusText = 'atendida';
  else if (status === 'reject') statusText = 'recusada';
  else if (status === 'timeout') statusText = 'sem resposta';

  const duration = String(body?.duration || body?.call?.duration || '').trim();
  const suffix = [
    duration ? `Duração: ${duration}` : null,
    statusText ? `Status: ${statusText}` : null,
  ].filter(Boolean).join(' | ');

  const isVideoCall = Boolean(body?.isVideo || body?.call?.isVideo);
  const typeLabel = isVideoCall ? 'Ligação de vídeo' : 'Ligação de voz';

  return suffix ? `${typeLabel}\n${suffix}` : typeLabel;
}

async function transcribeAudio(base64: string, mimeType = 'audio/ogg') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !base64) return '';

  const cleanBase64 = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;
  const bytes = Buffer.from(cleanBase64, 'base64');
  if (!bytes.length) return '';

  const formData = new FormData();
  const fileName = mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'audio.mp3' : 'audio.ogg';
  formData.append('file', new Blob([bytes], { type: mimeType }), fileName);
  formData.append('model', process.env.ORION_LEAD_AI_TRANSCRIBE_MODEL || 'whisper-1');
  formData.append('language', 'pt');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[uazapi_webhook] Audio transcription failed:', payload);
    return '';
  }

  return String(payload?.text || '').trim();
}

async function transcribeUazapiAudio(body: any) {
  if (body?.transcription || body?.audioText || body?.text_transcript) {
    return String(body.transcription || body.audioText || body.text_transcript).trim();
  }

  let base64 = body?.base64 || body?.file || body?.audioMessage?.base64 || '';
  if (!base64 && (body?.url || body?.fileUrl || body?.fileURL || body?.mediaUrl)) {
    try {
      const url = body.url || body.fileUrl || body.fileURL || body.mediaUrl;
      const res = await fetch(url);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        base64 = Buffer.from(buffer).toString('base64');
      }
    } catch (e) {
      console.error('[uazapi_webhook] Failed to download audio from url:', e);
    }
  }

  if (base64) {
    return transcribeAudio(base64, body?.mimetype || 'audio/ogg');
  }

  return '';
}

async function stopLeadAiForHumanOutbound(leadId: string, profileName?: string | null) {
  const now = new Date().toISOString();
  const actor = String(profileName || 'Atendente').trim();

  const { data: session } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('id, summary')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .maybeSingle();

  if (!session) return;

  const suffix = `\n\nIA encerrada: ${actor} assumiu o atendimento em ${now}.`;

  await supabaseAdmin
    .from('lead_ai_sessions')
    .update({
      status: 'handoff',
      summary: `${session.summary || ''}${suffix}`.trim(),
      updated_at: now,
    })
    .eq('id', session.id);
}

async function resolveProfileCorretorScope(profile: any) {
  const ids = new Set<string>();
  if (profile?.corretor_id) ids.add(profile.corretor_id);

  const brokerageName = String(profile?.nome_empresa || '').trim();
  if (brokerageName) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', brokerageName);

    for (const row of data || []) {
      if (row?.id) ids.add(row.id);
    }
  }

  return Array.from(ids);
}

async function findLead(profile: any, phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;

  const last8 = digits.slice(-8);
  const last8WithHyphen = `${last8.slice(0, 4)}-${last8.slice(4)}`;

  let query = supabaseAdmin
    .from('leads')
    .select('id, nome, telefone, corretor_id, responsavel_profile_id')
    .or(`telefone.ilike.%${last8},telefone.ilike.%${last8WithHyphen}`);

  if (profile.tipo_usuario === 'corretor_membro') {
    query = query.eq('responsavel_profile_id', profile.id);
  } else {
    const scopeIds = await resolveProfileCorretorScope(profile);
    if (scopeIds.length === 0) return null;
    query = query.in('corretor_id', scopeIds);
  }

  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

async function findConversation(corretorId: string, phone: string, leadId?: string | null) {
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
  if (digits.length < 8) return null;
  const last8 = digits.slice(-8);

  const { data } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('corretor_id', corretorId)
    .or(`telefone.eq.${phone},telefone.ilike.%${last8}`)
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const event = String(body?.wook || body?.event || body?.type || '').toUpperCase();

    const callEvent = isCallEvent(body, event);

    // No UAZAPI, a mensagem recebida tem wook "RECEIVE_MESSAGE" ou tipo similar.
    // Aceitamos qualquer evento que contenha MESSAGE, SEND, ou seja um Call.
    if (event && !event.includes('MESSAGE') && !event.includes('SEND') && !callEvent) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const instance = String(body?.session || body?.instance || body?.instanceName || '');
    const profileId = profileIdFromUazapiInstance(instance);
    if (!profileId) return NextResponse.json({ ok: true, ignored: true });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
      .eq('id', profileId)
      .maybeSingle();

    if (!profile?.corretor_id) return NextResponse.json({ ok: true, ignored: true });

    let message = callEvent ? readCallText(body) : readText(body);
    
    const msgType = String(body?.type || body?.messageType || '').toLowerCase();
    const hasAudio = msgType === 'audio' || msgType === 'voice' || msgType.includes('audio') || msgType.includes('voice');
    const hasImage = msgType === 'image' || msgType.includes('image');
    const hasVideo = msgType === 'video' || msgType.includes('video');
    const hasDocument = msgType === 'document' || msgType.includes('document');
    const hasMedia = hasAudio || hasImage || hasVideo || hasDocument;

    const providerId = String(body?.id || body?.key?.id || '');
    let audioTranscript = '';
    let aiCustomerMessage = message;

    if (providerId) {
      const { data: existing } = await supabaseAdmin
        .from('whatsapp_mensagens')
        .select('id')
        .eq('provider_message_id', providerId)
        .limit(1)
        .maybeSingle();
      if (existing) return NextResponse.json({ ok: true, duplicated: true });
    }

    let mediaMetadata = readUazapiMediaMetadata(body);
    if (hasMedia && !mediaMetadata.media_base64 && providerId && instance) {
      const downloadedMedia = await downloadUazapiMediaBase64(instance, providerId, body);
      if (downloadedMedia?.media_base64) {
        mediaMetadata = {
          ...mediaMetadata,
          ...downloadedMedia,
        };
      }
    }

    if (hasAudio) {
      try {
        audioTranscript = mediaMetadata.media_base64
          ? await transcribeAudio(mediaMetadata.media_base64, mediaMetadata.media_mimetype || 'audio/ogg')
          : await transcribeUazapiAudio(body);
        if (audioTranscript) {
          aiCustomerMessage = `Audio transcrito do cliente: ${audioTranscript}`;
        }
      } catch (audioErr) {
        console.error('[uazapi_webhook] Failed processing inbound audio:', audioErr);
      }
    }

    if (!message && hasMedia) {
      if (hasAudio) message = '🎤 Mensagem de voz';
      else if (hasImage) message = '📷 Imagem';
      else if (hasVideo) message = '🎥 Vídeo';
      else if (hasDocument) message = '📎 Arquivo';
    }

    const remoteJid = String(body?.phone || body?.sender || body?.from || body?.key?.remoteJid || '');
    let phone = normalizePhone(remoteJid.split('@')[0]);

    // Tratar quando a ligação de voz é efetuada pelo próprio corretor de fora do CRM.
    let isOutboundCall = false;
    const brokerPhone = profile?.telefone ? normalizePhone(profile.telefone) : '';
    if (callEvent && brokerPhone && phone === brokerPhone) {
      isOutboundCall = true;
      const otherJid = String(body?.to || body?.chatId || body?.remoteJid || '');
      const otherPhone = normalizePhone(otherJid.split('@')[0]);
      if (otherPhone && otherPhone !== brokerPhone) {
        phone = otherPhone;
      }
    }

    if (!message || !phone) return NextResponse.json({ ok: true, ignored: true });

    if (!aiCustomerMessage) aiCustomerMessage = audioTranscript || message;
    const lead = await findLead(profile, phone);
    const currentConversation = await findConversation(profile.corretor_id, phone, lead?.id || null);

    // Ignorar mensagens de contatos pessoais
    if (!lead && !currentConversation) {
      console.log(`[uazapi_webhook] Ignorando contato pessoal: ${phone} (corretor: ${profile.corretor_id})`);
      return NextResponse.json({ ok: true, ignored: true, reason: 'Not a CRM lead' });
    }

    const contactName = body?.pushName || body?.senderName || body?.name || lead?.nome || phone;

    let conversation = currentConversation;
    if (!conversation) {
      const { data: created, error } = await supabaseAdmin
        .from('whatsapp_conversas')
        .insert([{
          corretor_id: profile.corretor_id,
          lead_id: lead?.id || null,
          telefone: phone,
          nome_contato: lead?.nome || contactName,
          status: 'aberta',
          ultima_mensagem_at: new Date().toISOString(),
        }])
        .select('*')
        .single();

      if (error) throw error;
      conversation = created;
    } else {
      await supabaseAdmin
        .from('whatsapp_conversas')
        .update({
          lead_id: currentConversation.lead_id || lead?.id || null,
          nome_contato: lead?.nome || currentConversation.nome_contato || contactName,
          telefone: currentConversation.telefone || phone,
          ultima_mensagem_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentConversation.id);
    }

    const fromMe = Boolean(
      body?.fromMe === true ||
      body?.key?.fromMe === true ||
      event === 'SEND_MESSAGE' ||
      event.includes('SEND') ||
      isOutboundCall
    );

    if (fromMe && isAiOutbound(phone, message)) {
      console.log(`[uazapi_webhook] Ignorando retorno de mensagem enviada pela propria IA: ${phone}`);
      return NextResponse.json({ ok: true, ignored: true, ai_outbound: true });
    }

    await supabaseAdmin.from('whatsapp_mensagens').insert([{
      conversa_id: conversation.id,
      direction: fromMe ? 'outbound' : 'inbound',
      remetente: fromMe ? (profile.nome || 'Orion') : contactName,
      mensagem: message,
      provider_message_id: providerId || null,
      metadata: {
        ...(body || {}),
        ...mediaMetadata,
        messageType: callEvent ? 'call' : body?.type,
        mediaType: callEvent ? 'call' : body?.type,
        isBrokerCall: callEvent ? fromMe : undefined,
        brokerName: (callEvent && fromMe) ? (profile.nome || 'Orion') : undefined,
        audio_transcript: audioTranscript || undefined,
        ai_customer_message: aiCustomerMessage || undefined,
      },
    }]);

    if (fromMe && lead?.id) {
      await stopLeadAiForHumanOutbound(lead.id, profile.nome);
    }

    if (!fromMe && lead?.id) {
      try {
        await continueLeadAiFromIncoming({
          leadId: lead.id,
          conversationId: conversation.id,
          customerMessage: aiCustomerMessage || message,
          incomingWasAudio: hasAudio,
        });
      } catch (aiErr) {
        console.error('[uazapi_webhook] Failed continuing lead AI:', aiErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('uazapi_webhook_error', error);
    return NextResponse.json({ ok: false, error: 'Nao consegui registrar a mensagem.' }, { status: 500 });
  }
}
