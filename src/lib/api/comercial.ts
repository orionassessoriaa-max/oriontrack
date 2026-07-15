import { NextResponse } from 'next/server';
import { requireApiUser, type ApiProfile } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { CommercialRole } from '@/lib/comercial';

export type CommercialGuard = {
  user: { id: string; email?: string | null };
  profile: ApiProfile;
  commercialRole: CommercialRole;
};

export async function requireCommercialUser(
  request: Request,
  coordinatorOnly = false,
): Promise<CommercialGuard | { error: NextResponse }> {
  const baseResult = await requireApiUser(request);
  if (baseResult.error) return { error: baseResult.error };
  const base = { user: baseResult.user, profile: baseResult.profile };

  const { data: member, error } = await supabaseAdmin
    .from('comercial_membros')
    .select('papel,ativo')
    .eq('profile_id', base.profile.id)
    .maybeSingle();

  if (error && /comercial_membros|schema cache/i.test(String(error.message || ''))) {
    return {
      error: NextResponse.json(
        { error: 'A estrutura comercial ainda nao foi instalada no banco.', code: 'COMMERCIAL_SCHEMA_MISSING' },
        { status: 503 },
      ),
    };
  }

  const isMaster = base.profile.tipo_usuario === 'admin' && Boolean(base.profile.is_admin_master);
  const role = (member?.ativo ? member.papel : isMaster ? 'coordenador' : null) as CommercialRole | null;
  if (!role) return { error: NextResponse.json({ error: 'Acesso restrito ao time comercial.' }, { status: 403 }) };
  if (coordinatorOnly && role !== 'coordenador') {
    return { error: NextResponse.json({ error: 'Acao restrita ao coordenador comercial.' }, { status: 403 }) };
  }

  return { user: base.user, profile: base.profile, commercialRole: role } as CommercialGuard;
}

export function applyCommercialLeadScope<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  role: CommercialRole,
  profileId: string,
) {
  if (role === 'sdr') return query.eq('sdr_id', profileId);
  if (role === 'closer') return query.eq('closer_id', profileId);
  return query;
}
