import { after, NextResponse } from 'next/server';
import { requireApiUser, rateLimit } from '@/lib/api/security';
import { canUseCreativeFolder } from '@/lib/creatives/access';
import { processCreativeGenerationJob } from '@/lib/creatives/automation';
import { supabaseAdmin } from '@/lib/supabase/admin';

function clean(value: unknown, max = 120) {
  return String(value || '').trim().slice(0, max);
}

type StrategyEntry = { operadora: string; regiao: string };

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const corretorId = clean(url.searchParams.get('corretor_id'), 80);
  const requestedGestorId = clean(url.searchParams.get('gestor_id'), 80) || null;
  if (!corretorId) return NextResponse.json({ estrategias: [] });
  if (!(await canUseCreativeFolder(guard.profile, corretorId, requestedGestorId))) {
    return NextResponse.json({ error: 'Concessionaria fora do escopo deste gestor.' }, { status: 403 });
  }
  const { data, error } = await supabaseAdmin
    .from('trafego_estrategias_criativos')
    .select('id, corretor_id, gestor_id, operadora, regiao, ativa, created_at')
    .eq('corretor_id', corretorId)
    .eq('ativa', true)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ estrategias: data || [] });
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
      .map((item: Record<string, unknown>) => ({
        operadora: clean(item.operadora),
        regiao: clean(item.regiao),
      }))
      .filter((item: { operadora: string; regiao: string }) => item.operadora && item.regiao);
    const uniqueEntries: StrategyEntry[] = [];
    const seenEntries = new Set<string>();
    for (const item of entries as StrategyEntry[]) {
      const key = `${item.operadora.toLocaleLowerCase('pt-BR')}|${item.regiao.toLocaleLowerCase('pt-BR')}`;
      if (!seenEntries.has(key)) {
        seenEntries.add(key);
        uniqueEntries.push(item);
      }
    }
    if (!corretorId || !entries.length) {
      return NextResponse.json({ error: 'Adicione pelo menos uma operadora com regiao.' }, { status: 400 });
    }
    if (!(await canUseCreativeFolder(guard.profile, corretorId, requestedGestorId))) {
      return NextResponse.json({ error: 'Concessionaria fora do escopo deste gestor.' }, { status: 403 });
    }
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('trafego_estrategias_criativos')
      .select('id, operadora, regiao, ativa')
      .eq('corretor_id', corretorId);
    if (existingError) throw existingError;
    const keyOf = (item: { operadora: string; regiao: string }) =>
      `${item.operadora.toLocaleLowerCase('pt-BR')}|${item.regiao.toLocaleLowerCase('pt-BR')}`;
    const requestedKeys = new Set(uniqueEntries.map(keyOf));
    const existingByKey = new Map((existing || []).map((item) => [keyOf(item), item]));
    const removedIds = (existing || []).filter((item) => item.ativa && !requestedKeys.has(keyOf(item))).map((item) => item.id);
    if (removedIds.length) {
      const { error: deactivateError } = await supabaseAdmin
        .from('trafego_estrategias_criativos')
        .update({ ativa: false, updated_at: new Date().toISOString() })
        .in('id', removedIds);
      if (deactivateError) throw deactivateError;
    }
    const entriesToGenerate = uniqueEntries.filter((item) => {
      const current = existingByKey.get(keyOf(item));
      return !current || !current.ativa;
    });
    const reactivatedIds = entriesToGenerate
      .map((item) => existingByKey.get(keyOf(item)))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => item.id);
    if (reactivatedIds.length) {
      const { error: reactivateError } = await supabaseAdmin
        .from('trafego_estrategias_criativos')
        .update({ ativa: true, gestor_id: gestorId, updated_at: new Date().toISOString() })
        .in('id', reactivatedIds);
      if (reactivateError) throw reactivateError;
    }
    const newEntries = entriesToGenerate.filter((item) => !existingByKey.has(keyOf(item)));
    let insertedStrategies: Array<{ id: string; operadora: string; regiao: string }> = [];
    if (newEntries.length) {
      const { data, error: strategyError } = await supabaseAdmin
        .from('trafego_estrategias_criativos')
        .insert(newEntries.map((item) => ({
          corretor_id: corretorId,
          gestor_id: gestorId,
          operadora: item.operadora,
          regiao: item.regiao,
        })))
        .select('id, operadora, regiao');
      if (strategyError) throw strategyError;
      insertedStrategies = data || [];
    }
    const reactivatedStrategies = (existing || [])
      .filter((item) => reactivatedIds.includes(item.id))
      .map(({ id, operadora, regiao }) => ({ id, operadora, regiao }));
    const strategies = [...insertedStrategies, ...reactivatedStrategies];
    if (!strategies.length) {
      return NextResponse.json({ success: true, created: 0, removed: removedIds.length, jobs: [], message: 'Estrategia atualizada sem novas combinacoes.' });
    }
    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from('criativo_generation_jobs')
      .insert((strategies || []).map((strategy) => ({
        corretor_id: corretorId,
        gestor_id: gestorId,
        estrategia_id: strategy.id,
        operadora: strategy.operadora,
        regiao: strategy.regiao,
        quantidade: 4,
        briefing: clean(body.briefing, 4000) || null,
        origem: 'entrada',
        status: 'na_fila',
        solicitado_por_profile_id: guard.profile.id,
      })))
      .select('id, operadora, regiao, quantidade, status');
    if (jobsError) throw jobsError;
    after(async () => {
      for (const job of jobs || []) await processCreativeGenerationJob(job.id);
    });
    return NextResponse.json({
      success: true,
      created: strategies.length,
      removed: removedIds.length,
      jobs: jobs || [],
      message: `${strategies.length} combinacao(oes) salva(s). Os criativos estao sendo gerados em segundo plano.`,
    }, { status: 202 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro ao salvar estrategia.' }, { status: 500 });
  }
}
