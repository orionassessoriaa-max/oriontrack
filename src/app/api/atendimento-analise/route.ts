import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit, writeAuditLog } from '@/lib/api/security';
import { groupConcessionarias } from '@/lib/concessionariaBoard';
import { supabaseAdmin } from '@/lib/supabase/admin';

const ROLES = ['admin', 'gestor_trafego', 'account_manager', 'designer'] as const;
const ETAPAS = ['entrada', 'safe', 'atencao', 'risco', 'aviso', 'stand_by', 'suspenso'] as const;

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...ROLES]);
  if ('error' in guard) return guard.error;
  try {
    const [{ data: corretores, error: corretoresError }, { data: saved, error: savedError }] = await Promise.all([
      supabaseAdmin
        .from('corretores')
        .select('id, nome, nome_empresa, status')
        .order('nome_empresa', { ascending: true }),
      supabaseAdmin
        .from('atendimento_analise_status')
        .select('concessionaria_key, etapa, updated_at'),
    ]);
    if (corretoresError) throw corretoresError;
    if (savedError) throw savedError;
    const statusMap = new Map((saved || []).map((item) => [item.concessionaria_key, item]));
    const concessionarias = groupConcessionarias(corretores || []).map((item) => ({
      ...item,
      etapa: statusMap.get(item.key)?.etapa || 'entrada',
      updated_at: statusMap.get(item.key)?.updated_at || null,
    }));
    return NextResponse.json({
      concessionarias,
      can_move: guard.profile.tipo_usuario === 'admin',
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao carregar temperatura.',
    }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = await requireApiUser(request, ['admin']);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'atendimento-analise:move', {
    limit: 180,
    windowMs: 10 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;
  try {
    const body = await request.json().catch(() => ({}));
    const key = String(body.concessionaria_key || '').trim().slice(0, 140);
    const nome = String(body.concessionaria_nome || '').trim().slice(0, 180);
    const etapa = String(body.etapa || '').trim();
    if (!key || !nome || !ETAPAS.includes(etapa as (typeof ETAPAS)[number])) {
      return NextResponse.json({ error: 'Movimentacao invalida.' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('atendimento_analise_status')
      .upsert({
        concessionaria_key: key,
        concessionaria_nome: nome,
        etapa,
        atualizado_por_profile_id: guard.profile.id,
        updated_at: now,
      }, { onConflict: 'concessionaria_key' });
    if (error) throw error;
    await writeAuditLog(request, guard.profile, {
      action: 'concessionaria.analysis.move',
      entity_type: 'concessionaria',
      entity_id: key,
      metadata: { etapa, concessionaria_nome: nome },
    });
    return NextResponse.json({ success: true, updated_at: now });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao mover concessionaria.',
    }, { status: 500 });
  }
}
