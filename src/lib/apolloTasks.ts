import type { ApiProfile } from '@/lib/api/security';
import { isDevOpsManagerProfile, isOperationalCoordinatorProfile } from '@/lib/users';

export const APOLLO_ROLES = ['admin', 'gestor_trafego', 'designer', 'account_manager'] as const;
export const APOLLO_TASK_ASSETS_BUCKET = 'apollo-task-assets';
export const APOLLO_TASK_MAX_IMAGE_SIZE = 8 * 1024 * 1024;

export function isActiveApolloProfile(profile: ApiProfile) {
  return APOLLO_ROLES.includes(profile.tipo_usuario as (typeof APOLLO_ROLES)[number]);
}

export function canManageApolloTasks(profile: ApiProfile) {
  if (isDevOpsManagerProfile(profile)) return false;
  return profile.tipo_usuario === 'admin' || isOperationalCoordinatorProfile(profile);
}

export function safeApolloTaskFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'print';
}
