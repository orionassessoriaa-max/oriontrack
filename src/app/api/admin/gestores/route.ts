import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PUBLIC_LOGIN_URL } from '@/lib/publicUrl';

export async function POST(request: Request) {
  try {
    // 1. Check Environment Variables
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' },
        { status: 500 }
      );
    }

    // 2. Auth Validation
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
    }

    // 3. Admin Check
    const { data: profileRequester } = await supabaseAdmin
      .from('profiles')
      .select('tipo_usuario')
      .eq('id', user.id)
      .single();

    if (profileRequester?.tipo_usuario !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado. Apenas administradores.' }, { status: 403 });
    }

    // 4. Input Validation
    const body = await request.json();
    const { nome, senha_provisoria, status } = body;
    const email = body.email?.trim().toLowerCase();

    if (!nome || !email || !senha_provisoria) {
      return NextResponse.json({ error: 'Nome, email e senha são obrigatórios.' }, { status: 400 });
    }

    if (senha_provisoria.length < 6) {
      return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }

    // 5. Create Auth User
    const { data: authUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha_provisoria,
      email_confirm: true,
      user_metadata: {
        nome,
        tipo_usuario: 'gestor_trafego'
      }
    });

    if (createAuthError) {
      return NextResponse.json({ error: createAuthError.message }, { status: 400 });
    }

    // 6. Create Profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert([{
        id: authUser.user.id,
        email,
        nome,
        tipo_usuario: 'gestor_trafego',
        corretor_id: null, // Traffic Managers don't belong to a single broker
        status: status || 'active'
      }]);

    if (profileError) {
      // Rollback
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ error: 'Erro ao criar perfil do gestor.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      credentials: {
        email,
        senha_provisoria,
        link_login: PUBLIC_LOGIN_URL
      }
    });

  } catch (error: any) {
    console.error('GESTORES API ERROR:', error);
    return NextResponse.json({ error: 'Erro interno no servidor.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
    try {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
      }
  
      const token = authHeader.split(' ')[1];
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  
      if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('tipo_usuario')
        .eq('id', user.id)
        .single();
  
      if (profile?.tipo_usuario !== 'admin') {
        return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
      }
  
      const { data: gestores, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('tipo_usuario', 'gestor_trafego')
        .order('created_at', { ascending: false });
  
      if (error) throw error;
  
      return NextResponse.json(gestores);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
