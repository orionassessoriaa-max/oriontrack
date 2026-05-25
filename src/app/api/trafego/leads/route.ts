import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireApiUser } from '@/lib/api/security';

type CorretorRecord = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  time_operacional: unknown;
};

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isLinkedToGestor(corretor: CorretorRecord, gestor: { id: string; nome?: string | null }) {
  if (corretor.gestor_trafego_id === gestor.id) return true;

  const team = Array.isArray(corretor.time_operacional) ? corretor.time_operacional : [];
  const gestorName = normalizeText(gestor.nome);

  return team.some((member: any) => {
    const profileId = String(member?.profile_id || '');
    const role = normalizeText(member?.tipo_usuario);
    const cargo = normalizeText(member?.cargo);
    const nome = normalizeText(member?.nome);

    return profileId === gestor.id
      || (Boolean(gestorName) && nome === gestorName)
      || (nome === gestorName && (role === 'gestor_trafego' || cargo.includes('trafego')));
  });
}

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
    .select('id, nome, email')
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
    .select('id, nome, gestor_trafego_id, time_operacional')
    .order('nome', { ascending: true });

  if (corretoresError) {
    return NextResponse.json({ error: corretoresError.message }, { status: 500 });
  }

  const corretores = ((corretoresData || []) as CorretorRecord[])
    .filter((corretor) => isLinkedToGestor(corretor, gestor))
    .map((corretor) => ({ id: corretor.id, nome: corretor.nome }));

  const corretorIds = corretores.map((corretor) => corretor.id);

  if (corretorIds.length === 0) {
    return NextResponse.json({ corretores, leads: [] });
  }

  const { data: leads, error: leadsError } = await supabaseAdmin
    .from('leads')
    .select('*, corretores(nome)')
    .in('corretor_id', corretorIds)
    .order('data_entrada', { ascending: false });

  if (leadsError) {
    return NextResponse.json({ error: leadsError.message }, { status: 500 });
  }

  return NextResponse.json({ corretores, leads: leads || [] });
}
