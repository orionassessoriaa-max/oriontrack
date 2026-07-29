import { NextResponse } from 'next/server';
import { requireApiUser, type ApiProfile } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { CommercialRole } from '@/lib/comercial';
import { isDevOpsManagerProfile } from '@/lib/users';

export type CommercialGuard = {
  user: { id: string; email?: string | null };
  profile: ApiProfile;
  commercialRole: CommercialRole;
  canViewCommercialFinancials: boolean;
  canViewMetaInvestment: boolean;
  isDevOps: boolean;
};

export async function requireCommercialUser(
  request: Request,
  coordinatorOnly = false,
): Promise<CommercialGuard | { error: NextResponse }> {
  const baseResult = await requireApiUser(request);
  if (baseResult.error) return { error: baseResult.error };
  let base = { user: baseResult.user, profile: baseResult.profile };
  const isMaster = base.profile.tipo_usuario === 'admin' && Boolean(base.profile.is_admin_master);
  const canViewMetaInvestment = base.profile.tipo_usuario === 'admin'
    || String(base.profile.tipo_usuario) === 'dev'
    || isDevOpsManagerProfile(base.profile);
  const isDevOps = isDevOpsManagerProfile(base.profile);
  const viewProfileId = request.headers.get('x-commercial-view-profile-id') || new URL(request.url).searchParams.get('view_profile_id');

  if (isMaster && viewProfileId && viewProfileId !== base.profile.id) {
    const [{ data: viewMember }, { data: viewProfile }] = await Promise.all([
      supabaseAdmin
        .from('comercial_membros')
        .select('profile_id,papel,ativo')
        .eq('profile_id', viewProfileId)
        .eq('ativo', true)
        .maybeSingle(),
      supabaseAdmin
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, telefone, status, is_admin_master, equipe_orion')
        .eq('id', viewProfileId)
        .maybeSingle(),
    ]);

    if (viewMember?.ativo && viewProfile) {
      base = { ...base, profile: viewProfile as ApiProfile };
    }
  }

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

  const role = (member?.ativo ? member.papel : isMaster || isDevOps ? 'coordenador' : null) as CommercialRole | null;
  if (!role) return { error: NextResponse.json({ error: 'Acesso restrito ao time comercial.' }, { status: 403 }) };
  if (coordinatorOnly && role !== 'coordenador') {
    return { error: NextResponse.json({ error: 'Acao restrita ao coordenador comercial.' }, { status: 403 }) };
  }

  // Acesso financeiro pertence ao coordenador da operacao. Nunca herdar a
  // permissao do admin original quando ele estiver visualizando um integrante.
  const canViewCommercialFinancials = role === 'coordenador';
  return { user: base.user, profile: base.profile, commercialRole: role, canViewCommercialFinancials, canViewMetaInvestment, isDevOps } as CommercialGuard;
}

export function applyCommercialLeadScope<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  role: CommercialRole,
  profileId: string,
) {
  // Cada SDR opera uma carteira isolada. Closer e coordenador permanecem com
  // visao de supervisao sobre o funil inteiro.
  if (role === 'sdr') return query.eq('sdr_id', profileId);
  return query;
}
