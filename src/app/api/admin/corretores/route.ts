import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PUBLIC_LOGIN_URL } from '@/lib/publicUrl';

export async function POST(request: Request) {
  try {
    // 1. Validar Variáveis de Ambiente
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SERVER ERROR: Missing Supabase environment variables');
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' },
        { status: 500 }
      );
    }

    // 2. Pegar Token do Header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Token de autenticação ausente ou inválido.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];

    // 3. Identificar o solicitante (Admin)
    const { data: { user }, error: authUserError } = await supabaseAdmin.auth.getUser(token);

    if (authUserError || !user) {
      return NextResponse.json({ error: 'Sessão expirada ou usuário não autenticado.' }, { status: 401 });
    }

    const { data: profileRequester, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('tipo_usuario')
      .eq('id', user.id)
      .single();

    if (profileError || profileRequester?.tipo_usuario !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado. Apenas administradores podem cadastrar corretores.' }, { status: 403 });
    }

    // 4. Receber Body
    const body = await request.json();
    const { 
      nome, 
      telefone, 
      link_pagina, 
      status, 
      tipo_campanha,
      senha_provisoria, 
      observacoes, 
      time_operacional, 
      gestor_trafego_id 
    } = body;
    
    const email = body.email?.trim().toLowerCase();

    // 5. Validações básicas
    if (!nome || !email || !telefone || !senha_provisoria) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes (nome, email, telefone, senha).' }, { status: 400 });
    }

    if (senha_provisoria.trim().length < 6) {
      return NextResponse.json({ error: 'A senha provisória deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }

    // 6. Verificar duplicidade
    const { data: existingCorretor } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingCorretor) {
      return NextResponse.json({ error: 'Já existe um corretor cadastrado com este email.' }, { status: 400 });
    }

    // 7. Criar usuário no Auth
    const { data: authUserCreated, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha_provisoria,
      email_confirm: true,
      user_metadata: {
        nome,
        tipo_usuario: "corretor"
      }
    });

    if (createAuthError) {
      return NextResponse.json({ error: createAuthError.message }, { status: 400 });
    }

    const newUserId = authUserCreated.user.id;

    try {
      // 8. Inserir em public.corretores
      const { data: corretor, error: corretorError } = await supabaseAdmin
        .from('corretores')
        .insert([{
          nome,
          email,
          telefone,
          link_pagina: link_pagina || null,
          status: (status || 'ativo').toLowerCase(),
          tipo_campanha: tipo_campanha || 'ambos',
          observacoes: observacoes || null,
          time_operacional: Array.isArray(time_operacional) ? time_operacional : [],
          gestor_trafego_id: gestor_trafego_id || null
        }])
        .select()
        .single();

      if (corretorError) throw corretorError;

      // 9. Criar Profile
      const { error: profileRecordError } = await supabaseAdmin
        .from('profiles')
        .insert([{
          id: newUserId,
          email,
          nome,
          tipo_usuario: 'corretor',
          corretor_id: corretor.id,
          status: 'active'
        }]);

      if (profileRecordError) throw profileRecordError;

      return NextResponse.json({
        success: true,
        corretor,
        credentials: {
          email,
          senha_provisoria,
          link_login: PUBLIC_LOGIN_URL
        }
      });

    } catch (dbError: any) {
      console.error('DATABASE ERROR (Rolling back Auth User):', dbError);
      // Rollback: Apagar usuário Auth se falhar no banco
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: dbError.message || 'Erro ao salvar dados no banco.' }, { status: 500 });
    }

  } catch (error: any) {
    console.error('API CATCH ERROR:', error);
    return NextResponse.json({ error: 'Erro interno no servidor.' }, { status: 500 });
  }
}
