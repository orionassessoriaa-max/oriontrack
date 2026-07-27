import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const leadId = String(body.lead_id || '');
  if (!leadId) return NextResponse.json({ error: 'Lead obrigatorio.' }, { status: 400 });

  const query = supabaseAdmin.from('comercial_leads').select('*').eq('id', leadId);
  const { data: lead } = await query.maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });

  const { data: config } = await supabaseAdmin.from('comercial_config').select('ia_sdr_ativa,ia_sdr_prompt').eq('id', 1).maybeSingle();
  if (config?.ia_sdr_ativa === false) return NextResponse.json({ error: 'A IA SDR esta desativada para esta operacao.' }, { status: 409 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY nao configurada.' }, { status: 503 });
  const history = Array.isArray(body.history)
    ? body.history.map((item: any) => `${item.role === 'assistant' ? 'Aline' : 'Lead'}: ${String(item.content || '').trim()}`).filter(Boolean).slice(-12).join('\n')
    : '';
  const systemPrompt = String(config?.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT);
  const prompt = `${systemPrompt}

DADOS DO LEAD:
Nome: ${lead.nome}
Empresa: ${lead.empresa || 'nao informada'}
Estado: ${lead.estado || 'nao informado'}
Etapa atual: ${lead.status}
Origem: ${lead.origem || 'nao informada'}
Observacoes: ${lead.observacoes || 'sem observacoes'}
Ultimo contato: ${lead.ultimo_contato_at || 'nao registrado'}

HISTORICO RECENTE:
${history || 'Ainda nao informado.'}

Escreva somente a proxima mensagem para este lead.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      temperature: 0.65,
      messages: [
        { role: 'system', content: 'Responda apenas com a mensagem final, sem aspas, titulos ou explicacoes.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: payload?.error?.message || 'Erro ao gerar mensagem da IA.' }, { status: 502 });
  const message = String(payload?.choices?.[0]?.message?.content || '').trim();
  return NextResponse.json({ message });
}
