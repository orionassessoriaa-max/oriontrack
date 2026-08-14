import { after, NextResponse } from 'next/server';
import { requireApiUser, rateLimit } from '@/lib/api/security';
import { canUseCreativeFolder } from '@/lib/creatives/access';
import { processCreativeGenerationJob } from '@/lib/creatives/automation';
import { mergeCreativeBriefing } from '@/lib/creatives/operatorPrompts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  beginCreativeGeneration,
  creativeRequestFingerprint,
  endCreativeGeneration,
  releaseOrionCredits,
  reserveOrionCredits,
} from '@/lib/creatives/orionCred';

const ROLES = ['admin', 'gestor_trafego'] as const;

function clean(value: unknown, max = 120) {
  return String(value || '').trim().slice(0, max);
}

async function saveReference(profileId: string, dataUrl: string) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) throw new Error('A referencia deve ser PNG, JPG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.byteLength > 10 * 1024 * 1024) throw new Error('A referencia deve ter no maximo 10 MB.');
  const bucket = 'trafego-draft-creatives';
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (!buckets?.some((item) => item.name === bucket)) {
    await supabaseAdmin.storage.createBucket(bucket, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
  }
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
  const path = `${profileId}/referencias/${Date.now()}.${extension}`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, bytes, { contentType: match[1], upsert: false });
  if (error) throw error;
  return supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function serializeReferenceUrls(urls: string[]) {
  if (urls.length === 0) return null;
  return urls.length === 1 ? urls[0] : JSON.stringify(urls);
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...ROLES]);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const gestorId = guard.profile.tipo_usuario === 'admin'
    ? clean(url.searchParams.get('gestor_id'), 80) || guard.profile.id
    : guard.profile.id;
  const { data, error } = await supabaseAdmin
    .from('criativo_generation_jobs')
    .select('id, corretor_id, gestor_id, operadora, regiao, quantidade, origem, status, progresso, erro, created_at, finished_at')
    .eq('gestor_id', gestorId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const jobs = data || [];
  const corretorIds = [...new Set(jobs.map((job) => job.corretor_id))];
  const { data: corretores, error: corretoresError } = corretorIds.length
    ? await supabaseAdmin
      .from('corretores')
      .select('id, nome, nome_empresa')
      .in('id', corretorIds)
    : { data: [], error: null };
  if (corretoresError) return NextResponse.json({ error: corretoresError.message }, { status: 500 });
  const queuedJobs = jobs.filter((job) => job.status === 'na_fila').slice(0, 5);
  if (queuedJobs.length) {
    after(async () => {
      for (const job of queuedJobs) {
        await processCreativeGenerationJob(job.id);
      }
    });
  }
  const concessionariaById = new Map(
    (corretores || []).map((corretor) => [
      corretor.id,
      String(corretor.nome_empresa || corretor.nome || 'Concessionaria').trim(),
    ])
  );
  return NextResponse.json({
    jobs: jobs.map((job) => ({
      ...job,
      concessionaria: concessionariaById.get(job.corretor_id) || 'Concessionaria',
    })),
  });
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, [...ROLES]);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'criativos:jobs:create', {
    limit: 30,
    windowMs: 15 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;
  try {
    const body = await request.json().catch(() => ({}));
    const corretorId = clean(body.corretor_id, 80);
    const requestedGestorId = clean(body.gestor_id, 80) || null;
    const gestorId = guard.profile.tipo_usuario === 'admin' && requestedGestorId
      ? requestedGestorId
      : guard.profile.id;
    const operadora = clean(body.operadora);
    const regiao = clean(body.regiao);
    const quantidade = Math.min(Math.max(Number(body.quantidade) || 2, 1), 2);
    if (!corretorId || !operadora || !regiao) {
      return NextResponse.json({ error: 'Informe concessionaria, operadora e regiao.' }, { status: 400 });
    }
    if (body.confirmed_cost !== true) {
      return NextResponse.json({ error: `Confirme o prompt final e o consumo de ${quantidade} Orion Cred antes de gerar.` }, { status: 409 });
    }
    if (!(await canUseCreativeFolder(guard.profile, corretorId, requestedGestorId))) {
      return NextResponse.json({ error: 'Concessionaria fora do escopo deste gestor.' }, { status: 403 });
    }
    const { data: strategy, error: strategyError } = await supabaseAdmin
      .from('trafego_estrategias_criativos')
      .select('id, creative_prompt')
      .eq('corretor_id', corretorId)
      .eq('operadora', operadora)
      .eq('regiao', regiao)
      .eq('ativa', true)
      .maybeSingle();
    if (strategyError) throw strategyError;
    const briefing = mergeCreativeBriefing(
      operadora,
      strategy?.creative_prompt,
      clean(body.briefing, 8000),
    );
    const directReferenceUrls = (Array.isArray(body.referencia_urls) ? body.referencia_urls : [body.referencia_url])
      .map((value: unknown) => clean(value, 1000))
      .filter(Boolean)
      .slice(0, 2);
    const referenceDataUrls = (Array.isArray(body.reference_data_urls)
      ? body.reference_data_urls
      : body.reference_data_url ? [body.reference_data_url] : [])
      .map((value: unknown) => clean(value, 15_000_000))
      .filter(Boolean)
      .slice(0, 2 - directReferenceUrls.length);
    const uploadedReferenceUrls = await Promise.all(
      referenceDataUrls.map((dataUrl: string) => saveReference(guard.profile.id, dataUrl)),
    );
    const referenceUrl = serializeReferenceUrls([
      ...directReferenceUrls,
      ...uploadedReferenceUrls.filter((url): url is string => Boolean(url)),
    ]);
    const jobId = crypto.randomUUID();
    const jobReference = `lote:${jobId}`;
    const fingerprint = creativeRequestFingerprint([
      gestorId, corretorId, operadora, regiao, quantidade, briefing, referenceUrl,
    ]);
    await beginCreativeGeneration(gestorId, jobReference, fingerprint);
    let reserved = false;
    let job;
    try {
      await reserveOrionCredits(gestorId, quantidade, jobReference);
      reserved = true;
      const result = await supabaseAdmin
        .from('criativo_generation_jobs')
        .insert({
          id: jobId,
          corretor_id: corretorId,
          gestor_id: gestorId,
          estrategia_id: body.estrategia_id || strategy?.id || null,
          recommendation_id: body.recommendation_id || null,
          operadora,
          regiao,
          quantidade,
          briefing,
          referencia_url: referenceUrl,
          origem: ['entrada', 'criativos', 'apolo', 'troca_criativo'].includes(body.origem) ? body.origem : 'criativos',
          status: 'na_fila',
          solicitado_por_profile_id: guard.profile.id,
        })
        .select('id, status, operadora, regiao, quantidade')
        .single();
      if (result.error) throw result.error;
      job = result.data;
    } catch (error) {
      if (reserved) await releaseOrionCredits(gestorId, quantidade, jobReference).catch(() => null);
      await endCreativeGeneration(gestorId, jobReference).catch(() => null);
      throw error;
    }
    after(() => processCreativeGenerationJob(job.id));
    return NextResponse.json({
      success: true,
      job,
      message: `${quantidade} criativos de ${operadora}/${regiao} entraram na fila. Voce pode continuar trabalhando.`,
    }, { status: 202 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao criar lote.';
    return NextResponse.json({ error: message }, { status: /Orion Cred|creditos/i.test(message) ? 402 : 500 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireApiUser(request, [...ROLES]);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'criativos:jobs:cancel', {
    limit: 30,
    windowMs: 5 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const jobIds = Array.isArray(body.job_ids)
      ? body.job_ids.map((id: unknown) => clean(id, 80)).filter(Boolean).slice(0, 30)
      : [];
    if (jobIds.length === 0) {
      return NextResponse.json({ error: 'Nenhum lote em andamento foi informado.' }, { status: 400 });
    }

    const requestedGestorId = clean(body.gestor_id, 80) || null;
    const gestorId = guard.profile.tipo_usuario === 'admin' && requestedGestorId
      ? requestedGestorId
      : guard.profile.id;
    const finishedAt = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('criativo_generation_jobs')
      .update({
        status: 'cancelado',
        erro: null,
        finished_at: finishedAt,
        updated_at: finishedAt,
      })
      .in('id', jobIds)
      .eq('gestor_id', gestorId)
      .in('status', ['na_fila', 'gerando'])
      .select('id, gestor_id, quantidade, progresso');
    if (error) throw error;
    await Promise.all((data || []).map((job) => releaseOrionCredits(
      job.gestor_id,
      Math.max(Number(job.quantidade || 0) - Number(job.progresso || 0), 0),
      `lote:${job.id}`,
    ).catch(() => null)));
    await Promise.all((data || []).map((job) => endCreativeGeneration(
      job.gestor_id,
      `lote:${job.id}`,
    ).catch(() => null)));

    return NextResponse.json({
      success: true,
      canceled: data?.length || 0,
      message: `${data?.length || 0} lote(s) cancelado(s). Os criativos já concluídos foram mantidos.`,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro ao cancelar os lotes.' }, { status: 500 });
  }
}
