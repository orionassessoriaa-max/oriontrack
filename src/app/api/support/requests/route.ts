import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'NÃ£o autorizado.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'SessÃ£o expirada.' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, tipo_usuario, corretor_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Perfil nÃ£o encontrado.' }, { status: 404 });
    }

    const body = await request.json();
    const categoria = String(body.categoria || body.tipo || 'outro');
    const mensagem = String(body.mensagem || '').trim();

    if (!mensagem) {
      return NextResponse.json({ error: 'Descreva seu chamado antes de enviar.' }, { status: 400 });
    }

    const { data: requestData, error: requestError } = await supabaseAdmin
      .from('solicitacoes_suporte')
      .insert([{
        corretor_id: profile.corretor_id || null,
        solicitante_profile_id: profile.id,
        solicitante_nome: profile.nome,
        solicitante_tipo: profile.tipo_usuario,
        categoria,
        tipo: categoria,
        mensagem,
        status: 'nova'
      }])
      .select()
      .single();

    if (requestError) {
      return NextResponse.json({ error: requestError.message }, { status: 500 });
    }

    const { data: admins } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('tipo_usuario', 'admin')
      .in('status', ['active', 'ativo', 'Ativo']);

    if (admins?.length) {
      await supabaseAdmin.from('notificacoes').insert(
        admins.map((admin) => ({
          titulo: 'Nova solicitaÃ§Ã£o de suporte',
          mensagem: `${profile.nome} abriu um chamado de ${categoria}: ${mensagem}`,
          remetente_profile_id: profile.id,
          destinatario_profile_id: admin.id,
          destinatario_tipo: 'admin',
          lida: false
        }))
      );
    }

    return NextResponse.json({ success: true, request: requestData });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao abrir chamado.' }, { status: 500 });
  }
}
