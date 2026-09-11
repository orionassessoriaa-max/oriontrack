import { after, NextResponse } from 'next/server';
import { requireApiUser, rateLimit } from '@/lib/api/security';
import { canUseCreativeFolder } from '@/lib/creatives/access';
import { ensureCreativeStrategyFolder, processCreativeGenerationJob } from '@/lib/creatives/automation';
import { getDefaultCreativePrompt, mergeCreativeBriefing } from '@/lib/creatives/operatorPrompts';
import {
  beginCreativeGeneration,
  creativeRequestFingerprint,
  endCreativeGeneration,
  releaseOrionCredits,
  reserveOrionCredits,
} from '@/lib/creatives/orionCred';
import { supabaseAdmin } from '@/lib/supabase/admin';

function clean(value: unknown, max = 120) {
  return String(value || '').trim().slice(0, max);
}

type StrategyEntry = { operadora: string; regiao: string; creative_prompt: string };
type StoredStrategy = StrategyEntry & { id: string; ativa: boolean };

function keyOf(item: Pick<StrategyEntry, 'operadora' | 'regiao'>) {
  return `${item.operadora.toLocaleLowerCase('pt-BR')}|${item.regiao.toLocaleLowerCase('pt-BR')}`;
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const corretorId = clean(url.searchParams.get('corretor_id'), 80);
  const requestedGestorId = clean(url.searchParams.get('gestor_id'), 80) || null;
  if (!corretorId) return NextResponse.json({ estrategias: [] });
  if (!(await canUseCreativeFolder(guard.profile, corretorId, requestedGestorId))) {
    return NextResponse.json({ error: 'Concessionária fora do escopo deste gestor.' }, { status: 403 });
  }
  const { data, error } = await supabaseAdmin
    .from('trafego_estrategias_criativos')
    .select('id, corretor_id, gestor_id, operadora, regiao, creative_prompt, ativa, created_at')
    .eq('corretor_id', corretorId)
    .eq('ativa', true)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    estrategias: (data || []).map((item) => ({
      ...item,
      creative_prompt: item.creative_prompt || getDefaultCreativePrompt(item.operadora),
    })),
  });
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'trafego:estrategias:save', {
    limit: 20,
    windowMs: 10 * 60_000,
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
    const entries = (Array.isArray(body.estrategias) ? body.estrategias : [])
      .map((item: Record<string, unknown>) => {
        const operadora = clean(item.operadora);
        return {
          operadora,
          regiao: clean(item.regiao),
          creative_prompt: clean(item.creative_prompt, 8000) || getDefaultCreativePrompt(operadora),
        };
      })
      .filter((item: StrategyEntry) => item.operadora && item.regiao);

    const uniqueEntries: StrategyEntry[] = [];
    const seenEntries = new Set<string>();
    for (const item of entries as StrategyEntry[]) {
      const key = keyOf(item);
      if (!seenEntries.has(key)) {
        seenEntries.add(key);
        uniqueEntries.push(item);
      }
    }
    if (!corretorId || !uniqueEntries.length) {
      return NextResponse.json({ error: 'Adicione pelo menos uma operadora com região.' }, { status: 400 });
    }
    if (!(await canUseCreativeFolder(guard.profile, corretorId, requestedGestorId))) {
      return NextResponse.json({ error: 'Concessionária fora do escopo deste gestor.' }, { status: 403 });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('trafego_estrategias_criativos')
      .select('id, operadora, regiao, creative_prompt, ativa')
      .eq('corretor_id', corretorId);
    if (existingError) throw existingError;

    const requestedKeys = new Set(uniqueEntries.map(keyOf));
    const existingByKey = new Map((existing || []).map((item) => [keyOf(item), item as StoredStrategy]));
    const removedIds = (existing || [])
      .filter((item) => item.ativa && !requestedKeys.has(keyOf(item)))
      .map((item) => item.id);
    if (removedIds.length) {
      const { error } = await supabaseAdmin
        .from('trafego_estrategias_criativos')
        .update({ ativa: false, updated_at: new Date().toISOString() })
        .in('id', removedIds);
      if (error) throw error;
    }

    const savedStrategies: Array<{ id: string; operadora: string; regiao: string; creative_prompt: string }> = [];
    for (const entry of uniqueEntries) {
      const current = existingByKey.get(keyOf(entry));
      if (current) {
        const { error } = await supabaseAdmin
          .from('trafego_estrategias_criativos')
          .update({
            ativa: true,
            gestor_id: gestorId,
            creative_prompt: entry.creative_prompt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', current.id);
        if (error) throw error;
        savedStrategies.push({
          id: current.id,
          operadora: entry.operadora,
          regiao: entry.regiao,
          creative_prompt: entry.creative_prompt,
        });
      } else {
        const { data, error } = await supabaseAdmin
          .from('trafego_estrategias_criativos')
          .insert({
            corretor_id: corretorId,
            gestor_id: gestorId,
            operadora: entry.operadora,
            regiao: entry.regiao,
            creative_prompt: entry.creative_prompt,
          })
          .select('id, operadora, regiao')
          .single();
        if (error) throw error;
        savedStrategies.push({ ...data, creative_prompt: entry.creative_prompt });
      }
    }

    const strategyIds = savedStrategies.map((strategy) => strategy.id);
    const { data: existingJobs, error: existingJobsError } = await supabaseAdmin
      .from('criativo_generation_jobs')
      .select('estrategia_id')
      .in('estrategia_id', strategyIds)
      .in('status', ['na_fila', 'gerando', 'pronto']);
    if (existingJobsError) throw existingJobsError;

    const strategiesWithJobs = new Set((existingJobs || []).map((job) => job.estrategia_id));

    /**
     * Reserva o credito ANTES de enfileirar, com o id do job ja definido aqui
     * para a referencia bater com o `lote:<id>` que o settle usa.
     *
     * Sem isso a imagem era gerada, a OpenAI cobrava, e o consumo estourava na
     * RPC por falta de reserva: o job morria como "falhou" e o gasto nunca
     * subia. Pior, o estorno do catch nao confere a referencia, entao esse job
     * fantasma podia devolver a reserva de um lote legitimo rodando ao lado.
     */
    const QUANTIDADE_POR_LOTE = 4;
    const generationRows: Record<string, unknown>[] = [];
    const reservados: Array<{ referencia: string }> = [];
    const semCredito: string[] = [];

    for (const strategy of savedStrategies) {
      if (strategiesWithJobs.has(strategy.id)) continue;
      const jobId = crypto.randomUUID();
      const referencia = `lote:${jobId}`;
      const briefing = mergeCreativeBriefing(strategy.operadora, strategy.creative_prompt, '');
      try {
        await beginCreativeGeneration(gestorId, referencia, creativeRequestFingerprint([
          gestorId, corretorId, strategy.operadora, strategy.regiao, QUANTIDADE_POR_LOTE, briefing, null,
        ]));
        await reserveOrionCredits(gestorId, QUANTIDADE_POR_LOTE, referencia);
      } catch {
        // Sem saldo ou lote repetido: a estrategia continua salva, so nao gera.
        await endCreativeGeneration(gestorId, referencia).catch(() => null);
        semCredito.push(`${strategy.operadora}/${strategy.regiao}`);
        continue;
      }
      reservados.push({ referencia });
      generationRows.push({
        id: jobId,
        corretor_id: corretorId,
        gestor_id: gestorId,
        estrategia_id: strategy.id,
        recommendation_id: null,
        operadora: strategy.operadora,
        regiao: strategy.regiao,
        quantidade: QUANTIDADE_POR_LOTE,
        briefing,
        referencia_url: null,
        origem: 'entrada',
        status: 'na_fila',
        solicitado_por_profile_id: guard.profile.id,
      });
    }

    const { data: generationJobs, error: generationError } = generationRows.length
      ? await supabaseAdmin
        .from('criativo_generation_jobs')
        .insert(generationRows)
        .select('id')
      : { data: [], error: null };
    if (generationError) {
      // O insert e em lote: se ele falha, nenhum job existe e toda reserva volta.
      for (const item of reservados) {
        await releaseOrionCredits(gestorId, QUANTIDADE_POR_LOTE, item.referencia).catch(() => null);
        await endCreativeGeneration(gestorId, item.referencia).catch(() => null);
      }
      throw generationError;
    }

    after(async () => {
      for (const strategy of savedStrategies) {
        await ensureCreativeStrategyFolder({
          strategyId: strategy.id,
          corretorId,
          gestorId,
          operadora: strategy.operadora,
          regiao: strategy.regiao,
        }).catch((error) => console.error('Erro ao preparar pasta de criativos:', error));
      }
      for (const job of generationJobs || []) {
        await processCreativeGenerationJob(job.id);
      }
    });

    return NextResponse.json({
      success: true,
      saved: savedStrategies.length,
      removed: removedIds.length,
      generation_started: generationJobs?.length || 0,
      sem_credito: semCredito,
      message: generationJobs?.length
        ? `${generationJobs.length} lote(s) de criativos entraram na fila. As imagens serao geradas em segundo plano.`
          + (semCredito.length ? ` ${semCredito.length} lote(s) ficaram de fora por falta de credito: ${semCredito.join(', ')}.` : '')
        : semCredito.length
          ? `Estrategias salvas, mas nenhum criativo entrou na fila por falta de credito: ${semCredito.join(', ')}.`
          : 'Estrategias salvas. Os criativos existentes foram preservados sem duplicacao.',
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro ao salvar estratégia.' }, { status: 500 });
  }
}
