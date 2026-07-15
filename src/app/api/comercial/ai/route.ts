import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const leadId = String(body.lead_id || '');
  if (!leadId) return NextResponse.json({ error: 'Lead obrigatorio.' }, { status: 400 });

  let query = supabaseAdmin.from('comercial_leads').select('*').eq('id', leadId);
  if (guard.commercialRole === 'sdr') query = query.eq('sdr_id', guard.profile.id);
  if (guard.commercialRole === 'closer') query = query.eq('closer_id', guard.profile.id);
  const { data: lead } = await query.maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY nao configurada.' }, { status: 503 });
  const prompt = `Voce auxilia o time comercial da Orion. Escreva uma mensagem curta e natural de follow-up por WhatsApp, em portugues do Brasil, sem inventar informacoes e sem parecer um robô. Nao pressione o lead. Use no maximo 3 frases e termine com uma pergunta simples.\n\nLead: ${lead.nome}\nEmpresa: ${lead.empresa || 'nao informada'}\nEtapa: ${lead.status}\nOrigem: ${lead.origem || 'nao informada'}\nObservacoes: ${lead.observacoes || 'sem observacoes'}\nUltimo contato: ${lead.ultimo_contato_at || 'nao registrado'}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      temperature: 0.6,
      messages: [
        { role: 'system', content: 'Responda apenas com a mensagem final, sem aspas, titulos ou explicacoes.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: payload?.error?.message || 'Erro ao gerar follow-up.' }, { status: 502 });
  const message = String(payload?.choices?.[0]?.message?.content || '').trim();
  return NextResponse.json({ message });
}

