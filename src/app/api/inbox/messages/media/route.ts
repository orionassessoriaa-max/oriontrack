import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { evolutionFetch, evolutionInstanceName, getEvolutionInstanceApiKey } from '@/lib/evolution';
import { supabaseAdmin } from '@/lib/supabase/admin';

const INBOX_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;

function pickMediaMessage(metadata: any) {
  const roots = [
    metadata?.message,
    metadata?.data?.message,
    metadata?.message?.message,
    metadata?.data?.message?.message,
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

function pickMediaUrl(metadata: any) {
  return (
    metadata?.message?.audioMessage?.url ||
    metadata?.data?.message?.audioMessage?.url ||
    metadata?.message?.imageMessage?.url ||
    metadata?.data?.message?.imageMessage?.url ||
    metadata?.message?.videoMessage?.url ||
    metadata?.data?.message?.videoMessage?.url ||
    metadata?.message?.documentMessage?.url ||
    metadata?.data?.message?.documentMessage?.url ||
    metadata?.url ||
    metadata?.data?.url ||
    null
  );
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
      mediaMessage?.mimetype ||
      mediaMessage?.mimeType ||
      message.metadata?.mimetype ||
      message.metadata?.mimeType ||
      'application/octet-stream';
    const fileName =
      mediaMessage?.fileName ||
      mediaMessage?.filename ||
      message.metadata?.fileName ||
      message.metadata?.filename ||
      null;

    const providerId = message.provider_message_id;
    if (!providerId) {
      const directUrl = pickMediaUrl(message.metadata);
      if (directUrl) {
        return NextResponse.json({ url: directUrl, mimeType, fileName });
      }
      return NextResponse.json({ error: 'Esta mensagem nao possui ID do provedor de WhatsApp.' }, { status: 400 });
    }

    // Identificar a instancia correta
    let instance = message.metadata?.instance || message.metadata?.instanceName || message.metadata?.data?.instance;
    if (!instance) {
      // fallback: buscar o profile principal do corretor
      const { data: ownerProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('corretor_id', conversation.corretor_id)
        .eq('tipo_usuario', 'corretor')
        .limit(1)
        .maybeSingle();

      const profileIdForInstance = ownerProfile ? ownerProfile.id : conversation.corretor_id;
      instance = evolutionInstanceName(profileIdForInstance);
    }

    const instanceApiKey = await getEvolutionInstanceApiKey(instance);

    // Requisitar midia da Evolution API
    try {
      console.log(`[Media API] Solicitando base64 para providerId: ${providerId} na instancia: ${instance}`);
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

      const base64 = payload?.base64 || payload?.data?.base64 || payload?.media || payload?.data?.media;
      if (base64) {
        return NextResponse.json({
          base64,
          mimeType: payload?.mimetype || payload?.mimeType || payload?.data?.mimetype || mimeType,
          fileName: payload?.fileName || payload?.filename || payload?.data?.fileName || fileName,
        });
      }
    } catch (evoErr: any) {
      console.error('[Media API Error calling Evolution]', evoErr);
    }

    // Fallback: verificar se existe URL de midia no metadata
    const directUrl = pickMediaUrl(message.metadata);

    if (directUrl) {
      return NextResponse.json({ url: directUrl, mimeType, fileName });
    }

    return NextResponse.json({ error: 'Nao consegui extrair a midia desta mensagem da Evolution API.' }, { status: 404 });
  } catch (error: any) {
    console.error('[Media API Root Error]', error);
    return NextResponse.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
}
