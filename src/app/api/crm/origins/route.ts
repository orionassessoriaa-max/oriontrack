import { NextResponse } from 'next/server';
import { ApiProfile, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeKanbanStages } from '@/lib/kanbanStages';

const ALLOWED_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro'] as const;

function normalizeName(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function isFacilita(name: unknown) {
  return normalizeName(name) === 'FACILITA CORRETORA';
}

async function resolveScope(profile: ApiProfile, requestedCorretorId: string) {
  const corretorId = requestedCorretorId || profile.corretor_id || '';
  if (!corretorId) return { error: 'Concessionaria nao informada.' };

  const { data: target } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, kanban_etapas')
    .eq('id', corretorId)
    .maybeSingle();

  if (!target) return { error: 'Concessionaria nao encontrada.' };

  if (profile.tipo_usuario !== 'admin') {
    if (!profile.corretor_id) return { error: 'Perfil sem concessionaria vinculada.' };
    const { data: own } = await supabaseAdmin
      .from('corretores')
      .select('id, nome_empresa')
      .eq('id', profile.corretor_id)
      .maybeSingle();
    if (!own || (own.id !== target.id && normalizeName(own.nome_empresa) !== normalizeName(target.nome_empresa))) {
      return { error: 'Concessionaria fora do seu acesso.' };
    }
  }

  const companyName = target.nome_empresa || target.nome;
  const { data: siblings } = target.nome_empresa
    ? await supabaseAdmin.from('corretores').select('id').eq('nome_empresa', target.nome_empresa)
    : { data: [{ id: target.id }] };

  return {
    target,
    companyName,
    corretorIds: (siblings || [{ id: target.id }]).map((item) => item.id),
  };
}

async function resolveMember(corretorIds: string[], memberId: string) {
  if (!memberId || memberId === 'unassigned') return { member: null };
  const { data: member } = await supabaseAdmin
    .from('corretor_time_membros')
    .select('id, corretor_id, profile_id, nome, email, status')
    .eq('id', memberId)
    .in('corretor_id', corretorIds)
    .in('status', ['active', 'ativo', 'Ativo'])
    .maybeSingle();
  return member ? { member } : { error: 'Responsavel nao encontrado nesta concessionaria.' };
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const corretorId = new URL(request.url).searchParams.get('corretor_id') || '';
  const scope = await resolveScope(guard.profile, corretorId);
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: 403 });

  if (!isFacilita(scope.companyName)) {
    return NextResponse.json({ enabled: false, origins: [], labels: [] });
  }

  const [{ data: origins, error: originsError }, { data: labels, error: labelsError }] = await Promise.all([
    supabaseAdmin
      .from('corretor_lead_origins')
      .select('id, corretor_id, nome, responsavel_membro_id, responsavel_profile_id, kanban_etapas, ativo')
      .eq('corretor_id', scope.target.id)
      .eq('ativo', true)
      .order('nome'),
    supabaseAdmin
      .from('corretor_lead_labels')
      .select('id, corretor_id, nome, ativo')
      .eq('corretor_id', scope.target.id)
      .eq('ativo', true)
      .order('nome'),
  ]);

  const error = originsError || labelsError;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enabled: true, origins: origins || [], labels: labels || [] });
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin']);
  if ('error' in guard) return guard.error;

  const body = await request.json().catch(() => ({}));
  const scope = await resolveScope(guard.profile, String(body.corretor_id || ''));
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: 403 });
  if (!isFacilita(scope.companyName)) {
    return NextResponse.json({ error: 'Esta configuracao esta habilitada somente para a Facilita Corretora.' }, { status: 403 });
  }

  const action = String(body.action || 'create_origin');
  const nome = String(body.nome || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!nome) return NextResponse.json({ error: 'Informe um nome.' }, { status: 400 });

  if (action === 'create_label') {
    const { data, error } = await supabaseAdmin
      .from('corretor_lead_labels')
      .insert([{ corretor_id: scope.target.id, nome, created_by: guard.profile.id }])
      .select('id, corretor_id, nome, ativo')
      .single();
    if (error) {
      const duplicate = error.code === '23505';
      return NextResponse.json({ error: duplicate ? 'Esta etiqueta ja esta cadastrada.' : error.message }, { status: duplicate ? 409 : 500 });
    }
    await writeAuditLog(request, guard.profile, {
      action: 'crm.label.create', entity_type: 'corretor_lead_label', entity_id: data.id, metadata: { corretor_id: scope.target.id, nome },
    });
    return NextResponse.json({ success: true, label: data });
  }

  const memberResult = await resolveMember(scope.corretorIds, String(body.responsavel_membro_id || ''));
  if ('error' in memberResult) return NextResponse.json({ error: memberResult.error }, { status: 400 });
  const member = memberResult.member;
  const stages = normalizeKanbanStages(scope.target.kanban_etapas);

  const { data, error } = await supabaseAdmin
    .from('corretor_lead_origins')
    .insert([{
      corretor_id: scope.target.id,
      nome,
      responsavel_membro_id: member?.id || null,
      responsavel_profile_id: member?.profile_id || null,
      kanban_etapas: stages,
      created_by: guard.profile.id,
    }])
    .select('id, corretor_id, nome, responsavel_membro_id, responsavel_profile_id, kanban_etapas, ativo')
    .single();

  if (error) {
    const duplicate = error.code === '23505';
    return NextResponse.json({ error: duplicate ? 'Esta origem ja esta cadastrada.' : error.message }, { status: duplicate ? 409 : 500 });
  }

  await writeAuditLog(request, guard.profile, {
    action: 'crm.origin.create', entity_type: 'corretor_lead_origin', entity_id: data.id,
    metadata: { corretor_id: scope.target.id, nome, responsavel_membro_id: member?.id || null },
  });
  return NextResponse.json({ success: true, origin: data });
}

export async function PUT(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin']);
  if ('error' in guard) return guard.error;

  const body = await request.json().catch(() => ({}));
  const scope = await resolveScope(guard.profile, String(body.corretor_id || ''));
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: 403 });
  if (!isFacilita(scope.companyName)) return NextResponse.json({ error: 'Configuracao indisponivel.' }, { status: 403 });

  const originId = String(body.origin_id || '');
  if (!originId) return NextResponse.json({ error: 'Origem nao informada.' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.stages !== undefined) update.kanban_etapas = normalizeKanbanStages(body.stages).slice(0, 40);
  if (body.responsavel_membro_id !== undefined) {
    const memberResult = await resolveMember(scope.corretorIds, String(body.responsavel_membro_id || ''));
    if ('error' in memberResult) return NextResponse.json({ error: memberResult.error }, { status: 400 });
    update.responsavel_membro_id = memberResult.member?.id || null;
    update.responsavel_profile_id = memberResult.member?.profile_id || null;
  }

  const { data, error } = await supabaseAdmin
    .from('corretor_lead_origins')
    .update(update)
    .eq('id', originId)
    .eq('corretor_id', scope.target.id)
    .select('id, corretor_id, nome, responsavel_membro_id, responsavel_profile_id, kanban_etapas, ativo')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Origem nao encontrada.' }, { status: 404 });

  await writeAuditLog(request, guard.profile, {
    action: 'crm.origin.update', entity_type: 'corretor_lead_origin', entity_id: data.id, metadata: { corretor_id: scope.target.id },
  });
  return NextResponse.json({ success: true, origin: data });
}
