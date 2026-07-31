import { after, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateOrionEmail, generateStrongPassword } from '@/lib/users';
import { PUBLIC_LOGIN_URL } from '@/lib/publicUrl';
import { UserRole } from '@/types';
import { rateLimit, writeAuditLog } from '@/lib/api/security';
import { ensureConcessionariaDriveFolder } from '@/lib/creatives/automation';

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

async function upsertNotificationPhone(profileId: string, telefone: string) {
  if (!profileId || !telefone) return;

  const { data: current } = await supabaseAdmin
    .from('notificacao_preferencias')
    .select('whatsapp_enabled, tipos')
    .eq('profile_id', profileId)
    .maybeSingle();

  await supabaseAdmin
    .from('notificacao_preferencias')
    .upsert({
      profile_id: profileId,
      telefone,
      whatsapp_enabled: Boolean(current?.whatsapp_enabled),
      tipos: current?.tipos || {},
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id' });
}

async function resolvePrimaryCorretorByBrokerage(nomeEmpresa: unknown) {
  const brokerageName = String(nomeEmpresa || '').trim();
  if (!brokerageName) return null;

  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('nome_empresa', brokerageName)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function resolveBrokerageRecord(nomeEmpresa: unknown) {
  const brokerageName = String(nomeEmpresa || '').trim();
  if (!brokerageName) return null;

  const { data, error } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .ilike('nome', brokerageName)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function ensureCorretorTeam(corretorId: string, nomeEmpresa?: string | null) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('corretor_times')
    .select('id')
    .eq('corretor_id', corretorId)
    .eq('ativo', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await supabaseAdmin
    .from('corretor_times')
    .insert([{
      corretor_id: corretorId,
      nome: String(nomeEmpresa || 'Time Comercial').trim() || 'Time Comercial',
      ativo: true,
    }])
    .select('id')
    .single();

  if (createError) throw createError;
  return created.id;
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
      const isRemovedTeamMember = (profile.tipo_usuario === 'corretor_membro' || profile.tipo_usuario === 'corretor_admin')
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
    let profileRole = role;
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

    const allowedRoles: UserRole[] = ['admin', 'gestor_trafego', 'corretor', 'designer', 'account_manager', 'corretor_admin', 'corretor_membro'];

    if (!nome || !role || !allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'Nome e tipo de usuário são obrigatórios.' }, { status: 400 });
    }

    if (['corretor', 'corretor_membro'].includes(role) && !telefone) {
      return NextResponse.json({ error: 'Telefone é obrigatório para corretor.' }, { status: 400 });
    }

    if (role === 'corretor_membro' && !String(body.nome_empresa || '').trim()) {
      return NextResponse.json({ error: 'Selecione a concessionaria do corretor integrante.' }, { status: 400 });
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
    let memberTeamId: string | null = null;
    let memberBrokerageName: string | null = null;

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
            nome_empresa: body.nome_empresa || null,
            status,
            tipo_campanha: tipoCampanha,
            operadoras_info: { selecionadas: Array.isArray(body.operadoras) ? body.operadoras : [] },
            time_operacional: timeOperacional,
            gestor_trafego_id: gestorTrafegoId,
            rodizio_ativo: body.rodizio_ativo !== false,
            observacoes: body.observacoes || null,
          }])
          .select()
          .single();

        if (corretorError) throw corretorError;
        corretorId = corretor.id;
      }

      if (role === 'corretor_membro') {
        const primaryCorretor = await resolvePrimaryCorretorByBrokerage(body.nome_empresa);
        if (!primaryCorretor?.id) {
          const brokerage = await resolveBrokerageRecord(body.nome_empresa);
          if (!brokerage?.nome) {
            throw new Error('Concessionaria nao encontrada. Crie a concessionaria ou um Corretor Admin primeiro.');
          }

          const { data: firstCorretor, error: firstCorretorError } = await supabaseAdmin
            .from('corretores')
            .insert([{
              nome,
              email,
              telefone,
              nome_empresa: brokerage.nome,
              status,
              tipo_campanha: tipoCampanha,
              operadoras_info: { selecionadas: [] },
              time_operacional: [],
              gestor_trafego_id: null,
              rodizio_ativo: true,
              observacoes: 'Primeiro acesso criado automaticamente a partir de uma concessionaria vazia.',
            }])
            .select('id, nome, nome_empresa')
            .single();

          if (firstCorretorError) throw firstCorretorError;
          corretorId = firstCorretor.id;
          memberBrokerageName = firstCorretor.nome_empresa || brokerage.nome;
          profileRole = 'corretor';
        } else {
          corretorId = primaryCorretor.id;
          memberBrokerageName = primaryCorretor.nome_empresa || String(body.nome_empresa || '').trim();
          memberTeamId = await ensureCorretorTeam(primaryCorretor.id, memberBrokerageName);
        }
      }

      const profilePayload = {
          id: authUser.user.id,
          email,
          nome,
          tipo_usuario: profileRole,
          corretor_id: corretorId,
          status: status === 'inativo' ? 'inactive' : 'active',
          email_real: emailReal,
          nome_empresa: ['corretor', 'corretor_membro'].includes(profileRole) ? String(memberBrokerageName || body.nome_empresa || '').trim() || null : null,
          telefone: telefone || null,
          foto_url: fotoUrl,
          precisa_trocar_senha: true,
          // Integrantes do Kripto tambem precisam carregar a operacao no perfil.
          // Corretor dono continua sem equipe: a equipe dele vem da concessionaria.
          equipe_orion: profileRole === 'corretor' ? null : equipeOrion,
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
      await upsertNotificationPhone(authUser.user.id, telefone);

      if (profileRole === 'corretor_membro' && equipeOrion === 'kripto_hunters') {
        const { error: commercialMemberError } = await supabaseAdmin
          .from('comercial_membros')
          .upsert({ profile_id: authUser.user.id, papel: body.papel || 'sdr', ativo: true, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' });
        if (commercialMemberError) throw commercialMemberError;
      }

      if (profileRole !== role) {
        await supabaseAdmin.auth.admin.updateUserById(authUser.user.id, {
          user_metadata: { nome, tipo_usuario: profileRole, email_real: emailReal, foto_url: fotoUrl }
        });
      }

      if (profileRole === 'corretor_membro' && corretorId && memberTeamId) {
        const { data: lastMember } = await supabaseAdmin
          .from('corretor_time_membros')
          .select('ordem')
          .eq('time_id', memberTeamId)
          .order('ordem', { ascending: false })
          .limit(1)
          .maybeSingle();

        const ordem = Number(lastMember?.ordem || 0) + 1;
        const { error: memberError } = await supabaseAdmin
          .from('corretor_time_membros')
          .insert([{
            time_id: memberTeamId,
            corretor_id: corretorId,
            profile_id: authUser.user.id,
            nome,
            email,
            status: 'ativo',
            ordem,
            participa_rodizio: body.participa_rodizio !== false,
          }]);

        if (memberError) throw memberError;
      }

      await writeAuditLog(request, guard.profile as any, {
        action: 'user.create',
        entity_type: 'profile',
        entity_id: authUser.user.id,
        metadata: { role: profileRole, requested_role: role, corretor_id: corretorId, email },
      });
      if (corretorId) {
        const createdCorretorId = corretorId;
        after(async () => {
          try {
            await ensureConcessionariaDriveFolder(createdCorretorId);
          } catch (folderError) {
            console.error('Falha ao criar pasta da concessionaria no Drive:', folderError);
          }
        });
      }

      return NextResponse.json({
        success: true,
        user: {
          id: authUser.user.id,
          nome,
          tipo_usuario: profileRole,
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
      .select('id, email, email_real, tipo_usuario, corretor_id, is_admin_master, telefone')
      .eq('id', id)
      .maybeSingle();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'UsuÃ¡rio nÃ£o encontrado.' }, { status: 404 });
    }

    if (action === 'update_profile') {
      const nome = String(body.nome || '').trim();
      const emailReal = String(body.email_real || '').trim() || null;
      const fotoUrl = typeof body.foto_url === 'string' ? body.foto_url : null;
      const telefone = String(body.telefone || '').trim();
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

      if (isMasterAdmin(targetProfile) && targetProfile.id !== guard.user.id) {
        return NextResponse.json({ error: 'O acesso do DevOps Manager nao pode ser editado por outro admin.' }, { status: 403 });
      }

      const roleToSave = nextRole || targetProfile.tipo_usuario;
      const profileUpdatePayload = {
        nome,
        email_real: emailReal,
        nome_empresa: roleToSave === 'corretor' ? String(body.nome_empresa || '').trim() || null : null,
        foto_url: fotoUrl,
        telefone: telefone || null,
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

      if (roleToSave === 'corretor_membro' && nextEquipe === 'kripto_hunters') {
        const { error: commercialMemberError } = await supabaseAdmin
          .from('comercial_membros')
          .upsert({ profile_id: id, papel: body.papel || 'sdr', ativo: true, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' });
        if (commercialMemberError) return NextResponse.json({ error: commercialMemberError.message }, { status: 500 });
      } else if (targetProfile.tipo_usuario === 'corretor_membro' && nextEquipe !== 'kripto_hunters') {
        await supabaseAdmin.from('comercial_membros').update({ ativo: false, updated_at: new Date().toISOString() }).eq('profile_id', id);
      }

      await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: { name: nome, nome, email_real: emailReal, tipo_usuario: roleToSave }
      });

      await upsertNotificationPhone(id, telefone);

      if (targetProfile.tipo_usuario === 'corretor') {
        const { data: profileWithCorretor } = await supabaseAdmin
          .from('profiles')
          .select('id, email, corretor_id')
          .eq('id', id)
          .maybeSingle();

        const timeOperacional = Array.isArray(body.time_operacional) ? body.time_operacional : [];
        const operadoras = Array.isArray(body.operadoras) ? body.operadoras : [];
        const gestorTrafegoId = await resolveGestorTrafegoId(body.gestor_trafego_id, timeOperacional);
        const corretorUpdatePayload: Record<string, unknown> = {
          nome,
          email_real: emailReal,
          telefone: telefone || 'Sem telefone',
          nome_empresa: body.nome_empresa || null,
          tipo_campanha: body.tipo_campanha || 'ambos',
          time_operacional: timeOperacional,
          gestor_trafego_id: gestorTrafegoId,
          operadoras_info: { selecionadas: operadoras },
        };
        if (Object.prototype.hasOwnProperty.call(body, 'rodizio_ativo')) {
          corretorUpdatePayload.rodizio_ativo = body.rodizio_ativo !== false;
        }

        if (profileWithCorretor?.corretor_id) {
          const { error: corretorUpdateError } = await supabaseAdmin
            .from('corretores')
            .update(corretorUpdatePayload)
            .eq('id', profileWithCorretor.corretor_id);
          if (corretorUpdateError) {
            return NextResponse.json({ error: corretorUpdateError.message }, { status: 500 });
          }
          const updatedCorretorId = profileWithCorretor.corretor_id;
          after(async () => {
            try {
              await ensureConcessionariaDriveFolder(updatedCorretorId, gestorTrafegoId);
            } catch (folderError) {
              console.error('Falha ao sincronizar pasta da concessionaria no Drive:', folderError);
            }
          });
        } else {
          const { data: existingCorretor } = await supabaseAdmin
            .from('corretores')
            .select('id')
            .eq('email', profileWithCorretor?.email || targetProfile.email)
            .maybeSingle();

          const corretorId = existingCorretor?.id || null;
          const finalCorretorId = corretorId || (await supabaseAdmin
            .from('corretores')
            .insert([{
              nome,
              email: profileWithCorretor?.email || targetProfile.email,
              telefone,
              nome_empresa: body.nome_empresa || null,
              status: 'active',
              tipo_campanha: body.tipo_campanha || 'ambos',
              time_operacional: timeOperacional,
              gestor_trafego_id: gestorTrafegoId,
              rodizio_ativo: body.rodizio_ativo !== false,
              operadoras_info: { selecionadas: operadoras },
            }])
            .select('id')
            .single()).data?.id;

          if (finalCorretorId) {
            await supabaseAdmin
              .from('profiles')
              .update({ corretor_id: finalCorretorId })
              .eq('id', id);
            after(async () => {
              try {
                await ensureConcessionariaDriveFolder(finalCorretorId, gestorTrafegoId);
              } catch (folderError) {
                console.error('Falha ao sincronizar pasta da concessionaria no Drive:', folderError);
              }
            });
          }
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
