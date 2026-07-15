import { Profile } from '@/types';
import { isDevOpsManagerProfile } from '@/lib/users';

export const TEAM_SELECTION_STORAGE_KEY = 'orion:selected_team';

export type OrionTeamKey = 'apollo' | 'kripto_hunters';

export function canSelectOperationalTeam(profile?: Profile | null) {
  return profile?.tipo_usuario === 'admin' || isDevOpsManagerProfile(profile);
}

export function getTeamHome(team: OrionTeamKey | string | null) {
  if (team === 'kripto_hunters') return '/comercial';
  return '/admin';
}
