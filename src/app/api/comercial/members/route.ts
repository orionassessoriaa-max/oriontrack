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
    ? await supabaseAdmin.from('profiles').select('id,nome,email,email_real,foto_url,status,corretor_id').in('id', profileIds)
    : { data: [] };
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  const members = (rows || []).filter((row) => {
    const profile = profileMap.get(row.profile_id);
    return profile && !profile.corretor_id;
  }).map((row) => {
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
      .select('id,nome,email,email_real,status,corretor_id')
      .or('status.eq.active,status.eq.ativo,status.eq.Ativo')
      .order('nome')
      .limit(200);
    const memberIds = new Set(profileIds);
    candidates = (data || [])
      .filter((profile) => !memberIds.has(profile.id) && !profile.corretor_id)
      .map((profile) => ({ id: profile.id, nome: profile.nome, email: profile.email_real || profile.email || null }));
  }

  return NextResponse.json({
    members,
    candidates,
    role: guard.commercialRole,
    currentProfileId: guard.profile.id,
    canViewMetaInvestment: guard.canViewMetaInvestment,
    canViewCommercialFinancials: guard.canViewCommercialFinancials,
    isDevOps: guard.isDevOps,
  });
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  if (body.action === 'create') {
    const nome = String(body.nome || '').trim();
    const papel = String(body.papel || 'sdr');
    const emailReal = String(body.email || '').trim().toLowerCase();
    if (!nome || !['coordenador', 'closer', 'sdr'].includes(papel)) {
      return NextResponse.json({ error: 'Nome e função comercial são obrigatórios.' }, { status: 400 });
    }

    const baseEmail = emailReal || `${nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '') || 'integrante'}@orion.com`;
    let email = baseEmail;
    for (let suffix = 1; suffix < 100; suffix += 1) {
      const { data: existing } = await supabaseAdmin.from('profiles').select('id').or(`email.eq.${email},email_real.eq.${email}`).maybeSingle();
      if (!existing) break;
      const [local, domain] = baseEmail.split('@');
      email = `${local}${suffix}@${domain}`;
    }
    const senhaProvisoria = `${Math.random().toString(36).slice(-6)}A9!`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senhaProvisoria,
      email_confirm: true,
      user_metadata: { nome, tipo_usuario: 'corretor_membro', equipe_orion: 'kripto_hunters' },
    });
    if (authError || !authData.user) return NextResponse.json({ error: authError?.message || 'Não foi possível criar o acesso.' }, { status: 400 });

    const profilePayload = {
      id: authData.user.id,
      email,
      email_real: emailReal || null,
      nome,
      tipo_usuario: 'corretor_membro',
      corretor_id: null,
      telefone: String(body.telefone || '').trim() || null,
      status: 'active',
      precisa_trocar_senha: true,
      equipe_orion: 'kripto_hunters',
    };
    let { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' });
    if (profileError && /equipe_orion|schema cache/i.test(String(profileError.message || ''))) {
      const profileWithoutTeam = { ...profilePayload };
      delete profileWithoutTeam.equipe_orion;
      const retry = await supabaseAdmin
        .from('profiles')
        .upsert(profileWithoutTeam, { onConflict: 'id' });
      profileError = retry.error;
    }
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
    const { error: memberError } = await supabaseAdmin.from('comercial_membros').insert({
      profile_id: authData.user.id,
      papel,
      ativo: true,
      updated_at: new Date().toISOString(),
    });
    if (memberError) {
      await supabaseAdmin.from('profiles').delete().eq('id', authData.user.id);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, credentials: { nome, email, senhaProvisoria, papel } });
  }
  const profileId = String(body.profile_id || '');
  const papel = String(body.papel || '');
  if (!profileId || !['coordenador', 'closer', 'sdr'].includes(papel)) {
    return NextResponse.json({ error: 'Perfil e funcao sao obrigatorios.' }, { status: 400 });
  }

  const { data: targetProfile } = await supabaseAdmin
    .from('profiles')
    .select('id,corretor_id')
    .eq('id', profileId)
    .maybeSingle();
  if (!targetProfile) return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 404 });
  if (targetProfile.corretor_id) {
    return NextResponse.json({ error: 'Corretores nao podem ser vinculados ao time comercial.' }, { status: 400 });
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
