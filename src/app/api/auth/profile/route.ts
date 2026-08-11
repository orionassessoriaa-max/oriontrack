import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const PROFILE_COLUMNS = 'id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, equipe_orion, created_at, telefone';

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 });
  }

  let { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (!profile && user.email) {
    const email = user.email.toLowerCase();
    const fallback = await supabaseAdmin
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .or(`email.eq.${email},email_real.eq.${email}`)
      .maybeSingle();
    profile = fallback.data;
    profileError = fallback.error;
  }

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 404 });
  }

  return NextResponse.json(
    { profile },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
