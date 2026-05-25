import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateOrionEmail, generateStrongPassword } from '@/lib/users';
import { PUBLIC_LOGIN_URL } from '@/lib/publicUrl';
import { UserRole } from '@/types';
import { rateLimit, writeAuditLog } from '@/lib/api/security';

function isMasterAdmin(profile: { email?: string | null; email_real?: string | null; is_admin_master?: boolean | null }) {
  if (profile.is_admin_master) return true;
  const email = String(profile.email_real || profile.email || '').toLowerCase();
  return email === 'ewerttonherculano@gmail.com';
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

async function resolveGestorTrafegoId(explicitId: unknown, timeOperacional: any[]) {
  const directId = String(explicitId || '').trim();
  if (directId) return directId;

  const member = timeOperacional.find((item: any) => {
    const role = normalizeText(item?.tipo_usuario);
    const cargo = normalizeText(item?.cargo);
    return role === 'gestor_trafego' || cargo.includes('trafego');
  });

  if (!member) return null;
  if (member.profile_id) return String(member.profile_id);

  const memberName = normalizeText(member.nome);
  if (!memberName) return null;

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, nome')
    .eq('tipo_usuario', 'gestor_trafego');

  return (profiles || []).find((profile) => normalizeText(profile.nome) === memberName)?.id || null;
}

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('tipo_usuario,email,email_real,is_admin_master')
    .eq('id', user.id)
    .single();

  if (profile?.tipo_usuario !== 'admin') {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

async function resolveUniqueAccessEmail(nome: string, requestedEmail?: string) {
  const baseEmail = String(requestedEmail || generateOrionEmail(nome)).trim().toLowerCase();
  const [localPart, domain = 'orion.com'] = baseEmail.split('@');
  let candidate = `${localPart}@${domain}`;
  let suffix = 2;

  while (suffix < 100) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', candidate)
      .maybeSingle();

    if (!data) return candidate;
    candidate = `${localPart}${suffix}@${domain}`;
    suffix += 1;
  }

  throw new Error('Não foi possível gerar um email de acesso único.');
}

function isMissingTeamColumn(error?: { message?: string | null } | null) {
  return String(error?.message || '').includes('equipe_orion');
}

export async function GET(request: Request) {
  try {
    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const [{ data: profiles, error: profilesError }, { data: corretores, error: corretoresError }] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('corretores').select('*').order('created_at', { ascending: false })
    ]);

    if (profilesError) throw profilesError;
    if (corretoresError) throw corretoresError;

    const visibleProfiles = (profiles || []).filter((profile: any) => {
      const status = String(profile.status || '').toLowerCase();
      const isRemovedTeamMember = profile.tipo_usuario === 'corretor_membro'
        && ['inactive', 'inativo', 'deleted', 'removed'].includes(status);
      return !isRemovedTeamMember;
    });

    return NextResponse.json({
      profiles: visibleProfiles,
      corretores: corretores || [],
      isMasterAdmin: isMasterAdmin(guard.profile)
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao listar usuários.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:usuarios:create', { limit: 20, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const nome = String(body.nome || '').trim();
    const role = body.tipo_usuario as UserRole;
    const telefone = String(body.telefone || '').trim();
    const status = String(body.status || 'ativo').toLowerCase();
    const tipoCampanha = body.tipo_campanha || 'ambos';
    const emailReal = String(body.email_real || '').trim().toLowerCase() || null;
    const equipeOrion = ['apollo', 'kripto_hunters'].includes(String(body.equipe_orion || ''))
      ? String(body.equipe_orion)
      : null;
    const senhaProvisoria = String(body.senha_provisoria || generateStrongPassword());
    const fotoUrl = typeof body.foto_url === 'string' && body.foto_url.startsWith('data:image/')
      ? body.foto_url
      : null;

    const allowedRoles: UserRole[] = ['admin', 'gestor_trafego', 'corretor', 'designer', 'account_manager'];

    if (!nome || !role || !allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'Nome e tipo de usuário são obrigatórios.' }, { status: 400 });
    }

    if (role === 'admin' && !isMasterAdmin(guard.profile)) {
      return NextResponse.json({ error: 'Apenas o DevOps Manager pode criar outros admins.' }, { status: 403 });
    }

    if (role === 'corretor' && !telefone) {
      return NextResponse.json({ error: 'Telefone é obrigatório para corretor.' }, { status: 400 });
    }

    const email = await resolveUniqueAccessEmail(nome, body.email);

    const { data: authUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senhaProvisoria,
      email_confirm: true,
      user_metadata: {
        nome,
        tipo_usuario: role,
        email_real: emailReal,
        foto_url: fotoUrl
      }
    });

    if (createAuthError || !authUser.user) {
      return NextResponse.json({ error: createAuthError?.message || 'Erro ao criar acesso.' }, { status: 400 });
    }

    let corretorId: string | null = null;

    try {
      if (role === 'corretor') {
        const timeOperacional = Array.isArray(body.time_operacional)
          ? body.time_operacional.filter((member: any) => member?.nome && member?.cargo)
          : [];
        const gestorTrafegoId = await resolveGestorTrafegoId(body.gestor_trafego_id, timeOperacional);

        const { data: corretor, error: corretorError } = await supabaseAdmin
          .from('corretores')
          .insert([{
            nome,
            email,
            telefone,
            status,
            tipo_campanha: tipoCampanha,
            operadoras_info: { selecionadas: Array.isArray(body.operadoras) ? body.operadoras : [] },
            time_operacional: timeOperacional,
            gestor_trafego_id: gestorTrafegoId,
            observacoes: body.observacoes || null,
          }])
          .select()
          .single();

        if (corretorError) throw corretorError;
        corretorId = corretor.id;
      }

      const profilePayload = {
          id: authUser.user.id,
          email,
          nome,
          tipo_usuario: role,
          corretor_id: corretorId,
          status: status === 'inativo' ? 'inactive' : 'active',
          email_real: emailReal,
          foto_url: fotoUrl,
          precisa_trocar_senha: true,
          equipe_orion: role === 'corretor' ? null : equipeOrion,
        };

      let { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert([profilePayload]);

      if (isMissingTeamColumn(profileError)) {
        const { equipe_orion, ...profilePayloadWithoutTeam } = profilePayload;
        const retry = await supabaseAdmin
          .from('profiles')
          .insert([profilePayloadWithoutTeam]);
        profileError = retry.error;
      }

      if (profileError) throw profileError;

      await writeAuditLog(request, guard.profile as any, {
        action: 'user.create',
        entity_type: 'profile',
        entity_id: authUser.user.id,
        metadata: { role, corretor_id: corretorId, email },
      });

      return NextResponse.json({
        success: true,
        user: {
          id: authUser.user.id,
          nome,
          tipo_usuario: role,
          corretor_id: corretorId
        },
        credentials: {
          email,
          email_real: emailReal,
          senha_provisoria: senhaProvisoria,
          link_login: PUBLIC_LOGIN_URL
        }
      });
    } catch (dbError: any) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ error: dbError.message || 'Erro ao criar usuário.' }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:usuarios:update', { limit: 40, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const id = String(body.id || '');
    const action = String(body.action || '');

    if (!id || !['reset_password', 'update_profile'].includes(action)) {
      return NextResponse.json({ error: 'AÃ§Ã£o invÃ¡lida.' }, { status: 400 });
    }

    if (id === guard.user.id && action === 'reset_password') {
      return NextResponse.json({ error: 'Use a recuperaÃ§Ã£o de senha para o seu prÃ³prio acesso.' }, { status: 400 });
    }

    const { data: targetProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, email_real, tipo_usuario, corretor_id, is_admin_master')
      .eq('id', id)
      .maybeSingle();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'UsuÃ¡rio nÃ£o encontrado.' }, { status: 404 });
    }

    if (action === 'update_profile') {
      const nome = String(body.nome || '').trim();
      const emailReal = String(body.email_real || '').trim() || null;
      const fotoUrl = typeof body.foto_url === 'string' ? body.foto_url : null;
      const nextRole = body.tipo_usuario as UserRole | undefined;
      const nextEquipe = ['apollo', 'kripto_hunters'].includes(String(body.equipe_orion || ''))
        ? String(body.equipe_orion)
        : null;

      if (!nome) {
        return NextResponse.json({ error: 'Nome obrigatorio.' }, { status: 400 });
      }

      if (nextRole && nextRole !== targetProfile.tipo_usuario && (nextRole === 'corretor' || targetProfile.tipo_usuario === 'corretor')) {
        return NextResponse.json({ error: 'Para transformar acesso em corretor ou tirar de corretor, crie um novo acesso. A edicao segura permite ajustar dados do perfil atual.' }, { status: 400 });
      }

      if (targetProfile.tipo_usuario === 'admin' && !isMasterAdmin(guard.profile)) {
        return NextResponse.json({ error: 'Apenas o DevOps Manager pode editar outro admin.' }, { status: 403 });
      }

      if (nextRole === 'admin' && !isMasterAdmin(guard.profile)) {
        return NextResponse.json({ error: 'Apenas o DevOps Manager pode definir outro admin.' }, { status: 403 });
      }

      const roleToSave = nextRole || targetProfile.tipo_usuario;
      const profileUpdatePayload = {
        nome,
        email_real: emailReal,
        foto_url: fotoUrl,
        tipo_usuario: roleToSave,
        equipe_orion: roleToSave === 'corretor' ? null : nextEquipe,
      };
      let { error: updateProfileError } = await supabaseAdmin
        .from('profiles')
        .update(profileUpdatePayload)
        .eq('id', id);

      if (isMissingTeamColumn(updateProfileError)) {
        const { equipe_orion, ...profileUpdateWithoutTeam } = profileUpdatePayload;
        const retry = await supabaseAdmin
          .from('profiles')
          .update(profileUpdateWithoutTeam)
          .eq('id', id);
        updateProfileError = retry.error;
      }

      if (updateProfileError) {
        return NextResponse.json({ error: updateProfileError.message }, { status: 500 });
      }

      await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: { name: nome, nome, email_real: emailReal, tipo_usuario: roleToSave }
      });

      if (targetProfile.tipo_usuario === 'corretor') {
        const { data: profileWithCorretor } = await supabaseAdmin
          .from('profiles')
          .select('corretor_id')
          .eq('id', id)
          .maybeSingle();

        if (profileWithCorretor?.corretor_id) {
          const timeOperacional = Array.isArray(body.time_operacional) ? body.time_operacional : [];
          const operadoras = Array.isArray(body.operadoras) ? body.operadoras : [];
          const gestorTrafegoId = await resolveGestorTrafegoId(body.gestor_trafego_id, timeOperacional);
          await supabaseAdmin
            .from('corretores')
            .update({
              nome,
              email_real: emailReal,
              telefone: String(body.telefone || '').trim(),
              tipo_campanha: body.tipo_campanha || 'ambos',
              time_operacional: timeOperacional,
              gestor_trafego_id: gestorTrafegoId,
              foto_url: fotoUrl,
              operadoras_info: { selecionadas: operadoras },
            })
            .eq('id', profileWithCorretor.corretor_id);
        }
      }

      await writeAuditLog(request, guard.profile as any, {
        action: 'user.update',
        entity_type: 'profile',
        entity_id: id,
        metadata: { nome, email_real: emailReal, tipo_usuario: roleToSave, equipe_orion: roleToSave === 'corretor' ? null : nextEquipe },
      });

      return NextResponse.json({ success: true });
    }

    if (isMasterAdmin(targetProfile)) {
      return NextResponse.json({ error: 'A senha do DevOps Manager nao pode ser redefinida por aqui.' }, { status: 403 });
    }

    if (targetProfile.tipo_usuario === 'admin' && !isMasterAdmin(guard.profile)) {
      return NextResponse.json({ error: 'Apenas o DevOps Manager pode redefinir senha de outro admin.' }, { status: 403 });
    }

    const senhaProvisoria = generateStrongPassword();
    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      password: senhaProvisoria
    });

    if (updateAuthError) {
      return NextResponse.json({ error: updateAuthError.message }, { status: 400 });
    }

    const { error: updateProfileError } = await supabaseAdmin
      .from('profiles')
      .update({ precisa_trocar_senha: true })
      .eq('id', id);

    if (updateProfileError) {
      return NextResponse.json({ error: updateProfileError.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile as any, {
      action: 'user.password.reset',
      entity_type: 'profile',
      entity_id: id,
    });

    return NextResponse.json({
      success: true,
      credentials: {
        email: targetProfile.email,
        email_real: targetProfile.email_real,
        senha_provisoria: senhaProvisoria,
        link_login: PUBLIC_LOGIN_URL
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao redefinir senha.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:usuarios:delete', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID obrigatório.' }, { status: 400 });

    if (id === guard.user.id) {
      return NextResponse.json({ error: 'Você não pode remover seu próprio acesso.' }, { status: 400 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    if (isMasterAdmin(profile)) {
      return NextResponse.json({ error: 'O DevOps Manager não pode ser removido.' }, { status: 403 });
    }

    if (profile.tipo_usuario === 'admin' && !isMasterAdmin(guard.profile)) {
      return NextResponse.json({ error: 'Apenas o admin mestre pode remover outro admin.' }, { status: 403 });
    }

    if (profile.corretor_id) {
      await supabaseAdmin.from('leads').delete().eq('corretor_id', profile.corretor_id);
      await supabaseAdmin.from('relatorios_trafego').delete().eq('corretor_id', profile.corretor_id);
      await supabaseAdmin.from('solicitacoes_suporte').delete().eq('corretor_id', profile.corretor_id);
      await supabaseAdmin.from('corretores').delete().eq('id', profile.corretor_id);
    }

    await supabaseAdmin.from('profiles').delete().eq('id', id);
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (authDeleteError && authDeleteError.message !== 'User not found') {
      return NextResponse.json({ error: authDeleteError.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile as any, {
      action: 'user.delete',
      entity_type: 'profile',
      entity_id: id,
      metadata: { removed_role: profile.tipo_usuario, corretor_id: profile.corretor_id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao remover usuário.' }, { status: 500 });
  }
}
