import { openaiFetch } from '@/lib/openaiUso';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { fileContent, fileName } = await request.json();
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'A chave de API da OpenAI não está configurada nas variáveis de ambiente do servidor.' },
        { status: 500 }
      );
    }

    const prompt = `Você é o Apolo AI, o assistente inteligente oficial de processamento de tabelas de saúde da Orion Track.
Analise o seguinte conteúdo textual extraído de um arquivo oficial de preços de operadora de saúde.
Nome do Arquivo: "${fileName}"

Seu objetivo é ler e estruturar esses dados de forma semântica. Extraia os seguintes detalhes e retorne APENAS um objeto JSON válido (sem markdown, sem blocos de código \`\`\`, apenas o texto JSON bruto):

{
  "operadora": "Nome da Operadora (Amil, Bradesco, SulAmérica, Porto Seguro, Unimed, etc.)",
  "plano": "Nome específico do plano (ex: S380, S450, Top Nacional Flex, Especial 100, Ouro, etc.)",
  "tipo": "PF" ou "PME" (se for pessoa física ou empresarial, deduzido do texto)",
  "coparticipacao": "Sim" ou "Não" (se possuir regras de coparticipação)",
  "reembolso": "Valor do reembolso (ex: 'R$ 120,00') ou 'Sem reembolso'",
  "hospitais": ["Hospital 1", "Hospital 2", "Hospital 3"] (extraia os principais hospitais citados ou preencha com exemplos padrão se não citados),
  "precos": [preco_0_18, preco_19_23, preco_24_28, preco_29_33, preco_34_38, preco_39_43, preco_44_48, preco_49_53, preco_54_58, preco_59_mais]
}

REGRAS CRÍTICAS:
1. Os preços na lista "precos" devem ter EXATAMENTE 10 valores numéricos correspondentes a cada uma das faixas etárias da ANS, nesta ordem:
   - 0 a 18 anos
   - 19 a 23 anos
   - 24 a 28 anos
   - 29 a 33 anos
   - 34 a 38 anos
   - 39 a 43 anos
   - 44 a 48 anos
   - 49 a 53 anos
   - 54 a 58 anos
   - 59 anos ou mais
2. Se os valores numéricos dos preços contiverem pontos ou vírgulas (ex: 250,50 ou 1.200,00), converta-os para números inteiros ou flutuantes válidos em JavaScript (ex: 250.50 ou 1200).
3. Se não conseguir identificar claramente os preços das faixas etárias no texto, retorne um erro ou preencha com valores aproximados baseados em tabelas de mercado padrões daquela operadora.
4. Identifique o nome da operadora de forma inteligente pelo nome do arquivo ou conteúdo do texto.
5. Retorne ESTREITAMENTE o JSON bruto.

Conteúdo Textual do Arquivo:
---
${fileContent.slice(0, 15000)}
---`;

    const response = await openaiFetch('simulador_tabela', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é um extrator de tabelas JSON estruturado.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errPayload = await response.json();
      console.error('Erro na OpenAI ao fazer parsing de arquivo:', errPayload);
      return NextResponse.json(
        { error: `Erro na OpenAI: ${errPayload.error?.message || response.statusText}` },
        { status: response.status }
      );
    }

    const resData = await response.json();
    const rawReply = resData.choices?.[0]?.message?.content || '{}';
    
    // Limpar possíveis markdown wrappers que o modelo possa ter inserido
    let cleanJsonStr = rawReply.trim();
    if (cleanJsonStr.startsWith('```')) {
      cleanJsonStr = cleanJsonStr.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsedData = JSON.parse(cleanJsonStr);
    return NextResponse.json({ data: parsedData });
  } catch (err: any) {
    console.error('Erro na rota de parsing de arquivo do Apolo:', err);
    return NextResponse.json({ error: 'Erro ao processar e extrair dados do arquivo com o Apolo AI.' }, { status: 500 });
  }
}
