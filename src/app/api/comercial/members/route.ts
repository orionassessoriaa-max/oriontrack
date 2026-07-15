import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireCommercialUser } from '@/lib/api/comercial';
import { writeAuditLog } from '@/lib/api/security';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;

  const { data: rows, error } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id,papel,ativo')
    .order('papel');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileIds = (rows || []).map((row) => row.profile_id);
  const { data: profiles } = profileIds.length
    ? await supabaseAdmin.from('profiles').select('id,nome,email,email_real,foto_url,status').in('id', profileIds)
    : { data: [] };
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  const members = (rows || []).map((row) => {
    const profile = profileMap.get(row.profile_id);
    return {
      ...row,
      nome: profile?.nome || 'Usuario',
      email: profile?.email_real || profile?.email || null,
      foto_url: profile?.foto_url || null,
    };
  });

  let candidates: Array<{ id: string; nome: string; email: string | null }> = [];
  if (guard.commercialRole === 'coordenador') {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id,nome,email,email_real,status')
      .or('status.eq.active,status.eq.ativo,status.eq.Ativo')
      .order('nome')
      .limit(200);
    const memberIds = new Set(profileIds);
    candidates = (data || [])
      .filter((profile) => !memberIds.has(profile.id))
      .map((profile) => ({ id: profile.id, nome: profile.nome, email: profile.email_real || profile.email || null }));
  }

  return NextResponse.json({ members, candidates, role: guard.commercialRole, currentProfileId: guard.profile.id });
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const profileId = String(body.profile_id || '');
  const papel = String(body.papel || '');
  if (!profileId || !['coordenador', 'closer', 'sdr'].includes(papel)) {
    return NextResponse.json({ error: 'Perfil e funcao sao obrigatorios.' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('comercial_membros').upsert({
    profile_id: profileId,
    papel,
    ativo: true,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAuditLog(request, guard.profile, {
    action: 'commercial.member.upsert',
    entity_type: 'profile',
    entity_id: profileId,
    metadata: { papel },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const profileId = String(body.profile_id || '');
  const ativo = body.ativo !== false;
  const papel = String(body.papel || '');
  if (!profileId) return NextResponse.json({ error: 'Perfil obrigatorio.' }, { status: 400 });

  const payload: Record<string, unknown> = { ativo, updated_at: new Date().toISOString() };
  if (['coordenador', 'closer', 'sdr'].includes(papel)) payload.papel = papel;
  const { error } = await supabaseAdmin.from('comercial_membros').update(payload).eq('profile_id', profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

