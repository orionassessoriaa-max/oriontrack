import { Profile } from '@/types';
import { isDevOpsManagerProfile } from '@/lib/users';

export const TEAM_SELECTION_STORAGE_KEY = 'orion:selected_team';
export const DUAL_OPERATION_ACCESS_KEY = 'orion:dual_operation_access';

export type OrionTeamKey = 'apollo' | 'kripto_hunters';

const MULTI_TEAM_PROFILE_IDS = new Set([
  'ba8b0494-9a36-46cf-95eb-5679e6738904', // Matheus Rodrigues
]);

export function hasOperationalWorkspaceAccess(profile?: Profile | null) {
  const operationalRoles = new Set([
    'admin',
    'gestor_trafego',
    'designer',
    'account_manager',
    'corretor',
    'corretor_admin',
  ]);
  if (operationalRoles.has(String(profile?.tipo_usuario || ''))) return true;
  return profile?.tipo_usuario === 'corretor_membro' && Boolean(profile.corretor_id);
}

export function canSelectOperationalTeam(profile?: Profile | null, hasCommercialAccess = false) {
  const name = String(profile?.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isNamedCoordinator = name.includes('pedro') || name.includes('patrick');
  return Boolean(profile?.id && MULTI_TEAM_PROFILE_IDS.has(profile.id))
    || profile?.tipo_usuario === 'admin'
    || isDevOpsManagerProfile(profile)
    || (profile?.tipo_usuario === 'corretor_admin' && isNamedCoordinator)
    || (hasCommercialAccess && hasOperationalWorkspaceAccess(profile));
}

export function getTeamHome(team: OrionTeamKey | string | null) {
  if (team === 'kripto_hunters') return '/comercial';
  return '/admin';
}
