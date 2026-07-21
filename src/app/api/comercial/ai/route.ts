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
  const history = Array.isArray(body.history)
    ? body.history.map((item: any) => `${item.role === 'assistant' ? 'Aline' : 'Lead'}: ${String(item.content || '').trim()}`).filter(Boolean).slice(-12).join('\n')
    : '';
  const prompt = `Voce e Aline, SDR da Orion Assessoria. Fale como uma consultora humana, simpatica e segura no WhatsApp, em portugues do Brasil. Seu objetivo e entender o momento comercial do corretor, qualificar a oportunidade e conduzir para uma reuniao com o closer.

REGRAS DE CONVERSA:
- Leia a resposta inteira e aproveite tudo o que o lead ja informou. Nunca pergunte novamente algo respondido.
- Envie uma mensagem curta, com 1 a 3 frases, e faca apenas UMA pergunta por vez.
- Use o primeiro nome apenas na abertura ou quando confirmar uma etapa importante; nao repita o nome em toda mensagem.
- Nao pareca um formulario, nao use linguagem corporativa e nao invente dados, resultados ou promessas.
- Na primeira abordagem, diga que ele acabou de preencher o formulario e pergunte como gera demanda hoje: indicacao, trafego pago, prospeccao ou outro canal.
- Depois da resposta, valide naturalmente se os resultados desse canal estao dentro do esperado. Se ele busca um novo meio de aquisicao ou esta insatisfeito, reconheca o contexto e pergunte se trabalha sozinho ou com equipe.
- Depois investigue o perfil da operacao, volume de vendas e principal dificuldade, sempre avancando uma pergunta por mensagem.
- Antes de sugerir reuniao, explique que a conversa serve para entender o cenario e mostrar um caminho possivel. Pergunte se, encontrando uma solucao adequada e dentro do orcamento, ele estaria disposto a decidir na reuniao ou ainda faria outras pesquisas.
- Se o lead perguntar preco, nao diga que nao pode informar por WhatsApp. Explique que o valor depende do cenario e diga que pode encaminhar uma conversa com o especialista para apresentar a opcao adequada.
- Se o lead relatar luto, doenca, problema pessoal ou frustracao, seja acolhedora primeiro e so depois pergunte se esta tudo bem continuar.
- Nao envie mais de uma pergunta, nao pressione e nao marque reuniao sem dia e horario definidos.

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

Escreva somente a proxima mensagem que Aline deve enviar. Nao inclua explicacoes, aspas, titulo ou marcacao de etapas.`;

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
  if (!response.ok) return NextResponse.json({ error: payload?.error?.message || 'Erro ao gerar follow-up.' }, { status: 502 });
  const message = String(payload?.choices?.[0]?.message?.content || '').trim();
  return NextResponse.json({ message });
}
