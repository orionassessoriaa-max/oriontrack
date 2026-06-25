import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';
import { supabaseAdmin } from '@/lib/supabase/admin';

const INBOX_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;

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
    metadata?.downloadUrl,
    metadata?.url,
    metadata?.path,
    metadata?.data?.media_url,
    metadata?.data?.mediaUrl,
    metadata?.data?.fileUrl,
    metadata?.data?.downloadUrl,
    metadata?.data?.url,
    metadata?.message?.mediaUrl,
    metadata?.message?.fileUrl,
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
    mediaMessage?.downloadUrl
  );

  return value && /^https?:\/\//i.test(value) ? value : null;
}

function pickProviderPayloadBase64(payload: any) {
  return stripDataUrl(pickString(
    payload?.base64,
    payload?.media,
    payload?.file,
    payload?.data?.base64,
    payload?.data?.media,
    payload?.data?.file,
    payload?.response?.base64,
    payload?.response?.media,
    payload?.response?.file
  ));
}

function pickProviderPayloadUrl(payload: any) {
  const value = pickString(
    payload?.media_url,
    payload?.mediaUrl,
    payload?.fileUrl,
    payload?.downloadUrl,
    payload?.url,
    payload?.data?.media_url,
    payload?.data?.mediaUrl,
    payload?.data?.fileUrl,
    payload?.data?.downloadUrl,
    payload?.data?.url,
    payload?.response?.mediaUrl,
    payload?.response?.fileUrl,
    payload?.response?.downloadUrl,
    payload?.response?.url
  );

  return value && /^https?:\/\//i.test(value) ? value : null;
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
    if (directBase64) {
      return NextResponse.json({ base64: directBase64, mimeType, fileName });
    }

    const directUrl = pickMediaUrl(message.metadata);
    if (directUrl) {
      return NextResponse.json({ url: directUrl, mimeType, fileName });
    }

    const providerId = message.provider_message_id;
    if (!providerId) {
      return NextResponse.json({ error: 'Esta mensagem nao possui arquivo salvo para abrir.' }, { status: 400 });
    }

    let instance =
      message.metadata?.instance ||
      message.metadata?.session ||
      message.metadata?.instanceName ||
      message.metadata?.data?.instance ||
      message.metadata?.data?.session;

    if (!instance) {
      const { data: ownerProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('corretor_id', conversation.corretor_id)
        .eq('tipo_usuario', 'corretor')
        .limit(1)
        .maybeSingle();

      const profileIdForInstance = ownerProfile ? ownerProfile.id : conversation.corretor_id;
      instance = uazapiInstanceName(profileIdForInstance);
    }

    const attempts = [
      {
        path: '/message/download',
        body: { id: providerId, messageId: providerId },
      },
      {
        path: '/message/media',
        body: { id: providerId, messageId: providerId },
      },
      {
        path: '/chat/getBase64FromMediaMessage',
        body: {
          message: {
            key: {
              id: providerId,
            },
          },
        },
      },
    ];

    for (const attempt of attempts) {
      try {
        console.log(`[Media API] Solicitando midia UAZAPI para providerId: ${providerId} na instancia: ${instance} via ${attempt.path}`);
        const payload = await uazapiFetch(attempt.path, {
          method: 'POST',
          body: JSON.stringify(attempt.body),
        }, { instanceName: instance });

        const base64 = pickProviderPayloadBase64(payload);
        if (base64) {
          return NextResponse.json({
            base64,
            mimeType: payload?.mimetype || payload?.mimeType || payload?.data?.mimetype || mimeType,
            fileName: payload?.fileName || payload?.filename || payload?.data?.fileName || fileName,
          });
        }

        const url = pickProviderPayloadUrl(payload);
        if (url) {
          return NextResponse.json({
            url,
            mimeType: payload?.mimetype || payload?.mimeType || payload?.data?.mimetype || mimeType,
            fileName: payload?.fileName || payload?.filename || payload?.data?.fileName || fileName,
          });
        }
      } catch (uazapiErr: any) {
        console.warn(`[Media API] UAZAPI nao retornou midia via ${attempt.path}:`, uazapiErr?.message || uazapiErr);
      }
    }

    const fallbackBase64 = pickMediaBase64(message.metadata);
    if (fallbackBase64) {
      return NextResponse.json({ base64: fallbackBase64, mimeType, fileName });
    }

    const fallbackUrl = pickMediaUrl(message.metadata);
    if (fallbackUrl) {
      return NextResponse.json({ url: fallbackUrl, mimeType, fileName });
    }

    return NextResponse.json({ error: 'Nao consegui extrair a midia desta mensagem pela UAZAPI.' }, { status: 404 });
  } catch (error: any) {
    console.error('[Media API Root Error]', error);
    return NextResponse.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
}
