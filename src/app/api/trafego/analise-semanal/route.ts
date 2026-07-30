import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit, writeAuditLog } from '@/lib/api/security';
import { concessionariaKey, groupConcessionarias } from '@/lib/concessionariaBoard';
import { supabaseAdmin } from '@/lib/supabase/admin';

const STATUS = ['boa', 'atencao', 'ruim'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: unknown, max = 100) {
  return String(value || '').trim().slice(0, max);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

async function resolveGestorId(profile: { id: string; tipo_usuario: string }, requested?: string | null) {
  if (profile.tipo_usuario === 'gestor_trafego') return profile.id;
  const gestorId = clean(requested, 80);
  if (!gestorId) return null;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', gestorId)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();
  return data?.id || null;
}

async function gestorConcessionarias(gestorId: string) {
  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, gestor_trafego_id, status')
    .eq('gestor_trafego_id', gestorId)
    .in('status', ['active', 'ativo', 'Ativo'])
    .order('nome_empresa', { ascending: true });
  if (error) throw error;
  return groupConcessionarias(data || []);
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  try {
    const url = new URL(request.url);
    const weekStart = clean(url.searchParams.get('week_start'), 10);
    if (!DATE_RE.test(weekStart)) {
      return NextResponse.json({ error: 'Inicio da semana invalido.' }, { status: 400 });
    }
    const gestorId = await resolveGestorId(guard.profile, url.searchParams.get('gestor_id'));
    if (!gestorId) return NextResponse.json({ error: 'Gestor nao identificado.' }, { status: 400 });
    const concessionarias = await gestorConcessionarias(gestorId);
    const weekEnd = addDays(weekStart, 4);
    const { data, error } = await supabaseAdmin
      .from('gestor_analise_semanal')
      .select('id, concessionaria_key, concessionaria_nome, data, status, updated_at')
      .eq('gestor_id', gestorId)
      .gte('data', weekStart)
      .lte('data', weekEnd);
    if (error) throw error;
    return NextResponse.json({ concessionarias, analyses: data || [], gestor_id: gestorId });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao carregar analise semanal.',
    }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'trafego:analise-semanal', {
    limit: 300,
    windowMs: 10 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;
  try {
    const body = await request.json().catch(() => ({}));
    const gestorId = await resolveGestorId(guard.profile, body.gestor_id);
    const nome = clean(body.concessionaria_nome, 180);
    const key = concessionariaKey(body.concessionaria_key || nome);
    const data = clean(body.data, 10);
    const status = clean(body.status, 20);
    if (!gestorId || !key || !nome || !DATE_RE.test(data) || (status && !STATUS.includes(status as (typeof STATUS)[number]))) {
      return NextResponse.json({ error: 'Analise invalida.' }, { status: 400 });
    }
    const concessionarias = await gestorConcessionarias(gestorId);
    if (!concessionarias.some((item) => item.key === key)) {
      return NextResponse.json({ error: 'Concessionaria fora da carteira deste gestor.' }, { status: 403 });
    }
    if (!status) {
      const { error } = await supabaseAdmin
        .from('gestor_analise_semanal')
        .delete()
        .eq('gestor_id', gestorId)
        .eq('concessionaria_key', key)
        .eq('data', data);
      if (error) throw error;
      await writeAuditLog(request, guard.profile, {
        action: 'traffic.weekly_analysis.clear',
        entity_type: 'concessionaria',
        entity_id: key,
        metadata: { gestor_id: gestorId, data },
      });
      return NextResponse.json({ success: true, analysis: null });
    }
    const now = new Date().toISOString();
    const { data: saved, error } = await supabaseAdmin
      .from('gestor_analise_semanal')
      .upsert({
        gestor_id: gestorId,
        concessionaria_key: key,
        concessionaria_nome: nome,
        data,
        status,
        updated_at: now,
      }, { onConflict: 'gestor_id,concessionaria_key,data' })
      .select('id, concessionaria_key, data, status, updated_at')
      .single();
    if (error) throw error;
    await writeAuditLog(request, guard.profile, {
      action: 'traffic.weekly_analysis.update',
      entity_type: 'concessionaria',
      entity_id: key,
      metadata: { gestor_id: gestorId, data, status },
    });
    return NextResponse.json({ success: true, analysis: saved });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao salvar analise semanal.',
    }, { status: 500 });
  }
}
