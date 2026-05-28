import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { evolutionFetch, evolutionInstanceName, getEvolutionInstanceApiKey, normalizePhone } from '@/lib/evolution';
import { supabaseAdmin } from '@/lib/supabase/admin';

const INBOX_ROLES = ['admin', 'corretor', 'corretor_membro', 'account_manager'] as const;

async function getConversation(id: string) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function canAccessConversation(profile: any, conversation: any) {
  if (!conversation) return false;
  if (profile.tipo_usuario === 'admin' || profile.tipo_usuario === 'account_manager') return true;
  return Boolean(profile.corretor_id && profile.corretor_id === conversation.corretor_id);
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
    if (!canAccessConversation(guard.profile, conversation)) {
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

    if ((!conversationId && !phoneParam) || !text) {
      return NextResponse.json({ error: 'Escreva uma mensagem para enviar.' }, { status: 400 });
    }

    let conversation: any = null;

    if (conversationId && !conversationId.startsWith('new-')) {
      conversation = await getConversation(conversationId);
      if (!canAccessConversation(guard.profile, conversation)) {
        return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
      }
    } else {
      if (!guard.profile.corretor_id) {
        return NextResponse.json({ error: 'Apenas corretores vinculados podem iniciar conversas.' }, { status: 400 });
      }

      const phone = normalizePhone(phoneParam || conversationId.replace('new-', ''));
      if (!phone) {
        return NextResponse.json({ error: 'Telefone do contato invalido.' }, { status: 400 });
      }

      const { data: existing } = await supabaseAdmin
        .from('whatsapp_conversas')
        .select('*')
        .eq('corretor_id', guard.profile.corretor_id)
        .eq('telefone', phone)
        .limit(1)
        .maybeSingle();

      if (existing) {
        conversation = existing;
        conversationId = existing.id;
      } else {
        const contactName = nameParam || phone;
        const { data: created, error: createError } = await supabaseAdmin
          .from('whatsapp_conversas')
          .insert([{
            corretor_id: guard.profile.corretor_id,
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

    const instance = evolutionInstanceName(guard.profile.id);
    const instanceApiKey = await getEvolutionInstanceApiKey(instance);
    const payload = await evolutionFetch(`/message/sendText/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        number: phone,
        text,
      }),
    }, instanceApiKey);

    const providerId =
      payload?.key?.id ||
      payload?.message?.key?.id ||
      payload?.data?.key?.id ||
      payload?.id ||
      null;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .insert([{
        conversa_id: conversationId,
        direction: 'outbound',
        remetente: guard.profile.nome || guard.profile.email_real || guard.profile.email || 'Orion',
        mensagem: text,
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
    return NextResponse.json({ error: error.message || 'Nao consegui enviar a mensagem agora.' }, { status: 500 });
  }
}
