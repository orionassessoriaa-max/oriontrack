import { openaiFetch } from '@/lib/openaiUso';
import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit, writeAuditLog } from '@/lib/api/security';
import {
  beginCreativeGeneration,
  creativeRequestFingerprint,
  endCreativeGeneration,
  releaseOrionCredits,
  reserveOrionCredits,
  settleOrionCredits,
  updateCreditLedgerContext,
} from '@/lib/creatives/orionCred';

const ALLOWED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024']);
const ALLOWED_REFERENCE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseReference(dataUrl: string) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match || !ALLOWED_REFERENCE_TYPES.has(match[1])) {
    throw new Error('A referencia deve ser PNG, JPG ou WebP.');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw new Error('A imagem de referencia deve ter no maximo 10 MB.');
  }
  return { contentType: match[1], bytes };
}

function parseReferences(value: unknown) {
  const dataUrls = Array.isArray(value) ? value.slice(0, 2) : [];
  return dataUrls.map((dataUrl) => parseReference(String(dataUrl || ''))).filter(Boolean) as NonNullable<ReturnType<typeof parseReference>>[];
}

function buildCreativePrompt(userPrompt: string, referenceCount: number) {
  return `Crie um criativo publicitario profissional para redes sociais, com acabamento premium e leitura clara em tela de celular.

Briefing do gestor:
${userPrompt}

Regras:
- O resultado deve ser uma unica arte final pronta para anuncio, sem mockup, moldura de celular ou marcas d'agua.
- Use portugues do Brasil quando houver texto.
- Nao invente precos, coberturas, descontos, telefones, regulamentacoes ou beneficios que nao estejam no briefing.
- Priorize hierarquia visual, contraste, espaco de respiro e uma chamada principal curta.
- Revise cuidadosamente a ortografia de todo texto visivel.
${referenceCount ? `- Use as ${referenceCount} imagens anexadas como referencias visuais e de composicao. Combine somente os elementos que fizerem sentido no briefing e nao trate nenhuma referencia como a arte final.` : ''}`;
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;

  const limited = rateLimit(request, 'criativos:generate', {
    limit: 8,
    windowMs: 15 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const requestedGestorId = String(body.gestor_id || '').trim();
    const gestorId = guard.profile.tipo_usuario === 'gestor_trafego' ? guard.profile.id : requestedGestorId;
    const prompt = String(body.prompt || '').trim();
    const size = String(body.size || '1024x1024');
    const corretorId = String(body.corretor_id || '').trim() || null;
    const operadora = String(body.operadora || '').trim().slice(0, 120) || null;
    const regiao = String(body.regiao || '').trim().slice(0, 120) || null;
    const references = parseReferences(
      Array.isArray(body.reference_data_urls)
        ? body.reference_data_urls
        : body.reference_data_url ? [body.reference_data_url] : [],
    );

    if (prompt.length < 12 || prompt.length > 8000) {
      return NextResponse.json({ error: 'Descreva o criativo em 12 a 3.000 caracteres.' }, { status: 400 });
    }
    if (!ALLOWED_SIZES.has(size)) {
      return NextResponse.json({ error: 'Formato de criativo invalido.' }, { status: 400 });
    }
    if (body.confirmed_cost !== true) {
      return NextResponse.json({ error: 'Confirme o prompt final e o consumo de 1 Orion Cred antes de gerar.' }, { status: 409 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nao configurada no servidor.' }, { status: 503 });
    }
    if (!gestorId) {
      return NextResponse.json({ error: 'Selecione o gestor responsavel pelo Orion Cred.' }, { status: 400 });
    }

    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
    const creditReference = `geracao-direta:${crypto.randomUUID()}`;
    const fingerprint = creativeRequestFingerprint([gestorId, corretorId, operadora, regiao, size, prompt, references.length]);
    await beginCreativeGeneration(gestorId, creditReference, fingerprint);
    let creditReserved = false;
    let creditSettled = false;
    try {
      await reserveOrionCredits(gestorId, 1, creditReference);
      creditReserved = true;
      const fullPrompt = buildCreativePrompt(prompt, references.length);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150_000);
      let response: Response;

      try {
        if (references.length) {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', fullPrompt);
        form.append('size', size);
        form.append('quality', 'medium');
        form.append('output_format', 'png');
        references.forEach((reference, index) => {
          const extension = reference.contentType === 'image/jpeg' ? 'jpg' : reference.contentType.split('/')[1];
          form.append('image[]', new Blob([reference.bytes], { type: reference.contentType }), `referencia-${index + 1}.${extension}`);
        });
        response = await openaiFetch('criativo_avulso', 'https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: controller.signal,
        });
        } else {
          response = await openaiFetch('criativo_avulso', 'https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt: fullPrompt,
            size,
            quality: 'medium',
            output_format: 'png',
          }),
          signal: controller.signal,
          });
        }
      } finally {
        clearTimeout(timeout);
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        const moderationBlocked = payload.error?.code === 'moderation_blocked';
        return NextResponse.json({
          error: moderationBlocked
            ? 'O pedido foi bloqueado pela seguranca da geracao. Ajuste o prompt ou a referencia e tente novamente.'
            : payload.error?.message || 'A OpenAI nao conseguiu gerar este criativo.',
        }, { status: response.status >= 400 && response.status < 500 ? 400 : 502 });
      }

      const base64 = payload.data?.[0]?.b64_json;
      if (!base64) {
        return NextResponse.json({ error: 'A geracao terminou sem retornar uma imagem.' }, { status: 502 });
      }

      await settleOrionCredits(gestorId, 1, creditReference);
      creditSettled = true;
      await updateCreditLedgerContext(creditReference, {
        corretorId,
        operadora,
        regiao,
        prompt,
        resultado: 'imagem_final_gerada',
      });
      await writeAuditLog(request, guard.profile, {
        action: 'creative.ai.generate',
        entity_type: 'criativo_asset',
        metadata: { model, size, reference_count: references.length, gestor_id: gestorId },
      });

      return NextResponse.json({
        image_data_url: `data:image/png;base64,${base64}`,
        revised_prompt: payload.data?.[0]?.revised_prompt || null,
        model,
        size,
        credit_reference: creditReference,
        credits_used: 1,
      });
    } finally {
      if (creditReserved && !creditSettled) await releaseOrionCredits(gestorId, 1, creditReference).catch(() => null);
      await endCreativeGeneration(gestorId, creditReference).catch(() => null);
    }
  } catch (error: unknown) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'A geracao ultrapassou 2 minutos e 30 segundos. Tente novamente.'
      : errorMessage(error, 'Erro ao gerar o criativo.');
    const status = /Orion Cred|creditos/i.test(message) ? 402 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
