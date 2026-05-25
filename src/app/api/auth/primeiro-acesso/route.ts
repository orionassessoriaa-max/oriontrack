import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, writeAuditLog } from '@/lib/api/security';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'auth:first-access', { limit: 8, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
    }

    const body = await request.json();
    const emailReal = String(body.email_real || '').trim().toLowerCase();
    const senha = String(body.senha || '');

    if (!emailReal || !emailReal.includes('@')) {
      return NextResponse.json({ error: 'Informe um email real válido.' }, { status: 400 });
    }

    if (senha.length < 8) {
      return NextResponse.json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, { status: 400 });
    }

    const { data: profile, error: profileLookupError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, email_real, nome, corretor_id, tipo_usuario, status')
      .eq('id', user.id)
      .maybeSingle();

    if (profileLookupError || !profile) {
      return NextResponse.json({ error: 'Perfil nÃ£o encontrado para concluir o primeiro acesso.' }, { status: 404 });
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: emailReal,
      password: senha,
      email_confirm: true,
      user_metadata: {
        ...user.user_metadata,
        email_real: emailReal,
        primeiro_acesso_concluido: true
      }
    });

    if (updateAuthError) {
      return NextResponse.json({ error: updateAuthError.message }, { status: 400 });
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        email_real: emailReal,
        email: emailReal,
        precisa_trocar_senha: false
      })
      .eq('id', user.id);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (profile.corretor_id && profile.tipo_usuario === 'corretor') {
      await supabaseAdmin
        .from('corretores')
        .update({ email: emailReal })
        .eq('id', profile.corretor_id);
    }

    await writeAuditLog(request, profile as any, {
      action: 'auth.first_access_completed',
      entity_type: 'profile',
      entity_id: user.id,
      metadata: { email_real: emailReal },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao concluir primeiro acesso.' }, { status: 500 });
  }
}
