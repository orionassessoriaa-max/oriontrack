import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isGestorLinkedToCorretor } from '@/lib/gestorAccess';

async function requireUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, tipo_usuario, corretor_id, nome, email, email_real')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return { error: NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 403 }) };
  }

  return { user, profile };
}

export async function GET(request: Request) {
  const guard = await requireUser(request);
  if ('error' in guard) return guard.error;

  const allowedRoles = ['admin', 'gestor_trafego', 'designer', 'account_manager', 'corretor'];
  if (!allowedRoles.includes(guard.profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let query = supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, email, telefone, gestor_trafego_id, time_operacional, meta_ad_account_id, meta_ad_account_name, operadoras_info, status')
    .order('nome', { ascending: true });

  if (guard.profile.tipo_usuario === 'corretor') {
    query = query.eq('id', guard.profile.corretor_id);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const corretores = guard.profile.tipo_usuario === 'gestor_trafego'
    ? (data || []).filter((corretor) => isGestorLinkedToCorretor(corretor, guard.profile))
    : (data || []);

  return NextResponse.json({ corretores });
}
