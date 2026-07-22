import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(body.telefone);
    const name = String(body.nome || 'Teste IA').trim().slice(0, 120) || 'Teste IA';
    const ages = String(body.idades || '32').trim().slice(0, 80) || '32';
    if (!phone || phone.length < 12) return NextResponse.json({ error: 'Informe um WhatsApp valido com DDD.' }, { status: 400 });

    const { data: config, error: configError } = await supabaseAdmin.from('comercial_config').select('ia_sdr_ativa,ia_sdr_prompt,ia_sdr_profile_id').eq('id', 1).maybeSingle();
    if (configError && !/comercial_config|schema cache/i.test(configError.message)) throw configError;
    if (config?.ia_sdr_ativa === false) return NextResponse.json({ error: 'A IA SDR esta desativada para esta operacao.' }, { status: 409 });

    const senderId = String(config?.ia_sdr_profile_id || (guard.isDevOps ? guard.profile.id : '')).trim();
    if (!senderId) return NextResponse.json({ error: 'Selecione a instancia WhatsApp da IA na configuracao.' }, { status: 409 });
    const { data: sender, error: senderError } = await supabaseAdmin.from('profiles').select('id,nome,telefone').eq('id', senderId).maybeSingle();
    if (senderError) throw senderError;
    if (!sender) return NextResponse.json({ error: 'Perfil da instancia WhatsApp nao encontrado.' }, { status: 404 });

    const prompt = String(config?.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY nao configurada.' }, { status: 503 });
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        temperature: 0.55,
        messages: [
          { role: 'system', content: `${prompt}\n\nResponda somente com a primeira mensagem curta para iniciar este teste. Nao mencione que e um teste, IA ou sistema.` },
          { role: 'user', content: `Nome do lead: ${name}\nIdades: ${ages}\nEscreva a abertura do atendimento.` },
        ],
      }),
    });
    const aiPayload = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) return NextResponse.json({ error: aiPayload?.error?.message || 'A IA nao conseguiu gerar a mensagem.' }, { status: 502 });
    const message = String(aiPayload?.choices?.[0]?.message?.content || '').trim();
    if (!message) return NextResponse.json({ error: 'A IA nao retornou uma mensagem.' }, { status: 502 });

    const now = new Date().toISOString();
    const { data: lead, error: leadError } = await supabaseAdmin.from('comercial_leads').insert({
      nome: name,
      telefone: phone,
      idades: ages,
      origem: 'Teste IA SDR',
      status: 'Oportunidade',
      observacoes: 'Lead criado pelo teste da IA SDR.',
      created_by: guard.profile.id,
      data_entrada: now,
      sdr_id: guard.profile.id,
    }).select('id,nome,telefone').single();
    if (leadError) throw leadError;

    const payload = await uazapiFetch('/send/text', { method: 'POST', body: JSON.stringify({ number: phone, text: message, delay: 1200 }) }, { instanceName: uazapiInstanceName(sender.id) });
    return NextResponse.json({ ok: true, lead, message, sender: { id: sender.id, nome: sender.nome, telefone: sender.telefone }, provider: payload });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Nao foi possivel enviar o teste da IA.' }, { status: 502 });
  }
}
