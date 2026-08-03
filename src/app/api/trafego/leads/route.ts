import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

type CorretorRecord = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  time_operacional: unknown;
  nome_empresa: string | null;
};

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;

  const url = new URL(request.url);
  const requestedGestorId = url.searchParams.get('gestor_id');

  const gestorId = guard.profile.tipo_usuario === 'admin'
    ? requestedGestorId
    : guard.profile.id;

  if (!gestorId) {
    return NextResponse.json({ error: 'Gestor nao informado.' }, { status: 400 });
  }

  const { data: gestor, error: gestorError } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real')
    .eq('id', gestorId)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();

  if (gestorError) {
    return NextResponse.json({ error: gestorError.message }, { status: 500 });
  }

  if (!gestor) {
    return NextResponse.json({ error: 'Gestor nao encontrado.' }, { status: 404 });
  }

  const { data: corretoresData, error: corretoresError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, gestor_trafego_id, time_operacional, nome_empresa')
    .order('nome', { ascending: true });

  if (corretoresError) {
    return NextResponse.json({ error: corretoresError.message }, { status: 500 });
  }

  const corretores = ((corretoresData || []) as CorretorRecord[])
    .filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, gestor))
    .map((corretor) => ({ id: corretor.id, nome: corretor.nome, nome_empresa: corretor.nome_empresa }));

  const corretorIds = corretores.map((corretor) => corretor.id);

  if (corretorIds.length === 0) {
    return NextResponse.json({ corretores, leads: [] });
  }

  const { data: leads, error: leadsError } = await supabaseAdmin
    .from('leads')
    .select('*, corretores(nome,nome_empresa)')
    .in('corretor_id', corretorIds)
    .order('data_entrada', { ascending: false, nullsFirst: false });

  if (leadsError) {
    return NextResponse.json({ error: leadsError.message }, { status: 500 });
  }

  return NextResponse.json({ corretores, leads: leads || [] });
}

export async function DELETE(request: Request) {
  const guard = await requireApiUser(request, ['gestor_trafego']);
  if ('error' in guard) return guard.error;

  const body = await request.json().catch(() => ({}));
  const leadIds = Array.from(new Set(
    (Array.isArray(body.ids) ? body.ids : [body.id])
      .map((value: unknown) => String(value || '').trim())
      .filter(Boolean)
  )).slice(0, 500);

  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'Selecione pelo menos um lead.' }, { status: 400 });
  }

  const { data: gestor, error: gestorError } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real')
    .eq('id', guard.profile.id)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();
  if (gestorError) return NextResponse.json({ error: gestorError.message }, { status: 500 });
  if (!gestor) return NextResponse.json({ error: 'Gestor não encontrado.' }, { status: 404 });

  const { data: corretoresData, error: corretoresError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, gestor_trafego_id, time_operacional, nome_empresa');
  if (corretoresError) return NextResponse.json({ error: corretoresError.message }, { status: 500 });

  const allowedCorretorIds = ((corretoresData || []) as CorretorRecord[])
    .filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, gestor))
    .map((corretor) => corretor.id);
  if (allowedCorretorIds.length === 0) {
    return NextResponse.json({ error: 'Você não possui concessionárias atribuídas.' }, { status: 403 });
  }

  const { data: allowedLeads, error: lookupError } = await supabaseAdmin
    .from('leads')
    .select('id')
    .in('id', leadIds)
    .in('corretor_id', allowedCorretorIds);
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });

  const allowedLeadIds = (allowedLeads || []).map((lead) => lead.id);
  if (allowedLeadIds.length !== leadIds.length) {
    return NextResponse.json({ error: 'Um ou mais leads não pertencem às concessionárias atribuídas a você.' }, { status: 403 });
  }

  const { data: deleted, error: deleteError } = await supabaseAdmin
    .from('leads')
    .delete()
    .in('id', allowedLeadIds)
    .select('id');
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  await writeAuditLog(request, guard.profile, {
    action: 'traffic.leads.delete',
    entity_type: 'lead',
    metadata: { lead_ids: allowedLeadIds, total: deleted?.length || 0 },
  });

  return NextResponse.json({ success: true, deleted: deleted?.length || 0, ids: allowedLeadIds });
}
