import { after, NextResponse } from 'next/server';
import { normalizePhone, profileIdFromUazapiInstance, uazapiFetch } from '@/lib/uazapi';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { continueLeadAiFromIncoming, handoffLeadAiToResponsible, isAiOutbound, stopLeadAiForHumanTakeover } from '@/lib/leadAiAgent';
import { ensureLeadAiTimeoutScheduler } from '@/lib/leadAiTimeoutScheduler';
import { continueCommercialSdrFromIncoming } from '@/lib/commercialSdrAgent';
import { ensureCommercialConversation, findCommercialConversation } from '@/lib/commercialInbox';

function readText(body: any) {
  return pickString(
    body?.content,
    body?.text,
    body?.caption,
    body?.messageText,
    body?.body,
    // body.message paths (body.message is usually an object in UAZAPI)
    body?.message?.conversation,
    body?.message?.body,
    body?.message?.text,
    body?.message?.caption,
    body?.message?.content,
    body?.message?.textMessage,
    body?.message?.extendedTextMessage?.text,
    body?.message?.imageMessage?.caption,
    body?.message?.videoMessage?.caption,
    body?.message?.content?.text,
    body?.message?.content?.body,
    body?.message?.content?.caption,
    body?.message?.text?.body,
    body?.message?.text?.content,
    // body.message.message paths (UAZAPI nests message inside message)
    body?.message?.message?.conversation,
    body?.message?.message?.body,
    body?.message?.message?.text,
    body?.message?.message?.extendedTextMessage?.text,
    body?.message?.message?.imageMessage?.caption,
    body?.message?.message?.videoMessage?.caption,
    // body.data paths
    body?.data?.content,
    body?.data?.text,
    body?.data?.caption,
    body?.data?.messageText,
    body?.data?.body,
    body?.data?.message?.conversation,
    body?.data?.message?.body,
    body?.data?.message?.text,
    body?.data?.message?.caption,
    body?.data?.message?.content,
    body?.data?.message?.textMessage,
    body?.data?.message?.extendedTextMessage?.text,
    body?.data?.message?.imageMessage?.caption,
    body?.data?.message?.videoMessage?.caption,
    body?.data?.message?.content?.text,
    body?.data?.message?.content?.body,
    body?.data?.message?.content?.caption,
    body?.data?.message?.text?.body,
    body?.data?.message?.text?.content,
    body?.data?.message?.message?.conversation,
    body?.data?.message?.message?.body,
    body?.data?.message?.message?.text,
    body?.data?.message?.message?.extendedTextMessage?.text,
    // fallback: deep recursive search
    deepPickStringByKey(body, ['conversation', 'text', 'caption', 'messageText', 'textMessage', 'body'])
  );
}

function pickString(...values: any[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function deepPickStringByKey(value: any, wantedKeys: string[], depth = 0): string {
  if (!value || depth > 4) return '';
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const found = deepPickStringByKey(item, wantedKeys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const wanted = new Set(wantedKeys.map((key) => key.toLowerCase()));
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (wanted.has(normalizedKey) && typeof item === 'string' && item.trim()) {
      return item.trim();
    }
  }

  for (const item of Object.values(value)) {
    const found = deepPickStringByKey(item, wantedKeys, depth + 1);
    if (found) return found;
  }

  return '';
}

function isRemoteCandidate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const normalized = trimmed.toLowerCase();
  if (['updated', 'received', 'sent', 'messages', 'message', 'status', 'open', 'closed'].includes(normalized)) {
    return false;
  }

  if (/@(s\.whatsapp\.net|c\.us|g\.us|lid)$/.test(normalized)) return true;
  if (/[a-z]/i.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 16;
}

function pickRemoteString(...values: any[]) {
  for (const value of values) {
    if (typeof value === 'string' && isRemoteCandidate(value)) return value.trim();
  }
  return '';
}

function deepPickRemoteByKey(value: any, wantedKeys: string[], depth = 0): string {
  if (!value || depth > 4) return '';
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const found = deepPickRemoteByKey(item, wantedKeys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const wanted = new Set(wantedKeys.map((key) => key.toLowerCase()));
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (wanted.has(normalizedKey) && typeof item === 'string' && isRemoteCandidate(item)) {
      return item.trim();
    }
  }

  for (const item of Object.values(value)) {
    const found = deepPickRemoteByKey(item, wantedKeys, depth + 1);
    if (found) return found;
  }

  return '';
}

function readWebhookInstanceName(body: any) {
  return pickString(
    body?.session,
    body?.sessionkey,
    body?.instanceName,
    body?.instance,
    body?.instance?.name,
    body?.instance?.instanceName,
    body?.data?.session,
    body?.data?.sessionkey,
    body?.data?.instanceName,
    body?.data?.instance,
    body?.data?.instance?.name,
    body?.data?.instance?.instanceName
  );
}

function readRemoteJid(body: any) {
  return pickRemoteString(
    body?.phone,
    body?.sender,
    body?.from,
    body?.remoteJid,
    body?.remotejid,
    body?.chatId,
    body?.chatid,
    body?.chat_id,
    body?.chat,
    body?.chat?.id,
    body?.chat?.jid,
    body?.chat?.phone,
    body?.chat?.phoneNumber,
    body?.chat?.remoteJid,
    body?.chat?.chatId,
    body?.chatSource,
    body?.chatSource?.id,
    body?.chatSource?.jid,
    body?.chatSource?.phone,
    body?.chatSource?.phoneNumber,
    body?.chatSource?.remoteJid,
    body?.chatSource?.chatId,
    body?.jid,
    body?.participant,
    body?.key?.remoteJid,
    body?.key?.participant,
    body?.message?.key?.remoteJid,
    body?.message?.key?.participant,
    body?.message?.chat?.id,
    body?.message?.chat?.jid,
    body?.message?.chat?.phone,
    body?.message?.chat?.phoneNumber,
    body?.message?.chatSource?.id,
    body?.message?.chatSource?.jid,
    body?.message?.sender?.id,
    body?.message?.sender?.phone,
    body?.message?.sender?.phoneNumber,
    body?.data?.phone,
    body?.data?.sender,
    body?.data?.from,
    body?.data?.remoteJid,
    body?.data?.remotejid,
    body?.data?.chatId,
    body?.data?.chatid,
    body?.data?.chat_id,
    body?.data?.chat,
    body?.data?.chat?.id,
    body?.data?.chat?.jid,
    body?.data?.chat?.phone,
    body?.data?.chat?.phoneNumber,
    body?.data?.chat?.remoteJid,
    body?.data?.chat?.chatId,
    body?.data?.chatSource,
    body?.data?.chatSource?.id,
    body?.data?.chatSource?.jid,
    body?.data?.chatSource?.phone,
    body?.data?.chatSource?.phoneNumber,
    body?.data?.chatSource?.remoteJid,
    body?.data?.chatSource?.chatId,
    body?.data?.jid,
    body?.data?.participant,
    body?.data?.key?.remoteJid,
    body?.data?.key?.participant,
    body?.data?.message?.key?.remoteJid,
    body?.data?.message?.key?.participant,
    body?.message?.chatid,
    body?.message?.chatId,
    body?.message?.chat,
    body?.message?.chatSource,
    body?.message?.remoteJid,
    body?.message?.remotejid,
    body?.message?.sender,
    body?.message?.from,
    body?.message?.jid,
    body?.data?.message?.chat?.id,
    body?.data?.message?.chat?.jid,
    body?.data?.message?.chat?.phone,
    body?.data?.message?.chat?.phoneNumber,
    body?.data?.message?.chatSource?.id,
    body?.data?.message?.chatSource?.jid,
    body?.data?.message?.sender?.id,
    body?.data?.message?.sender?.phone,
    body?.data?.message?.sender?.phoneNumber,
    body?.data?.message?.chatid,
    body?.data?.message?.chatId,
    body?.data?.message?.chat,
    body?.data?.message?.chatSource,
    body?.data?.message?.remoteJid,
    body?.data?.message?.remotejid,
    body?.data?.message?.sender,
    body?.data?.message?.from,
    body?.data?.message?.jid,
    deepPickRemoteByKey(body, ['remoteJid', 'remotejid', 'chatId', 'chatid', 'chat_id', 'chat', 'chatSource', 'sender', 'from', 'phone', 'phoneNumber', 'jid'])
  );
}

function readOwnerJid(body: any) {
  return pickString(
    body?.owner,
    body?.ownerJid,
    body?.connectedPhone,
    body?.sessionPhone,
    body?.me,
    body?.me?.id,
    body?.me?.jid,
    body?.instance?.owner,
    body?.instance?.phone,
    body?.instance?.jid,
    body?.data?.owner,
    body?.data?.ownerJid,
    body?.data?.connectedPhone,
    body?.data?.sessionPhone,
    body?.data?.me,
    body?.data?.me?.id,
    body?.data?.me?.jid,
    body?.data?.instance?.owner,
    body?.data?.instance?.phone,
    body?.data?.instance?.jid
  );
}

function readProviderId(body: any) {
  return pickString(
    body?.id,
    body?.messageId,
    body?.key?.id,
    body?.message?.id,
    body?.message?.messageId,
    body?.message?.key?.id,
    body?.data?.id,
    body?.data?.messageId,
    body?.data?.key?.id,
    body?.data?.message?.id,
    body?.data?.message?.messageId,
    body?.data?.message?.key?.id
  );
}

function stripDataUrl(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.includes(';base64,') ? raw.split(';base64,')[1] : raw;
}

function isBrowserOpenableUrl(value?: string | null) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  return !/\/\/[^/]*whatsapp\.net\//i.test(raw);
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

function deepHasKey(value: any, wantedKeys: string[], depth = 0): boolean {
  if (!value || depth > 6) return false;
  if (Array.isArray(value)) {
    return value.slice(0, 30).some((item) => deepHasKey(item, wantedKeys, depth + 1));
  }
  if (typeof value !== 'object') return false;

  const wanted = new Set(wantedKeys.map((key) => key.toLowerCase()));
  for (const key of Object.keys(value)) {
    if (wanted.has(key.toLowerCase())) return true;
  }

  return Object.values(value).some((item) => deepHasKey(item, wantedKeys, depth + 1));
}

function looksLikeMediaMessage(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Boolean(
    value?.mimetype ||
    value?.mimeType ||
    value?.Mimetype ||
    value?.mediaKey ||
    value?.MediaKey ||
    value?.fileSha256 ||
    value?.fileSHA256 ||
    value?.FileSHA256 ||
    value?.fileEncSha256 ||
    value?.fileEncSHA256 ||
    value?.FileEncSHA256 ||
    value?.directPath ||
    value?.DirectPath ||
    value?.url ||
    value?.URL ||
    value?.mediaUrl ||
    value?.fileUrl ||
    value?.downloadUrl ||
    value?.base64 ||
    value?.file ||
    value?.media
  );
}

function pickMediaMessage(body: any) {
  const direct =
    body?.audioMessage ||
    body?.imageMessage ||
    body?.videoMessage ||
    body?.documentMessage ||
    body?.message?.audioMessage ||
    body?.message?.imageMessage ||
    body?.message?.videoMessage ||
    body?.message?.documentMessage ||
    body?.message?.message?.audioMessage ||
    body?.message?.message?.imageMessage ||
    body?.message?.message?.videoMessage ||
    body?.message?.message?.documentMessage ||
    body?.message?.content?.audioMessage ||
    body?.message?.content?.imageMessage ||
    body?.message?.content?.videoMessage ||
    body?.message?.content?.documentMessage ||
    body?.data?.message?.audioMessage ||
    body?.data?.message?.imageMessage ||
    body?.data?.message?.videoMessage ||
    body?.data?.message?.documentMessage ||
    body?.data?.message?.message?.audioMessage ||
    body?.data?.message?.message?.imageMessage ||
    body?.data?.message?.message?.videoMessage ||
    body?.data?.message?.message?.documentMessage ||
    body?.data?.message?.content?.audioMessage ||
    body?.data?.message?.content?.imageMessage ||
    body?.data?.message?.content?.videoMessage ||
    body?.data?.message?.content?.documentMessage;

  if (direct) return direct;

  return [
    body?.message,
    body?.message?.message,
    body?.message?.content,
    body?.data?.message,
    body?.data?.message?.message,
    body?.data?.message?.content,
  ].find(looksLikeMediaMessage) || null;
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
    mediaMessage?.URL,
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
  const mediaUrl = pickString(mediaMessage?.url, mediaMessage?.URL);
  const mimetype = pickString(mediaMessage?.mimetype, mediaMessage?.mimeType, mediaMessage?.Mimetype);
  const mediaKeyValue = mediaMessage?.mediaKey || mediaMessage?.MediaKey;
  const fileSha256Value = mediaMessage?.fileSha256 || mediaMessage?.fileSHA256 || mediaMessage?.FileSHA256;
  const fileEncSha256Value = mediaMessage?.fileEncSha256 || mediaMessage?.fileEncSHA256 || mediaMessage?.FileEncSHA256;
  const mediaKey = pickString(mediaKeyValue, byteObjectToBase64(mediaKeyValue));
  const fileSha256 = pickString(fileSha256Value, byteObjectToBase64(fileSha256Value));
  const fileEncSha256 = pickString(fileEncSha256Value, byteObjectToBase64(fileEncSha256Value));
  const fileLength = longToNumber(mediaMessage?.fileLength ?? mediaMessage?.FileLength);
  const directPath = pickString(mediaMessage?.directPath, mediaMessage?.DirectPath);

  const message: any = {
    key: { id: providerId },
    message: {},
  };

  if (mediaUrl) message.message.Url = mediaUrl;
  if (mimetype) message.message.Mimetype = mimetype;
  if (mediaKey) message.message.MediaKey = mediaKey;
  if (fileSha256) message.message.FileSHA256 = fileSha256;
  if (fileEncSha256) message.message.FileEncSHA256 = fileEncSha256;
  if (typeof fileLength === 'number' && !Number.isNaN(fileLength)) message.message.FileLength = fileLength;
  if (directPath) message.message.DirectPath = directPath;

  return {
    message,
    convertToMp4: true,
  };
}

function buildUazapiDownloadPayloads(providerId: string, mediaMessage: any) {
  const wrapped = buildUazapiDownloadBody(providerId, mediaMessage);
  const body: Record<string, any> = {
    id: providerId,
    messageId: providerId,
  };

  const mediaUrl = pickString(mediaMessage?.url, mediaMessage?.URL);
  const mimetype = pickString(mediaMessage?.mimetype, mediaMessage?.mimeType, mediaMessage?.Mimetype);
  const mediaKeyValue = mediaMessage?.mediaKey || mediaMessage?.MediaKey;
  const fileSha256Value = mediaMessage?.fileSha256 || mediaMessage?.fileSHA256 || mediaMessage?.FileSHA256;
  const fileEncSha256Value = mediaMessage?.fileEncSha256 || mediaMessage?.fileEncSHA256 || mediaMessage?.FileEncSHA256;
  const mediaKey = pickString(mediaKeyValue, byteObjectToBase64(mediaKeyValue));
  const fileSha256 = pickString(fileSha256Value, byteObjectToBase64(fileSha256Value));
  const fileEncSha256 = pickString(fileEncSha256Value, byteObjectToBase64(fileEncSha256Value));
  const fileLength = longToNumber(mediaMessage?.fileLength ?? mediaMessage?.FileLength);
  const directPath = pickString(mediaMessage?.directPath, mediaMessage?.DirectPath);

  if (mediaUrl) {
    body.Url = mediaUrl;
    body.url = mediaUrl;
  }
  if (mimetype) {
    body.Mimetype = mimetype;
    body.mimetype = mimetype;
  }
  if (mediaKey) {
    body.MediaKey = mediaKey;
    body.mediaKey = mediaKey;
  }
  if (fileSha256) {
    body.FileSHA256 = fileSha256;
    body.fileSha256 = fileSha256;
  }
  if (fileEncSha256) {
    body.FileEncSHA256 = fileEncSha256;
    body.fileEncSha256 = fileEncSha256;
  }
  if (typeof fileLength === 'number' && !Number.isNaN(fileLength)) {
    body.FileLength = fileLength;
    body.fileLength = fileLength;
  }
  if (directPath) {
    body.DirectPath = directPath;
    body.directPath = directPath;
  }

  return [wrapped, body];
}

function pickProviderPayloadBase64(payload: any) {
  return stripDataUrl(pickString(
    payload?.base64,
    payload?.media_base64,
    payload?.mediaBase64,
    payload?.media,
    payload?.file,
    payload?.data?.base64,
    payload?.data?.media_base64,
    payload?.data?.mediaBase64,
    payload?.data?.media,
    payload?.data?.file,
    payload?.response?.base64,
    payload?.response?.media_base64,
    payload?.response?.mediaBase64,
    payload?.response?.media,
    payload?.response?.file,
    payload?.message?.base64,
    payload?.message?.mediaBase64
  ));
}

function pickProviderPayloadUrl(payload: any) {
  const value = pickString(
    payload?.media_url,
    payload?.mediaUrl,
    payload?.fileUrl,
    payload?.fileURL,
    payload?.downloadUrl,
    payload?.downloadURL,
    payload?.url,
    payload?.data?.media_url,
    payload?.data?.mediaUrl,
    payload?.data?.fileUrl,
    payload?.data?.fileURL,
    payload?.data?.downloadUrl,
    payload?.data?.downloadURL,
    payload?.data?.url,
    payload?.response?.mediaUrl,
    payload?.response?.fileUrl,
    payload?.response?.fileURL,
    payload?.response?.downloadUrl,
    payload?.response?.downloadURL,
    payload?.response?.url
  );

  return isBrowserOpenableUrl(value) ? value : '';
}

async function downloadUazapiMediaBase64(instance: string, providerId: string, body: any) {
  const mediaMessage = pickMediaMessage(body);
  if (!instance || !providerId || !mediaMessage) return null;

  try {
    let payload: any = null;
    let mediaBase64 = '';
    for (const bodyPayload of buildUazapiDownloadPayloads(providerId, mediaMessage)) {
      try {
        payload = await uazapiFetch('/message/download', {
          method: 'POST',
          body: JSON.stringify(bodyPayload),
        }, { instanceName: instance });

        mediaBase64 = pickProviderPayloadBase64(payload);
        if (mediaBase64) break;

        const mediaUrl = pickProviderPayloadUrl(payload);
        if (mediaUrl) {
          const mediaResponse = await fetch(mediaUrl);
          if (mediaResponse.ok) {
            mediaBase64 = Buffer.from(await mediaResponse.arrayBuffer()).toString('base64');
            if (mediaBase64) break;
          }
          console.warn('[uazapi_webhook] UAZAPI returned media URL but download failed:', {
            status: mediaResponse.status,
            providerId,
          });
        }
      } catch (attemptError: any) {
        console.warn('[uazapi_webhook] UAZAPI media download attempt failed:', attemptError?.message || attemptError);
      }
    }

    if (!mediaBase64) {
      console.warn('[uazapi_webhook] UAZAPI media download returned no base64/url.', {
        providerId,
        instance,
        payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 20) : [],
        dataKeys: payload?.data && typeof payload.data === 'object' ? Object.keys(payload.data).slice(0, 20) : [],
        responseKeys: payload?.response && typeof payload.response === 'object' ? Object.keys(payload.response).slice(0, 20) : [],
      });
      return null;
    }

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

function cleanContactDisplayName(value: any, fallback = 'Lead') {
  const text = String(value || '').trim();
  if (!text) return fallback;

  const firstField = text.search(/\s+\*(?:Telefone|Idades?|CNPJ\/MEI|Cidade|Investimento|Plano Atual|Motivo|Hospital\/Regiao|E-?mail|Agendado|Pendente)\*\s*:/i);
  const cleaned = firstField >= 0 ? text.slice(0, firstField).trim() : text;

  return cleaned || fallback;
}

async function transcribeAudio(base64: string, mimeType = 'audio/ogg') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !base64) return '';

  const cleanBase64 = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;
  const bytes = Buffer.from(cleanBase64, 'base64');
  if (!bytes.length) return '';

  const formData = new FormData();
  const normalizedMime = String(mimeType || 'audio/ogg').toLowerCase();
  const fileName = normalizedMime.includes('mpeg') || normalizedMime.includes('mp3')
    ? 'audio.mp3'
    : normalizedMime.includes('webm')
      ? 'audio.webm'
      : normalizedMime.includes('mp4') || normalizedMime.includes('m4a')
        ? 'audio.m4a'
        : 'audio.ogg';
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

  const metadata = readUazapiMediaMetadata(body);
  let base64 = metadata.media_base64 || '';
  const mediaUrl = metadata.media_url || pickString(body?.url, body?.fileUrl, body?.fileURL, body?.mediaUrl);

  if (!base64 && mediaUrl) {
    try {
      const res = await fetch(mediaUrl);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        base64 = Buffer.from(buffer).toString('base64');
      }
    } catch (e) {
      console.error('[uazapi_webhook] Failed to download audio from url:', e);
    }
  }

  if (base64) {
    return transcribeAudio(base64, metadata.media_mimetype || body?.mimetype || 'audio/ogg');
  }

  return '';
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

async function findProfileFromWebhook(body: any, instance: string) {
  const profileId = profileIdFromUazapiInstance(instance);
  if (profileId) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
      .eq('id', profileId)
      .maybeSingle();

    if (data?.corretor_id) return data;
  }

  // Instancias exclusivas da IA nao pertencem a um perfil. Resolva a
  // concessionaria pela configuracao e use um admin apenas como contexto de
  // permissao/notificacao, sem misturar a sessao com o Inbox pessoal dele.
  if (String(instance || '').includes('_ai_')) {
    const { data: aiConfig } = await supabaseAdmin
      .from('corretora_ai_configs')
      .select('corretora_id, corretoras(nome)')
      .eq('dedicated_instance_name', instance)
      .eq('sender_mode', 'dedicated')
      .maybeSingle();
    const joinedCorretora = Array.isArray(aiConfig?.corretoras) ? aiConfig.corretoras[0] : aiConfig?.corretoras;
    const brokerageName = String((joinedCorretora as any)?.nome || '').trim();
    if (brokerageName) {
      const { data: brokers } = await supabaseAdmin.from('corretores').select('id').eq('nome_empresa', brokerageName);
      const brokerIds = (brokers || []).map((row) => row.id);
      if (brokerIds.length) {
        const { data: admin } = await supabaseAdmin
          .from('profiles')
          .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
          .in('corretor_id', brokerIds)
          .in('tipo_usuario', ['corretor_admin', 'corretor'])
          .in('status', ['active', 'ativo', 'Ativo'])
          .order('tipo_usuario', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (admin?.corretor_id) return admin;
      }
    }
  }

  const ownerPhone = normalizePhone(readOwnerJid(body).split('@')[0]);
  if (!ownerPhone || ownerPhone.length < 8) return null;

  const last8 = ownerPhone.slice(-8);
  const last8WithHyphen = `${last8.slice(0, 4)}-${last8.slice(4)}`;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
    .not('telefone', 'is', null)
    .or(`telefone.ilike.%${last8},telefone.ilike.%${last8WithHyphen}`)
    .limit(20);

  const rows = data || [];
  return rows.find((row) => normalizePhone(row?.telefone) === ownerPhone) || rows[0] || null;
}

async function findProfileByCorretorId(corretorId?: string | null) {
  if (!corretorId) return null;

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
    .eq('corretor_id', corretorId)
    .in('tipo_usuario', ['corretor_membro', 'corretor', 'corretor_admin'])
    .order('tipo_usuario', { ascending: true })
    .limit(10);

  const rows = data || [];
  return (
    rows.find((row) => row.tipo_usuario === 'corretor_membro') ||
    rows.find((row) => row.tipo_usuario === 'corretor') ||
    rows.find((row) => row.tipo_usuario === 'corretor_admin') ||
    rows[0] ||
    null
  );
}

async function findProfileFromCrmPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;

  const last8 = digits.slice(-8);
  const last8WithHyphen = `${last8.slice(0, 4)}-${last8.slice(4)}`;

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, responsavel_profile_id, telefone, created_at')
    .or(`telefone.ilike.%${last8},telefone.ilike.%${last8WithHyphen}`)
    .order('created_at', { ascending: false })
    .limit(20);

  const leadRows = leads || [];
  const exactLeadRows = leadRows.filter((row) => normalizePhone(row?.telefone) === digits);
  const activeAiLead = await pickLeadWithActiveAiSession(exactLeadRows.length > 0 ? exactLeadRows : leadRows);
  const lead = activeAiLead || exactLeadRows[0] || leadRows[0] || null;

  if (lead?.responsavel_profile_id) {
    const { data: responsibleProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
      .eq('id', lead.responsavel_profile_id)
      .maybeSingle();

    if (responsibleProfile?.corretor_id) return responsibleProfile;
  }

  const { data: conversations } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('corretor_id, lead_id, telefone, ultima_mensagem_at')
    .or(`telefone.eq.${phone},telefone.ilike.%${last8},telefone.ilike.%${last8WithHyphen}`)
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
    .limit(20);

  const conversationRows = conversations || [];
  const exactConversation = conversationRows.find((row) => normalizePhone(row?.telefone) === digits);
  const conversation = exactConversation || conversationRows[0];
  if (conversation?.corretor_id) {
    const profile = await findProfileByCorretorId(conversation.corretor_id);
    if (profile) return profile;
  }

  return findProfileByCorretorId(lead?.corretor_id);
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
    .limit(20);

  const rows = data || [];
  const exactRows = rows.filter((row) => normalizePhone(row?.telefone) === digits);
  const activeAiLead = await pickLeadWithActiveAiSession(exactRows.length > 0 ? exactRows : rows);
  if (activeAiLead) return activeAiLead;

  const exact = exactRows[0];
  if (digits.length >= 12) return exact || null;
  return exact || rows[0] || null;
}

async function findCommercialLead(phone: string) {
  const digits = normalizePhone(phone);
  if (digits.length < 8) return null;
  const last8 = digits.slice(-8);
  const last8WithHyphen = `${last8.slice(0, 4)}-${last8.slice(4)}`;
  const { data } = await supabaseAdmin.from('comercial_leads').select('*')
    .or(`telefone.ilike.%${last8},telefone.ilike.%${last8WithHyphen}`)
    .order('data_entrada', { ascending: false }).limit(30);
  return (data || []).find((row) => normalizePhone(row?.telefone) === digits) || null;
}

async function findProfileById(profileId?: string | null) {
  if (!profileId) return null;
  const { data } = await supabaseAdmin.from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
    .eq('id', profileId).maybeSingle();
  return data || null;
}

async function pickLeadWithActiveAiSession(rows: any[]) {
  const leadIds = Array.from(new Set((rows || []).map((row) => row?.id).filter(Boolean)));
  if (!leadIds.length) return null;

  const { data } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('lead_id, updated_at')
    .in('lead_id', leadIds)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1);

  const activeLeadId = data?.[0]?.lead_id;
  if (!activeLeadId) return null;
  return rows.find((row) => row?.id === activeLeadId) || null;
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
    .limit(20);

  const rows = data || [];
  const exact = rows.find((row) => normalizePhone(row?.telefone) === digits);
  if (digits.length >= 12) return exact || null;
  return exact || rows[0] || null;
}

async function hasRecentDuplicateMessage(conversationId: string, direction: 'inbound' | 'outbound', message: string) {
  const normalizedMessage = message.trim();
  if (!conversationId || !normalizedMessage) return false;

  const recentWindow = new Date(Date.now() - 30_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('id')
    .eq('conversa_id', conversationId)
    .eq('direction', direction)
    .eq('mensagem', normalizedMessage)
    .gte('created_at', recentWindow)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[uazapi_webhook] Failed checking recent duplicate message:', error);
    return false;
  }

  return Boolean(data?.id);
}

function readConnectionState(body: any) {
  const connected = [
    body?.connected,
    body?.loggedIn,
    body?.instance?.connected,
    body?.instance?.loggedIn,
    body?.data?.connected,
    body?.data?.loggedIn,
    body?.data?.instance?.connected,
    body?.data?.instance?.loggedIn,
  ].find((value) => typeof value === 'boolean');

  if (connected === true) return 'connected';

  const raw = pickString(
    typeof body?.status === 'string' ? body.status : '',
    typeof body?.state === 'string' ? body.state : '',
    typeof body?.connectionStatus === 'string' ? body.connectionStatus : '',
    typeof body?.instance?.status === 'string' ? body.instance.status : '',
    typeof body?.instance?.state === 'string' ? body.instance.state : '',
    typeof body?.data?.status === 'string' ? body.data.status : '',
    typeof body?.data?.state === 'string' ? body.data.state : '',
    typeof body?.data?.connectionStatus === 'string' ? body.data.connectionStatus : '',
    typeof body?.data?.instance?.status === 'string' ? body.data.instance.status : '',
  ).toLowerCase();

  if (raw.includes('connected') && !raw.includes('disconnect')) return 'connected';
  if (raw.includes('connecting') || raw.includes('qrcode') || raw.includes('pair')) return 'connecting';
  if (
    connected === false ||
    raw.includes('disconnect') ||
    raw.includes('close') ||
    raw.includes('offline') ||
    raw.includes('logout') ||
    raw.includes('hibernate')
  ) return 'disconnected';
  return 'unknown';
}

async function handleDedicatedAiConnectionEvent(instance: string, state: string) {
  if (!instance.includes('_ai_') || state === 'unknown') return false;

  const { data: config } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('id, corretora_id, status')
    .eq('dedicated_instance_name', instance)
    .eq('sender_mode', 'dedicated')
    .maybeSingle();

  if (!config) return false;

  const nextStatus = state === 'connected'
    ? 'ativo'
    : state === 'disconnected' && config.status === 'ativo'
      ? 'desconexao_pendente'
      : config.status;
  if (config.status !== nextStatus) {
    await supabaseAdmin
      .from('corretora_ai_configs')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', config.id);
  }

  // O evento do provedor pode oscilar por alguns segundos. O monitor de saude
  // confirma a queda antes de encerrar sessoes e notificar a equipe.
  return true;
}

export async function POST(request: Request) {
  try {
    ensureLeadAiTimeoutScheduler();

    const body = await request.json().catch(() => ({}));
    const event = String(
      body?.wook ||
      body?.event ||
      body?.EventType ||
      body?.eventType ||
      body?.type ||
      body?.data?.wook ||
      body?.data?.event ||
      body?.data?.EventType ||
      body?.data?.eventType ||
      body?.data?.type ||
      ''
    ).toUpperCase();

    const callEvent = isCallEvent(body, event);
    const instance = readWebhookInstanceName(body);
    const connectionEvent = event.includes('CONNECTION') || event.includes('QRCODE') || event === 'CONNECTED' || event === 'DISCONNECTED';
    if (connectionEvent) {
      const connectionState = event.includes('QRCODE') ? 'connecting' : readConnectionState(body);
      const handled = await handleDedicatedAiConnectionEvent(instance, connectionState);
      return NextResponse.json({ ok: true, connection: connectionState, handled });
    }

    // No UAZAPI, a mensagem recebida tem wook "RECEIVE_MESSAGE" ou tipo similar.
    // Aceitamos qualquer evento que contenha MESSAGE, SEND, ou seja um Call.
    if (event && !event.includes('MESSAGE') && !event.includes('SEND') && !callEvent) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const providerId = readProviderId(body);
    let remoteJid = readRemoteJid(body);
    const providerPhone = providerId.includes(':') ? providerId.split(':')[0] : '';
    if ((!remoteJid || !isRemoteCandidate(remoteJid)) && isRemoteCandidate(providerPhone)) {
      remoteJid = providerPhone;
    }
    let phone = normalizePhone(remoteJid.split('@')[0]);
    let profile = await findProfileFromWebhook(body, instance);
    const commercialLead = profile?.corretor_id ? null : await findCommercialLead(phone);
    profile = profile || await findProfileFromCrmPhone(phone);
    if (!profile?.corretor_id && commercialLead) {
      profile = await findProfileById(commercialLead.created_by || commercialLead.sdr_id || commercialLead.closer_id);
    }

    // A operacao comercial nao tem corretora vinculada: os profiles do time
    // comercial ficam sem corretor_id, entao o lead comercial precisa passar
    // por aqui mesmo sem profile resolvido.
    const commercialMode = Boolean(commercialLead);

    if (!profile?.corretor_id && !commercialMode) {
      console.warn('[uazapi_webhook] Ignorado: nao consegui resolver profile da instancia/owner.', {
        instance,
        owner: readOwnerJid(body),
        event,
        phone,
        remoteJid,
        providerId,
        bodyKeys: Object.keys(body || {}).slice(0, 30),
        dataKeys: Object.keys(body?.data || {}).slice(0, 30),
        chatType: typeof body?.chat,
        chatKeys: body?.chat && typeof body.chat === 'object' ? Object.keys(body.chat).slice(0, 20) : [],
        chatSourceType: typeof body?.chatSource,
        chatSourceKeys: body?.chatSource && typeof body.chatSource === 'object' ? Object.keys(body.chatSource).slice(0, 20) : [],
        messageType: typeof body?.message,
        messageKeys: body?.message && typeof body.message === 'object' ? Object.keys(body.message).slice(0, 30) : [],
      });
      return NextResponse.json({ ok: true, ignored: true, reason: 'profile_not_found' });
    }

    let message = callEvent ? readCallText(body) : readText(body);
    
    const msgType = String(
      body?.type ||
      body?.messageType ||
      body?.message?.type ||
      body?.message?.messageType ||
      body?.message?.message?.type ||
      body?.message?.message?.messageType ||
      body?.data?.type ||
      body?.data?.messageType ||
      body?.data?.message?.type ||
      body?.data?.message?.messageType ||
      body?.data?.message?.message?.type ||
      body?.data?.message?.message?.messageType ||
      ''
    ).toLowerCase();
    const mediaMessage = pickMediaMessage(body);
    const mediaMime = pickString(
      body?.media_mimetype,
      body?.mimetype,
      body?.mimeType,
      body?.contentType,
      body?.data?.mimetype,
      body?.data?.mimeType,
      mediaMessage?.mimetype,
      mediaMessage?.mimeType
    ).toLowerCase();
    const hasAudioKey = deepHasKey(body, ['audioMessage', 'ptt', 'voiceMessage']);
    const hasImageKey = deepHasKey(body, ['imageMessage']);
    const hasVideoKey = deepHasKey(body, ['videoMessage']);
    const hasDocumentKey = deepHasKey(body, ['documentMessage']);
    const hasAudio = msgType === 'audio' || msgType === 'voice' || msgType.includes('audio') || msgType.includes('voice') || mediaMime.startsWith('audio/') || hasAudioKey;
    const hasImage = msgType === 'image' || msgType.includes('image') || mediaMime.startsWith('image/') || hasImageKey;
    const hasVideo = msgType === 'video' || msgType.includes('video') || mediaMime.startsWith('video/') || hasVideoKey;
    const hasDocument = msgType === 'document' || msgType.includes('document') || mediaMime.includes('pdf') || hasDocumentKey;
    const hasMedia = hasAudio || hasImage || hasVideo || hasDocument;

    let audioTranscript = '';
    let audioTranscriptionFailed = false;
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
        audioTranscriptionFailed = true;
        console.error('[uazapi_webhook] Failed processing inbound audio:', audioErr);
      }
      if (!audioTranscript) {
        audioTranscriptionFailed = true;
      }
    }

    if (!message && hasMedia) {
      if (hasAudio) message = '🎤 Mensagem de voz';
      else if (hasImage) message = '📷 Imagem';
      else if (hasVideo) message = '🎥 Vídeo';
      else if (hasDocument) message = '📎 Arquivo';
    }

    // Tratar quando a ligação de voz é efetuada pelo próprio corretor de fora do CRM.
    if (hasMedia) {
      const mediaFileName = String(mediaMetadata.media_file_name || '').trim();
      const genericMediaText = !message || /Mensagem de voz|Imagem|Video|Vídeo|Arquivo/i.test(message);
      if (mediaFileName && genericMediaText) {
        if (hasImage) message = `Imagem (${mediaFileName})`;
        else if (hasVideo) message = `Video (${mediaFileName})`;
        else if (hasDocument) message = `Arquivo (${mediaFileName})`;
      }
    }

    let isOutboundCall = false;
    const brokerPhone = profile?.telefone ? normalizePhone(profile.telefone) : '';
    if (callEvent && brokerPhone && phone === brokerPhone) {
      isOutboundCall = true;
      const otherJid = pickString(body?.to, body?.chatId, body?.remoteJid, body?.data?.to, body?.data?.chatId, body?.data?.remoteJid);
      const otherPhone = normalizePhone(otherJid.split('@')[0]);
      if (otherPhone && otherPhone !== brokerPhone) {
        phone = otherPhone;
      }
    }

    if (!message || !phone) {
      console.warn('[uazapi_webhook] Ignorado: mensagem ou telefone ausente.', {
        instance,
        profile: profile?.id || null,
        event,
        hasMessage: Boolean(message),
        hasPhone: Boolean(phone),
        phone,
        remoteJid: readRemoteJid(body),
        providerId,
        bodyKeys: Object.keys(body || {}).slice(0, 30),
        dataKeys: Object.keys(body?.data || {}).slice(0, 30),
        messageType: typeof body?.message,
        messageKeys: body?.message && typeof body.message === 'object' ? Object.keys(body.message).slice(0, 30) : [],
        messageMessageKeys: body?.message?.message && typeof body.message.message === 'object' ? Object.keys(body.message.message).slice(0, 20) : [],
      });
      return NextResponse.json({ ok: true, ignored: true, reason: 'missing_message_or_phone' });
    }

    if (!aiCustomerMessage) aiCustomerMessage = audioTranscript || message;
    const lead = commercialLead || await findLead(profile!, phone);
    const currentConversation = commercialMode
      ? await findCommercialConversation(phone)
      : await findConversation(profile!.corretor_id, phone, lead?.id || null);

    // Ignorar mensagens de contatos pessoais
    if (!lead && !currentConversation) {
      console.log(`[uazapi_webhook] Ignorando contato pessoal: ${phone} (corretor: ${profile?.corretor_id})`);
      return NextResponse.json({ ok: true, ignored: true, reason: 'Not a CRM lead' });
    }

    const providerContactName = body?.pushName || body?.senderName || body?.name || body?.data?.pushName || body?.data?.senderName || body?.data?.name;
    const contactName = cleanContactDisplayName(lead?.nome || providerContactName, phone);

    let conversation = currentConversation;
    if (!conversation) {
      // No modo comercial a conversa nasce sem corretora e sem lead_id, porque
      // whatsapp_conversas.lead_id referencia public.leads e nao comercial_leads.
      if (commercialMode) {
        conversation = await ensureCommercialConversation(phone, contactName);
      } else {
        const { data: created, error } = await supabaseAdmin
          .from('whatsapp_conversas')
          .insert([{
            corretor_id: profile!.corretor_id,
            lead_id: lead?.id || null,
            telefone: phone,
            nome_contato: contactName,
            status: 'aberta',
            ultima_mensagem_at: new Date().toISOString(),
          }])
          .select('*')
          .single();

        if (error) throw error;
        conversation = created;
      }
    } else {
      await supabaseAdmin
        .from('whatsapp_conversas')
        .update({
          lead_id: commercialMode ? currentConversation.lead_id : (currentConversation.lead_id || lead?.id || null),
          nome_contato: cleanContactDisplayName(lead?.nome || currentConversation.nome_contato || contactName, contactName),
          telefone: currentConversation.telefone || phone,
          ultima_mensagem_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentConversation.id);
    }

    const fromMe = Boolean(
      body?.fromMe === true ||
      body?.key?.fromMe === true ||
      body?.message?.key?.fromMe === true ||
      body?.message?.fromMe === true ||
      body?.data?.fromMe === true ||
      body?.data?.key?.fromMe === true ||
      body?.data?.message?.key?.fromMe === true ||
      event === 'SEND_MESSAGE' ||
      event.includes('SEND') ||
      isOutboundCall
    );

    if (fromMe && isAiOutbound(phone, message)) {
      console.log(`[uazapi_webhook] Ignorando retorno de mensagem enviada pela propria IA: ${phone}`);
      return NextResponse.json({ ok: true, ignored: true, ai_outbound: true });
    }

    const direction = fromMe ? 'outbound' : 'inbound';
    if (!providerId && !hasMedia && await hasRecentDuplicateMessage(conversation.id, direction, message)) {
      console.log('[uazapi_webhook] Ignorando mensagem duplicada recente.', {
        conversationId: conversation.id,
        direction,
        providerId,
        phone,
      });
      return NextResponse.json({ ok: true, duplicated: true, reason: 'recent_duplicate' });
    }

    const { error: insertError } = await supabaseAdmin.from('whatsapp_mensagens').insert([{
      conversa_id: conversation.id,
      direction,
      remetente: fromMe ? (commercialMode ? 'Aline' : (profile!.nome || 'Orion')) : contactName,
      mensagem: message,
      provider_message_id: providerId || null,
      metadata: {
        ...(body || {}),
        ...mediaMetadata,
        messageType: callEvent ? 'call' : body?.type,
        mediaType: callEvent ? 'call' : body?.type,
        isBrokerCall: callEvent ? fromMe : undefined,
        brokerName: (callEvent && fromMe) ? (profile?.nome || 'Orion') : undefined,
        audio_transcript: audioTranscript || undefined,
        ai_customer_message: aiCustomerMessage || undefined,
        audio_transcription_failed: hasAudio ? audioTranscriptionFailed : undefined,
      },
    }]);

    if (insertError) {
      if (insertError.code === '23505' && providerId) {
        console.log('[uazapi_webhook] Ignorando provider_message_id duplicado.', {
          conversationId: conversation.id,
          providerId,
          direction,
          phone,
        });
        return NextResponse.json({ ok: true, duplicated: true, reason: 'provider_message_id' });
      }

      throw insertError;
    }

    if (fromMe && lead?.id && !commercialMode) {
      after(async () => {
        try {
          await stopLeadAiForHumanTakeover(lead.id, profile?.nome);
        } catch (takeoverError) {
          console.error('[uazapi_webhook] Failed stopping AI after human takeover:', takeoverError);
        }
      });
    }

    if (!fromMe && lead?.id) {
      after(async () => {
        try {
        if (hasAudio && !audioTranscript && !commercialLead) {
          await handoffLeadAiToResponsible(
            lead.id,
            'audio recebido, mas nao foi possivel transcrever automaticamente. Responsavel deve ouvir o audio no inbox e assumir o atendimento sem resposta automatica ao cliente.'
          );
          return;
        }

        if (commercialLead) {
          await continueCommercialSdrFromIncoming({
            leadId: commercialLead.id,
            conversationId: conversation.id,
            customerMessage: hasAudio && !audioTranscript
              ? 'O cliente enviou um audio, mas nao foi possivel transcrever. Responda pedindo que envie a informacao por texto.'
              : aiCustomerMessage || message,
            phone,
          });
        } else {
          await continueLeadAiFromIncoming({
          leadId: lead.id,
          conversationId: conversation.id,
          customerMessage: hasAudio && !audioTranscript
            ? 'O cliente enviou um audio, mas nao foi possivel transcrever. Responda em uma frase curta dizendo que nao conseguiu ouvir direitinho e peça para enviar a informacao por texto.'
            : aiCustomerMessage || message,
            incomingWasAudio: hasAudio,
          });
        }
        } catch (aiErr) {
          console.error('[uazapi_webhook] Failed continuing lead AI:', aiErr);
        }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('uazapi_webhook_error', error);
    return NextResponse.json({ ok: false, error: 'Nao consegui registrar a mensagem.' }, { status: 500 });
  }
}
