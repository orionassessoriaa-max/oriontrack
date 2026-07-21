import { Profile } from '@/types';
import { isDevOpsManagerProfile } from '@/lib/users';

export const TEAM_SELECTION_STORAGE_KEY = 'orion:selected_team';

export type OrionTeamKey = 'apollo' | 'kripto_hunters';

export function canSelectOperationalTeam(profile?: Profile | null) {
  const name = String(profile?.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isNamedCoordinator = name.includes('pedro') || name.includes('patrick');
  return profile?.tipo_usuario === 'admin' || isDevOpsManagerProfile(profile) || (profile?.tipo_usuario === 'corretor_admin' && isNamedCoordinator);
}

export function getTeamHome(team: OrionTeamKey | string | null) {
  if (team === 'kripto_hunters') return '/comercial';
  return '/admin';
}
