import { NextResponse } from 'next/server';
import { evolutionFetch, getEvolutionInstanceApiKey, normalizePhone, profileIdFromEvolutionInstance } from '@/lib/evolution';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { continueLeadAiFromIncoming } from '@/lib/leadAiAgent';

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

function getAudioMessage(data: any) {
  return data?.message?.audioMessage || data?.message?.message?.audioMessage || null;
}

async function getMediaBase64(instance: string, providerId: string) {
  if (!providerId) return '';
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
    console.error('[evolution_webhook] Audio transcription failed:', payload);
    return '';
  }

  return String(payload?.text || '').trim();
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
    .or(`telefone.ilike.%${last8}%,telefone.ilike.%${last8WithHyphen}%`);

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
    .or(`telefone.eq.${phone},telefone.ilike.%${last8}%`)
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
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
      .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa')
      .eq('id', profileId)
      .maybeSingle();

    if (!profile?.corretor_id) return NextResponse.json({ ok: true, ignored: true });

    let message = readText(data);
    const audioMessage = getAudioMessage(data);
    const hasAudio = Boolean(audioMessage);
    const hasImage = Boolean(data?.message?.imageMessage);
    const hasVideo = Boolean(data?.message?.videoMessage);
    const hasDocument = Boolean(data?.message?.documentMessage);
    const hasMedia = hasAudio || hasImage || hasVideo || hasDocument;
    const providerId = String(data?.key?.id || data?.id || body?.id || '');
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

    if (hasAudio) {
      try {
        const mediaBase64 = await getMediaBase64(instance, providerId);
        const mimeType = String(audioMessage?.mimetype || audioMessage?.mimeType || 'audio/ogg');
        audioTranscript = mediaBase64 ? await transcribeAudio(mediaBase64, mimeType) : '';
        if (audioTranscript) {
          aiCustomerMessage = `Audio transcrito do cliente: ${audioTranscript}`;
        }
      } catch (audioErr) {
        console.error('[evolution_webhook] Failed processing inbound audio:', audioErr);
      }
    }

    if (!message && hasMedia) {
      if (hasAudio) message = '🎤 Mensagem de voz';
      else if (hasImage) message = '📷 Imagem';
      else if (hasVideo) message = '🎥 Vídeo';
      else if (hasDocument) message = '📎 Arquivo';
    }

    const remoteJid = readRemoteJid(data);
    const phone = normalizePhone(remoteJid.split('@')[0]);
    if (!message || !phone) return NextResponse.json({ ok: true, ignored: true });

    if (!aiCustomerMessage) aiCustomerMessage = audioTranscript || message;
    const lead = await findLead(profile, phone);

    const currentConversation = await findConversation(profile.corretor_id, phone, lead?.id || null);

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

    const fromMe = Boolean(data?.key?.fromMe || data?.fromMe);
    await supabaseAdmin.from('whatsapp_mensagens').insert([{
      conversa_id: conversation.id,
      direction: fromMe ? 'outbound' : 'inbound',
      remetente: fromMe ? (profile.nome || 'Orion') : contactName,
      mensagem: message,
      provider_message_id: providerId || null,
      metadata: {
        ...(body || {}),
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
        console.error('[evolution_webhook] Failed continuing lead AI:', aiErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('evolution_webhook_error', error);
    return NextResponse.json({ ok: false, error: 'Nao consegui registrar a mensagem.' }, { status: 500 });
  }
}
