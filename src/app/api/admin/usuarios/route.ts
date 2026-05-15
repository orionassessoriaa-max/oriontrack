import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateOrionEmail, generateStrongPassword } from '@/lib/users';
import { UserRole } from '@/types';

function isMasterAdmin(profile: { email?: string | null; email_real?: string | null; is_admin_master?: boolean | null }) {
  if (profile.is_admin_master) return true;
  const email = String(profile.email_real || profile.email || '').toLowerCase();
  return email === 'ewerttonherculano@gmail.com';
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

    return NextResponse.json({
      profiles: profiles || [],
      corretores: corretores || [],
      isMasterAdmin: isMasterAdmin(guard.profile)
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao listar usuários.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const nome = String(body.nome || '').trim();
    const role = body.tipo_usuario as UserRole;
    const telefone = String(body.telefone || '').trim();
    const status = String(body.status || 'ativo').toLowerCase();
    const tipoCampanha = body.tipo_campanha || 'ambos';
    const emailReal = String(body.email_real || '').trim().toLowerCase() || null;
    const senhaProvisoria = String(body.senha_provisoria || generateStrongPassword());

    if (!nome || !role || !['admin', 'gestor_trafego', 'corretor'].includes(role)) {
      return NextResponse.json({ error: 'Nome e tipo de usuário são obrigatórios.' }, { status: 400 });
    }

    if (role === 'admin' && !isMasterAdmin(guard.profile)) {
      return NextResponse.json({ error: 'Apenas o admin master Ewertton pode criar outros admins.' }, { status: 403 });
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
        email_real: emailReal
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
            observacoes: body.observacoes || null,
          }])
          .select()
          .single();

        if (corretorError) throw corretorError;
        corretorId = corretor.id;
      }

      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert([{
          id: authUser.user.id,
          email,
          nome,
          tipo_usuario: role,
          corretor_id: corretorId,
          status: status === 'inativo' ? 'inactive' : 'active',
          email_real: emailReal,
          precisa_trocar_senha: true
        }]);

      if (profileError) throw profileError;

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
          link_login: `${new URL(request.url).origin}/login`
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
    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const id = String(body.id || '');
    const action = String(body.action || '');

    if (!id || action !== 'reset_password') {
      return NextResponse.json({ error: 'AÃ§Ã£o invÃ¡lida.' }, { status: 400 });
    }

    if (id === guard.user.id) {
      return NextResponse.json({ error: 'Use a recuperaÃ§Ã£o de senha para o seu prÃ³prio acesso.' }, { status: 400 });
    }

    const { data: targetProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, email_real, tipo_usuario, is_admin_master')
      .eq('id', id)
      .maybeSingle();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'UsuÃ¡rio nÃ£o encontrado.' }, { status: 404 });
    }

    if (isMasterAdmin(targetProfile)) {
      return NextResponse.json({ error: 'A senha do admin master nÃ£o pode ser redefinida por aqui.' }, { status: 403 });
    }

    if (targetProfile.tipo_usuario === 'admin' && !isMasterAdmin(guard.profile)) {
      return NextResponse.json({ error: 'Apenas o admin master pode redefinir senha de outro admin.' }, { status: 403 });
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

    return NextResponse.json({
      success: true,
      credentials: {
        email: targetProfile.email,
        email_real: targetProfile.email_real,
        senha_provisoria: senhaProvisoria,
        link_login: `${new URL(request.url).origin}/login`
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao redefinir senha.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
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
      return NextResponse.json({ error: 'O admin master não pode ser removido.' }, { status: 403 });
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao remover usuário.' }, { status: 500 });
  }
}
