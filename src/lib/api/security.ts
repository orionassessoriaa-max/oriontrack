import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { UserRole } from '@/types';

export type ApiProfile = {
  id: string;
  email: string | null;
  email_real: string | null;
  nome: string | null;
  tipo_usuario: UserRole;
  corretor_id: string | null;
  status: string | null;
  is_admin_master?: boolean | null;
  equipe_orion?: 'apollo' | 'kripto_hunters' | null;
};

export type ApiGuard = {
  user: { id: string; email?: string | null };
  profile: ApiProfile;
};

export function forbidden(message = 'Acesso negado.') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function requireApiUser(request: Request, allowedRoles?: UserRole[]) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  let { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, is_admin_master, equipe_orion')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError && String(profileError.message || '').includes('equipe_orion')) {
    const fallback = await supabaseAdmin
      .from('profiles')
      .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, is_admin_master')
      .eq('id', user.id)
      .maybeSingle();
    profile = fallback.data ? { ...fallback.data, equipe_orion: null } : null;
    profileError = fallback.error;
  }

  if (!profile) {
    return { error: NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 404 }) };
  }

  const normalizedStatus = String(profile.status || '').toLowerCase();
  if (normalizedStatus && !['active', 'ativo'].includes(normalizedStatus)) {
    return { error: NextResponse.json({ error: 'Usuario inativo.' }, { status: 403 }) };
  }

  if (allowedRoles?.length && !allowedRoles.includes(profile.tipo_usuario as UserRole)) {
    return { error: forbidden() };
  }

  return { user, profile: profile as ApiProfile };
}

export function canManageAdminUsers(profile: ApiProfile) {
  return profile.tipo_usuario === 'admin' && Boolean(profile.is_admin_master);
}

export function getClientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null;
}

export async function writeAuditLog(
  request: Request,
  actor: ApiProfile | null,
  input: {
    action: string;
    entity_type?: string;
    entity_id?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  try {
    await supabaseAdmin.from('audit_logs').insert([{
      actor_profile_id: actor?.id || null,
      actor_email: actor?.email_real || actor?.email || null,
      actor_role: actor?.tipo_usuario || null,
      action: input.action,
      entity_type: input.entity_type || null,
      entity_id: input.entity_id || null,
      metadata: input.metadata || {},
      ip_address: getClientIp(request),
      user_agent: request.headers.get('user-agent'),
    }]);
  } catch (error) {
    console.error('audit_log_failed', error);
  }
}
