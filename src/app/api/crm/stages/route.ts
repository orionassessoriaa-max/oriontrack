import { NextResponse } from 'next/server';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeKanbanStages } from '@/lib/kanbanStages';

async function getBrokerScope(corretorId: string) {
  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa, kanban_etapas')
    .eq('id', corretorId)
    .maybeSingle();
  if (!broker) return null;

  const { data: siblings } = broker.nome_empresa
    ? await supabaseAdmin.from('corretores').select('id, kanban_etapas').eq('nome_empresa', broker.nome_empresa)
    : { data: [broker] };
  return { broker, siblings: siblings || [broker] };
}

async function canAccess(profile: any, corretorId: string) {
  if (profile.tipo_usuario === 'admin') return true;
  if (!profile.corretor_id) return false;
  if (profile.corretor_id === corretorId) return true;
  const { data } = await supabaseAdmin.from('corretores').select('id, nome_empresa').in('id', [profile.corretor_id, corretorId]);
  const own = data?.find((row) => row.id === profile.corretor_id);
  const target = data?.find((row) => row.id === corretorId);
  return Boolean(own?.nome_empresa && own.nome_empresa === target?.nome_empresa);
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
  if ('error' in guard) return guard.error;
  const corretorId = new URL(request.url).searchParams.get('corretor_id') || guard.profile.corretor_id;
  if (!corretorId || !(await canAccess(guard.profile, corretorId))) {
    return NextResponse.json({ error: 'Concessionária fora do seu acesso.' }, { status: 403 });
  }
  const scope = await getBrokerScope(corretorId);
  if (!scope) return NextResponse.json({ error: 'Concessionária não encontrada.' }, { status: 404 });
  const configured = scope.siblings.find((row: any) => Array.isArray(row.kanban_etapas) && row.kanban_etapas.length)?.kanban_etapas;
  return NextResponse.json({ stages: normalizeKanbanStages(configured) });
}

export async function PUT(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin']);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const corretorId = String(body.corretor_id || guard.profile.corretor_id || '');
  if (!corretorId || !(await canAccess(guard.profile, corretorId))) {
    return NextResponse.json({ error: 'Concessionária fora do seu acesso.' }, { status: 403 });
  }
  const scope = await getBrokerScope(corretorId);
  if (!scope) return NextResponse.json({ error: 'Concessionária não encontrada.' }, { status: 404 });
  const stages = normalizeKanbanStages(body.stages).slice(0, 40);
  const brokerIds = scope.siblings.map((row: any) => row.id);
  const { error } = await supabaseAdmin.from('corretores').update({ kanban_etapas: stages }).in('id', brokerIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('leads').update({ conta_como_venda: false }).in('corretor_id', brokerIds);
  const saleStatuses = stages.filter((stage) => stage.saleEquivalent).map((stage) => stage.id);
  if (saleStatuses.length) {
    await supabaseAdmin.from('leads').update({ conta_como_venda: true }).in('corretor_id', brokerIds).in('status', saleStatuses);
  }
  await writeAuditLog(request, guard.profile, {
    action: 'crm.stages.update', entity_type: 'corretor', entity_id: corretorId, metadata: { stages: stages.length },
  });
  return NextResponse.json({ success: true, stages });
}
