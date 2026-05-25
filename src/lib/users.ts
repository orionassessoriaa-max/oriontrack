import { UserRole } from '@/types';

export const DEVOPS_MANAGER_EMAIL = 'ewerttonherculano@gmail.com';

export function slugifyNameForEmail(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('')
    .toLowerCase();
}

export function generateOrionEmail(name: string) {
  const slug = slugifyNameForEmail(name);
  return `${slug || 'usuario'}@orion.com`;
}

export function generateStrongPassword(length = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const numbers = '23456789';
  const symbols = '!@#$%*?';
  const all = upper + lower + numbers + symbols;
  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  while (required.length < length) {
    required.push(all[Math.floor(Math.random() * all.length)]);
  }

  return required.sort(() => Math.random() - 0.5).join('');
}

export function getRoleLabel(role: UserRole) {
  if (role === 'admin') return 'Admin';
  if (role === 'gestor_trafego') return 'Gestor de tráfego';
  if (role === 'designer') return 'Designer';
  if (role === 'account_manager') return 'Account manager';
  if (role === 'corretor_membro') return 'Equipe do corretor';
  return 'Corretor';
}

export function isDevOpsManagerProfile(profile?: {
  email?: string | null;
  email_real?: string | null;
  is_admin_master?: boolean | null;
} | null) {
  const emails = [profile?.email, profile?.email_real]
    .filter(Boolean)
    .map((email) => String(email).toLowerCase().trim());
  return Boolean(profile?.is_admin_master) || emails.includes(DEVOPS_MANAGER_EMAIL);
}

export function getProfileRoleLabel(profile?: {
  tipo_usuario?: UserRole | string | null;
  email?: string | null;
  email_real?: string | null;
  is_admin_master?: boolean | null;
} | null) {
  if (isDevOpsManagerProfile(profile)) return 'DevOps Manager';
  return getRoleLabel((profile?.tipo_usuario || 'corretor') as UserRole);
}
