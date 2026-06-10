import { NextResponse } from 'next/server';
import { normalizePhone, profileIdFromEvolutionInstance } from '@/lib/evolution';
import { supabaseAdmin } from '@/lib/supabase/admin';

function readText(data: any) {
  return String(
    data?.message?.conversation ||
    data?.message?.extendedTextMessage?.text ||
    data?.message?.imageMessage?.caption ||
    data?.message?.videoMessage?.caption ||
    data?.body ||
    data?.text ||
    data?.messageText ||
    ''
  ).trim();
}

function readRemoteJid(data: any) {
  return String(
    data?.key?.remoteJid ||
    data?.remoteJid ||
    data?.chatId ||
    data?.from ||
    data?.jid ||
    ''
  );
}

async function findLead(corretorId: string, phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;

  const last8 = digits.slice(-8);
  const last8WithHyphen = `${last8.slice(0, 4)}-${last8.slice(4)}`;

  const { data } = await supabaseAdmin
    .from('leads')
    .select('id, nome, telefone')
    .eq('corretor_id', corretorId)
    .or(`telefone.ilike.%${last8}%,telefone.ilike.%${last8WithHyphen}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const data = body?.data || body;
    const event = String(body?.event || body?.type || '').toUpperCase();

    if (event && !event.includes('MESSAGE') && !event.includes('SEND')) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const instance = String(body?.instance || body?.instanceName || data?.instance || data?.instanceName || '');
    const profileId = profileIdFromEvolutionInstance(instance);
    if (!profileId) return NextResponse.json({ ok: true, ignored: true });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, corretor_id')
      .eq('id', profileId)
      .maybeSingle();

    if (!profile?.corretor_id) return NextResponse.json({ ok: true, ignored: true });

    const message = readText(data);
    const remoteJid = readRemoteJid(data);
    const phone = normalizePhone(remoteJid.split('@')[0]);
    if (!message || !phone) return NextResponse.json({ ok: true, ignored: true });

    const providerId = String(data?.key?.id || data?.id || body?.id || '');
    if (providerId) {
      const { data: existing } = await supabaseAdmin
        .from('whatsapp_mensagens')
        .select('id')
        .eq('provider_message_id', providerId)
        .limit(1)
        .maybeSingle();
      if (existing) return NextResponse.json({ ok: true, duplicated: true });
    }

    const lead = await findLead(profile.corretor_id, phone);

    const { data: currentConversation } = await supabaseAdmin
      .from('whatsapp_conversas')
      .select('*')
      .eq('corretor_id', profile.corretor_id)
      .eq('telefone', phone)
      .limit(1)
      .maybeSingle();

    // Ignorar mensagens de contatos pessoais (que não sejam leads no CRM e não possuam conversa já criada no banco)
    if (!lead && !currentConversation) {
      console.log(`[evolution_webhook] Ignorando contato pessoal: ${phone} (corretor: ${profile.corretor_id})`);
      return NextResponse.json({ ok: true, ignored: true, reason: 'Not a CRM lead' });
    }

    const contactName = data?.pushName || data?.senderName || data?.name || lead?.nome || phone;

    let conversation = currentConversation;
    if (!conversation) {
      const { data: created, error } = await supabaseAdmin
        .from('whatsapp_conversas')
        .insert([{
          corretor_id: profile.corretor_id,
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
    } else {
      await supabaseAdmin
        .from('whatsapp_conversas')
        .update({
          lead_id: currentConversation.lead_id || lead?.id || null,
          nome_contato: currentConversation.nome_contato || contactName,
          ultima_mensagem_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentConversation.id);
    }

    const fromMe = Boolean(data?.key?.fromMe || data?.fromMe);
    await supabaseAdmin.from('whatsapp_mensagens').insert([{
      conversa_id: conversation.id,
      direction: fromMe ? 'outbound' : 'inbound',
      remetente: fromMe ? (profile.nome || 'Orion') : contactName,
      mensagem: message,
      provider_message_id: providerId || null,
      metadata: body || {},
    }]);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('evolution_webhook_error', error);
    return NextResponse.json({ ok: false, error: 'Nao consegui registrar a mensagem.' }, { status: 500 });
  }
}
