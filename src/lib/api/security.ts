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
  telefone?: string | null;
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
    .select('id, email, email_real, nome, tipo_usuario, corretor_id, telefone, status, is_admin_master, equipe_orion')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError && String(profileError.message || '').includes('equipe_orion')) {
    const fallback = await supabaseAdmin
      .from('profiles')
      .select('id, email, email_real, nome, tipo_usuario, corretor_id, telefone, status, is_admin_master')
      .eq('id', user.id)
      .maybeSingle();
    profile = fallback.data ? { ...fallback.data, equipe_orion: null } : null;
    profileError = fallback.error;
  }

  if (!profile) {
    const email = String(user.email || '').toLowerCase();
    if (email) {
      const byAccessEmail = await supabaseAdmin
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, telefone, status, is_admin_master')
        .or(`email.eq.${email},email_real.eq.${email}`)
        .maybeSingle();
      if (byAccessEmail.data) {
        profile = { ...byAccessEmail.data, equipe_orion: null };
      }
    }
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

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  limit: number;
  windowMs: number;
  key?: string;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
let lastRateLimitCleanup = 0;

function cleanupRateLimitBuckets(now: number) {
  if (now - lastRateLimitCleanup < 60_000) return;
  lastRateLimitCleanup = now;

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

export function rateLimit(request: Request, scope: string, options: RateLimitOptions) {
  const now = Date.now();
  cleanupRateLimitBuckets(now);

  const ip = getClientIp(request) || 'unknown-ip';
  const userAgent = request.headers.get('user-agent') || 'unknown-agent';
  const identity = options.key || `${ip}:${userAgent.slice(0, 120)}`;
  const key = `${scope}:${identity}`;
  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  if (current.count >= options.limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { error: 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
        },
      }
    );
  }

  current.count += 1;
  rateLimitBuckets.set(key, current);
  return null;
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
