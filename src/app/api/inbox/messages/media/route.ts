import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { evolutionFetch, getEvolutionInstanceApiKey } from '@/lib/evolution';
import { createDecipheriv, hkdfSync } from 'crypto';

const INBOX_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;
// Teto de arquivo guardado dentro da linha da mensagem. Era 15 MB, e foi o que
// levou whatsapp_mensagens a 970 MB num banco de 1 GB. Arquivo grande fica no
// Storage; o banco guarda so a URL.
const MAX_CACHE_BASE64_BYTES = Number(process.env.INBOX_MEDIA_CACHE_MAX_BYTES || 256 * 1024);
const MAX_PROXY_MEDIA_BYTES = Number(process.env.INBOX_MEDIA_PROXY_MAX_BYTES || 25 * 1024 * 1024);

function canProxyMediaUrl(value?: string | null) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;

    const configuredHost = (() => {
      try {
        return new URL(String(process.env.UAZAPI_URL || '')).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const hostname = url.hostname.toLowerCase();
    return hostname === configuredHost || hostname === 'uazapi.com' || hostname.endsWith('.uazapi.com');
  } catch {
    return false;
  }
}

async function proxyRemoteMedia(url: string, fallbackMimeType?: string | null) {
  if (!canProxyMediaUrl(url)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn('[Media API] URL externa recusou o download:', response.status);
      return null;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_PROXY_MEDIA_BYTES) {
      console.warn('[Media API] Arquivo externo excede o limite de visualizacao:', contentLength);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_PROXY_MEDIA_BYTES) return null;

    return {
      base64: buffer.toString('base64'),
      mimeType: response.headers.get('content-type')?.split(';')[0] || fallbackMimeType || 'application/octet-stream',
    };
  } catch (error: any) {
    console.warn('[Media API] Falha ao intermediar arquivo externo:', error?.message || error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getEvolutionMediaBase64(instance: string, providerId: string) {
  if (!providerId) return '';
  try {
    const instanceApiKey = await getEvolutionInstanceApiKey(instance);
    const payload = await evolutionFetch(`/chat/getBase64FromMediaMessage/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        message: {
          key: {
            id: providerId,
          },
        },
      }),
    }, instanceApiKey);

    return String(payload?.base64 || payload?.data?.base64 || payload?.media || payload?.data?.media || '').trim();
  } catch (err: any) {
    console.error(`[getEvolutionMediaBase64 ERROR]`, err?.message || err);
    return '';
  }
}

function pickMediaMessage(metadata: any) {
  const roots = [
    metadata,
    metadata?.message,
    metadata?.data?.message,
    metadata?.message?.message,
    metadata?.data?.message?.message,
    metadata?.message?.ephemeralMessage?.message,
    metadata?.data?.message?.ephemeralMessage?.message,
  ];

  for (const root of roots) {
    if (!root) continue;
    const media =
      root.audioMessage ||
      root.imageMessage ||
      root.videoMessage ||
      root.documentMessage ||
      root.stickerMessage;
    if (media) return media;

    // A UAZAPI tambem entrega midia no formato plano:
    // metadata.message = { type: 'document', mimetype, fileName, ... }.
    const flatType = String(root.type || root.messageType || root.mediaType || '').toLowerCase();
    if (['audio', 'ptt', 'image', 'video', 'document', 'file', 'sticker'].some((type) => flatType.includes(type))) {
      return root.content && typeof root.content === 'object'
        ? { ...root.content, type: root.type, messageType: root.messageType, mediaType: root.mediaType }
        : root;
    }
  }

  return null;
}

function pickString(...values: any[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function stripDataUrl(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.includes(';base64,') ? raw.split(';base64,')[1] : raw;
}

function isBrowserOpenableUrl(value?: string | null) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  // URLs do WhatsApp sao criptografadas e precisam ser baixadas/decriptadas pela UAZAPI.
  return !/\/\/[^/]*whatsapp\.net\//i.test(raw);
}

function byteObjectToBase64(value: any) {
  if (!value) return undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return Buffer.from(value).toString('base64');
  if (typeof value === 'object') {
    const numericKeys = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));

    if (numericKeys.length) {
      return Buffer.from(numericKeys.map((key) => Number(value[key]))).toString('base64');
    }
  }
  return undefined;
}

function longToNumber(value: any) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === 'object' && typeof value.low === 'number') {
    return value.low;
  }
  return undefined;
}

/**
 * Base64 gravado exatamente no teto e arquivo cortado, nao arquivo pequeno.
 * O audio do Sandro de 24/08 chegou com 262.144 bytes cravados e tocava so o
 * comeco. Nesses casos vale mais buscar de novo na central do que servir o
 * pedaco que esta no banco.
 */
function base64Truncado(base64?: string | null) {
  if (!base64) return false;
  const bytes = base64ByteLength(base64);
  return bytes >= MAX_CACHE_BASE64_BYTES;
}

function pickMediaBase64(metadata: any) {
  const mediaMessage = pickMediaMessage(metadata);
  return stripDataUrl(pickString(
    metadata?.media_base64,
    metadata?.mediaBase64,
    metadata?.base64,
    metadata?.file,
    metadata?.media,
    metadata?.data?.media_base64,
    metadata?.data?.mediaBase64,
    metadata?.data?.base64,
    metadata?.data?.file,
    metadata?.data?.media,
    metadata?.message?.base64,
    metadata?.message?.file,
    metadata?.message?.media,
    metadata?.audioMessage?.base64,
    metadata?.imageMessage?.base64,
    metadata?.videoMessage?.base64,
    metadata?.documentMessage?.base64,
    mediaMessage?.base64,
    mediaMessage?.file,
    mediaMessage?.media
  ));
}

function pickMediaUrl(metadata: any) {
  const mediaMessage = pickMediaMessage(metadata);
  const value = pickString(
    metadata?.media_url,
    metadata?.mediaUrl,
    metadata?.fileUrl,
    metadata?.fileURL,
    metadata?.downloadUrl,
    metadata?.downloadURL,
    metadata?.url,
    metadata?.path,
    metadata?.data?.media_url,
    metadata?.data?.mediaUrl,
    metadata?.data?.fileUrl,
    metadata?.data?.fileURL,
    metadata?.data?.downloadUrl,
    metadata?.data?.downloadURL,
    metadata?.data?.url,
    metadata?.message?.mediaUrl,
    metadata?.message?.fileUrl,
    metadata?.message?.fileURL,
    metadata?.message?.url,
    metadata?.message?.audioMessage?.url,
    metadata?.data?.message?.audioMessage?.url,
    metadata?.message?.imageMessage?.url,
    metadata?.data?.message?.imageMessage?.url,
    metadata?.message?.videoMessage?.url,
    metadata?.data?.message?.videoMessage?.url,
    metadata?.message?.documentMessage?.url,
    metadata?.data?.message?.documentMessage?.url,
    mediaMessage?.url,
    mediaMessage?.mediaUrl,
    mediaMessage?.fileUrl,
    mediaMessage?.fileURL,
    mediaMessage?.downloadUrl,
    mediaMessage?.downloadURL
  );

  return isBrowserOpenableUrl(value) ? value : null;
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
    payload?.response?.file
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

  return isBrowserOpenableUrl(value) ? value : null;
}

function buildUazapiDownloadPayloads(providerId: string, mediaMessage: any) {
  const body: Record<string, any> = {
    id: providerId,
    messageId: providerId,
  };
  const wrappedMessage: Record<string, any> = {};

  const mediaUrl = mediaMessage?.url || mediaMessage?.URL;
  if (mediaUrl) {
    body.Url = mediaUrl;
    body.url = mediaUrl;
    wrappedMessage.Url = mediaUrl;
  }
  if (mediaMessage?.mimetype || mediaMessage?.mimeType) {
    body.Mimetype = mediaMessage.mimetype || mediaMessage.mimeType;
    body.mimetype = mediaMessage.mimetype || mediaMessage.mimeType;
    wrappedMessage.Mimetype = mediaMessage.mimetype || mediaMessage.mimeType;
  }

  const mediaKey = byteObjectToBase64(mediaMessage?.mediaKey);
  if (mediaKey) {
    body.MediaKey = mediaKey;
    body.mediaKey = mediaKey;
    wrappedMessage.MediaKey = mediaKey;
  }

  const fileSha256 = byteObjectToBase64(mediaMessage?.fileSha256 || mediaMessage?.fileSHA256);
  if (fileSha256) {
    body.FileSHA256 = fileSha256;
    body.fileSha256 = fileSha256;
    wrappedMessage.FileSHA256 = fileSha256;
  }

  const fileEncSha256 = byteObjectToBase64(mediaMessage?.fileEncSha256 || mediaMessage?.fileEncSHA256);
  if (fileEncSha256) {
    body.FileEncSHA256 = fileEncSha256;
    body.fileEncSha256 = fileEncSha256;
    wrappedMessage.FileEncSHA256 = fileEncSha256;
  }

  const fileLength = longToNumber(mediaMessage?.fileLength);
  if (fileLength) {
    body.FileLength = fileLength;
    body.fileLength = fileLength;
    wrappedMessage.FileLength = fileLength;
  }

  if (mediaMessage?.directPath) {
    body.DirectPath = mediaMessage.directPath;
    body.directPath = mediaMessage.directPath;
    wrappedMessage.DirectPath = mediaMessage.directPath;
  }

  return [
    {
      message: {
        key: { id: providerId },
        message: wrappedMessage,
      },
      convertToMp4: true,
    },
    body,
  ];
}

function whatsappMediaInfo(mimeType?: string | null) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'WhatsApp Image Keys';
  if (mime.startsWith('video/')) return 'WhatsApp Video Keys';
  if (mime.startsWith('audio/')) return 'WhatsApp Audio Keys';
  return 'WhatsApp Document Keys';
}

async function decryptWhatsAppMediaFromMetadata(mediaMessage: any, mimeType?: string | null) {
  const encryptedUrl = pickString(mediaMessage?.url, mediaMessage?.URL, mediaMessage?.mediaUrl, mediaMessage?.downloadUrl);
  const mediaKeyBase64 = byteObjectToBase64(mediaMessage?.mediaKey);
  if (!encryptedUrl || !mediaKeyBase64 || !/^https?:\/\//i.test(encryptedUrl)) return null;

  const response = await fetch(encryptedUrl, { cache: 'no-store' });
  if (!response.ok) {
    console.warn('[Media API] Nao foi possivel baixar binario criptografado do WhatsApp:', response.status);
    return null;
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  if (encrypted.length <= 10) return null;

  const mediaKey = Buffer.from(mediaKeyBase64, 'base64');
  const expanded = Buffer.from(hkdfSync(
    'sha256',
    mediaKey,
    Buffer.alloc(32),
    Buffer.from(whatsappMediaInfo(mimeType)),
    112
  ));

  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const ciphertext = encrypted.subarray(0, encrypted.length - 10);
  const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('base64');
}

function base64ByteLength(base64: string) {
  const clean = stripDataUrl(base64) || '';
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

async function cacheRecoveredMedia(message: any, payload: { base64?: string | null; url?: string | null; mimeType?: string | null; fileName?: string | null }) {
  const base64 = stripDataUrl(payload.base64);
  // Arquivo que ja tem URL nao volta para dentro do banco. Sem esta guarda, abrir
  // a midia no inbox regravava o base64 na linha e a tabela inchava de novo:
  // whatsapp_mensagens sozinha ja chegou a 970 MB por causa disso.
  const alreadyStored = Boolean(pickMediaUrl(message.metadata) || payload.url);
  const shouldCacheBase64 = !alreadyStored && base64 && base64ByteLength(base64) <= MAX_CACHE_BASE64_BYTES;
  const metadata = {
    ...(message.metadata || {}),
    ...(shouldCacheBase64 ? { media_base64: base64 } : {}),
    ...(payload.url ? { media_url: payload.url } : {}),
    ...(payload.mimeType ? { media_mimetype: payload.mimeType } : {}),
    ...(payload.fileName ? { media_file_name: payload.fileName } : {}),
    media_cached_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .update({ metadata })
    .eq('id', message.id);

  if (error) {
    console.warn('[Media API] Nao foi possivel cachear midia recuperada:', error.message);
  }
}

async function getMessageAndConversation(messageId: string) {
  const { data: message, error: msgError } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('*')
    .eq('id', messageId)
    .maybeSingle();

  if (msgError) throw msgError;
  if (!message) return { message: null, conversation: null };

  const { data: conversation, error: convError } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('id', message.conversa_id)
    .maybeSingle();

  if (convError) throw convError;
  return { message, conversation };
}

async function canAccessConversation(profile: any, conversation: any) {
  if (!conversation) return false;
  if (profile.tipo_usuario === 'admin' || profile.tipo_usuario === 'account_manager') return true;

  // No Inbox comercial, o papel definido em comercial_membros prevalece sobre
  // o tipo operacional do profile. Closer e coordenador supervisionam todas as
  // conversas comerciais; SDR acessa somente os leads atribuídos a ele.
  const { data: commercialMember } = await supabaseAdmin
    .from('comercial_membros')
    .select('papel,ativo')
    .eq('profile_id', profile.id)
    .eq('ativo', true)
    .maybeSingle();

  if (commercialMember) {
    const phoneDigits = String(conversation.telefone || '').replace(/\D/g, '');
    const last8 = phoneDigits.slice(-8);
    if (last8) {
      let commercialQuery = supabaseAdmin
        .from('comercial_leads')
        .select('id,sdr_id,closer_id,telefone')
        .ilike('telefone', `%${last8.slice(-4)}`);

      if (commercialMember.papel === 'sdr') {
        commercialQuery = commercialQuery.eq('sdr_id', profile.id);
      }

      const { data: commercialCandidates } = await commercialQuery.limit(100);
      const commercialLead = (commercialCandidates || []).find((lead) => {
        const leadPhone = String(lead.telefone || '').replace(/\D/g, '');
        return leadPhone.slice(-8) === last8;
      });
      if (commercialLead) return true;
    }

    if (commercialMember.papel === 'sdr' && !conversation.corretor_id) return false;
  }

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

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, [...INBOX_ROLES]);
    if ('error' in guard) return guard.error;

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('message_id');
    const forceRefresh = searchParams.get('refresh') === '1';
    if (!messageId) {
      return NextResponse.json({ error: 'ID da mensagem invalido.' }, { status: 400 });
    }

    const { message, conversation } = await getMessageAndConversation(messageId);
    if (!message || !conversation) {
      return NextResponse.json({ error: 'Mensagem nao encontrada.' }, { status: 404 });
    }

    if (!(await canAccessConversation(guard.profile, conversation))) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }

    const mediaMessage = pickMediaMessage(message.metadata);
    const mimeType =
      message.metadata?.media_mimetype ||
      message.metadata?.mediaMimeType ||
      mediaMessage?.mimetype ||
      mediaMessage?.mimeType ||
      message.metadata?.mimetype ||
      message.metadata?.mimeType ||
      'application/octet-stream';
    const fileName =
      message.metadata?.media_file_name ||
      message.metadata?.mediaFileName ||
      mediaMessage?.fileName ||
      mediaMessage?.filename ||
      message.metadata?.fileName ||
      message.metadata?.filename ||
      null;

    const directBase64 = pickMediaBase64(message.metadata);
    // Arquivo cortado no teto nao serve: melhor tentar baixar inteiro da
    // central e so cair para o pedaco se nao houver outro caminho.
    const cortado = base64Truncado(directBase64);
    if (directBase64 && !cortado && (!forceRefresh || !message.provider_message_id)) {
      return NextResponse.json({ base64: directBase64, mimeType, fileName });
    }

    const providerId = message.provider_message_id;
    const directUrl = pickMediaUrl(message.metadata);
    if (directUrl && (!forceRefresh || !providerId)) {
      const proxied = await proxyRemoteMedia(directUrl, mimeType);
      if (proxied) {
        const recovered = { ...proxied, fileName };
        await cacheRecoveredMedia(message, recovered);
        return NextResponse.json(recovered);
      }
    }

    if (!providerId) {
      return NextResponse.json({ error: 'Esta mensagem nao possui arquivo salvo para abrir.' }, { status: 400 });
    }

    const metadataInstances = [
      message.metadata?.instance,
      message.metadata?.session,
      message.metadata?.instanceName,
      message.metadata?.data?.instance,
      message.metadata?.data?.session,
      message.metadata?.data?.instanceName,
      message.metadata?.message?.instance,
      message.metadata?.message?.instanceName,
    ].filter(Boolean) as string[];

    // Uma conversa pode ter passado pela IA, pelo administrador e por outro
    // integrante. Tentar somente o primeiro profile da corretora fazia o
    // download procurar a midia na sessao errada.
    const { data: relatedProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('corretor_id', conversation.corretor_id)
      .limit(100);

    const relatedProfileIds = new Set((relatedProfiles || []).map((item) => String(item.id)).filter(Boolean));
    if (conversation.lead_id) {
      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('responsavel_profile_id')
        .eq('id', conversation.lead_id)
        .maybeSingle();
      if (lead?.responsavel_profile_id) relatedProfileIds.add(String(lead.responsavel_profile_id));
    }

    const profileInstances = Array.from(relatedProfileIds).map((profileId) => uazapiInstanceName(profileId));
    const currentActiveInstance = metadataInstances[0] || profileInstances[0] || null;

    // A instancia certa e a que o webhook gravou na mensagem. As dos colegas
    // entram so como plano B, e no maximo quatro: uma corretora com cem perfis
    // gerava cem chamadas por midia aberta. Foram 17 mil chamadas em tres horas,
    // o que derrubava a abertura e ainda fazia a central bloquear por excesso.
    // apolo_master_sender saiu da lista: e o numero do notificador, nunca teve
    // midia de conversa.
    const instancesToTry = Array.from(new Set([
      ...metadataInstances,
      ...profileInstances,
    ].filter(Boolean) as string[])).slice(0, 4);

    const isEvolution =
      message.metadata?.event === 'messages.upsert' ||
      String(message.metadata?.destination || '').includes('evolution');

    if (isEvolution) {
      console.log(`[Media API] Mensagem identificada como Evolution API. Tentando Evolution primeiro.`);
      const evoInstance = metadataInstances[0] || currentActiveInstance;
      if (evoInstance) {
        try {
          const evoBase64 = await getEvolutionMediaBase64(evoInstance, providerId);
          if (evoBase64) {
            const recovered = { base64: evoBase64, mimeType, fileName };
            await cacheRecoveredMedia(message, recovered);
            return NextResponse.json(recovered);
          }
        } catch (evoErr: any) {
          console.warn(`[Media API] Evolution API falhou em descriptografar:`, evoErr?.message || evoErr);
        }
      }
    }

    console.log('[Media API] Instancias para tentar download UAZAPI da mensagem %s:', messageId, instancesToTry);

    for (const inst of instancesToTry) {
      const attempts = buildUazapiDownloadPayloads(providerId, mediaMessage).map((body) => ({
        path: '/message/download',
        body,
      }));

      for (const attempt of attempts) {
        try {
          console.log(`[Media API] Solicitando midia UAZAPI para providerId: ${providerId} na instancia: ${inst} via ${attempt.path}`);
          const payload = await uazapiFetch(attempt.path, {
            method: 'POST',
            body: JSON.stringify(attempt.body),
          }, { instanceName: inst });

          const base64 = pickProviderPayloadBase64(payload);
          if (base64) {
            const recovered = {
              base64,
              mimeType: payload?.mimetype || payload?.mimeType || payload?.data?.mimetype || mimeType,
              fileName: payload?.fileName || payload?.filename || payload?.data?.fileName || fileName,
            };
            await cacheRecoveredMedia(message, recovered);
            return NextResponse.json(recovered);
          }

          const url = pickProviderPayloadUrl(payload);
          if (url) {
            const recoveredMimeType = payload?.mimetype || payload?.mimeType || payload?.data?.mimetype || mimeType;
            const proxied = await proxyRemoteMedia(url, recoveredMimeType);
            if (proxied) {
              const recovered = {
                ...proxied,
                fileName: payload?.fileName || payload?.filename || payload?.data?.fileName || fileName,
              };
              await cacheRecoveredMedia(message, recovered);
              return NextResponse.json(recovered);
            }
          }
        } catch (uazapiErr: any) {
          console.warn('[Media API] UAZAPI nao retornou midia via %s na instancia %s:', attempt.path, inst, uazapiErr?.message || uazapiErr);
        }
      }
    }

    if (!isEvolution) {
      const evoInstance = metadataInstances[0] || currentActiveInstance;
      if (evoInstance) {
        try {
          console.log(`[Media API] UAZAPI falhou. Tentando Evolution API como fallback secundario.`);
          const evoBase64 = await getEvolutionMediaBase64(evoInstance, providerId);
          if (evoBase64) {
            const recovered = { base64: evoBase64, mimeType, fileName };
            await cacheRecoveredMedia(message, recovered);
            return NextResponse.json(recovered);
          }
        } catch (evoErr: any) {
          console.warn(`[Media API] Evolution API fallback secundario falhou:`, evoErr?.message || evoErr);
        }
      }
    }

    const fallbackBase64 = pickMediaBase64(message.metadata);
    if (fallbackBase64) {
      return NextResponse.json({ base64: fallbackBase64, mimeType, fileName });
    }

    if (mediaMessage) {
      try {
        const decryptedBase64 = await decryptWhatsAppMediaFromMetadata(mediaMessage, mimeType);
        if (decryptedBase64) {
          const recovered = { base64: decryptedBase64, mimeType, fileName };
          await cacheRecoveredMedia(message, recovered);
          return NextResponse.json(recovered);
        }
      } catch (decryptErr: any) {
        console.warn('[Media API] Fallback de descriptografia direta falhou:', decryptErr?.message || decryptErr);
      }
    }

    const fallbackUrl = pickMediaUrl(message.metadata);
    if (fallbackUrl) {
      const proxied = await proxyRemoteMedia(fallbackUrl, mimeType);
      if (proxied) {
        const recovered = { ...proxied, fileName };
        await cacheRecoveredMedia(message, recovered);
        return NextResponse.json(recovered);
      }
    }

    return NextResponse.json({ error: 'Nao consegui extrair a midia desta mensagem pelo UAZAPI ou Evolution API.' }, { status: 404 });
  } catch (error: any) {
    console.error('[Media API Root Error]', error);
    return NextResponse.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
}
