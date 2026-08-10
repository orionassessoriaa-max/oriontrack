import { after, NextResponse } from 'next/server';
import { requireApiUser, rateLimit } from '@/lib/api/security';
import { canUseCreativeFolder } from '@/lib/creatives/access';
import { ensureCreativeStrategyFolder } from '@/lib/creatives/automation';
import { getDefaultCreativePrompt } from '@/lib/creatives/operatorPrompts';
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

    const savedStrategies: Array<{ id: string; operadora: string; regiao: string }> = [];
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
        savedStrategies.push({ id: current.id, operadora: entry.operadora, regiao: entry.regiao });
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
        savedStrategies.push(data);
      }
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
    });

    return NextResponse.json({
      success: true,
      saved: savedStrategies.length,
      removed: removedIds.length,
      message: 'Estratégias e prompts salvos. As pastas serão preparadas em segundo plano.',
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro ao salvar estratégia.' }, { status: 500 });
  }
}
