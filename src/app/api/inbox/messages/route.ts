import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { evolutionFetch, evolutionInstanceName, getEvolutionInstanceApiKey, normalizePhone } from '@/lib/evolution';
import { supabaseAdmin } from '@/lib/supabase/admin';

const INBOX_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;

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

    const { data, error } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('*')
      .eq('conversa_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(300);

    if (error) throw error;
    return NextResponse.json({ messages: data || [] });
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

      const phone = normalizePhone(phoneParam || conversationId.replace('new-', ''));
      if (!phone) {
        return NextResponse.json({ error: 'Telefone do contato invalido.' }, { status: 400 });
      }

      const { data: existing } = await supabaseAdmin
        .from('whatsapp_conversas')
        .select('*')
        .eq('corretor_id', corretorId)
        .eq('telefone', phone)
        .limit(1)
        .maybeSingle();

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
    }

    const phone = normalizePhone(conversation.telefone);
    if (!phone) {
      return NextResponse.json({ error: 'Telefone do contato invalido.' }, { status: 400 });
    }

    let senderProfileId = guard.profile.id;
    const viewingProfileId = request.headers.get('x-orion-view-profile-id');
    if (guard.profile.tipo_usuario === 'admin' && viewingProfileId) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', viewingProfileId)
        .maybeSingle();
      if (data) senderProfileId = data.id;
    }

    const instance = evolutionInstanceName(senderProfileId);
    const instanceApiKey = await getEvolutionInstanceApiKey(instance);
    
    let payload: any = null;

    if (mediaBase64) {
      // Remove prefixo do data URI se houver
      const base64Data = mediaBase64.includes(';base64,') 
        ? mediaBase64.split(';base64,')[1] 
        : mediaBase64;

      payload = await evolutionFetch(`/message/sendMedia/${instance}`, {
        method: 'POST',
        body: JSON.stringify({
          number: phone,
          mediatype: mediatype || 'document',
          mimetype: mimetype || 'application/octet-stream',
          media: base64Data,
          fileName: fileName || 'arquivo',
          caption: text || undefined,
        }),
      }, instanceApiKey);
    } else {
      payload = await evolutionFetch(`/message/sendText/${instance}`, {
        method: 'POST',
        body: JSON.stringify({
          number: phone,
          text,
        }),
      }, instanceApiKey);
    }

    const providerId =
      payload?.key?.id ||
      payload?.message?.key?.id ||
      payload?.data?.key?.id ||
      payload?.id ||
      null;

    let messageTextDb = text;
    if (mediaBase64) {
      const typeLabel = mediatype === 'image' ? '📷 Imagem' : mediatype === 'audio' ? '🎵 Áudio' : mediatype === 'video' ? '🎥 Vídeo' : '📎 Arquivo';
      messageTextDb = text ? `${typeLabel}: ${text}` : `${typeLabel} (${fileName})`;
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .insert([{
        conversa_id: conversationId,
        direction: 'outbound',
        remetente: guard.profile.nome || guard.profile.email_real || guard.profile.email || 'Orion',
        mensagem: messageTextDb,
        provider_message_id: providerId,
        metadata: payload || {},
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
    return NextResponse.json({ error: error.message || 'Nao consegui enviar a mensagem agora.' }, { status: 500 });
  }
}
