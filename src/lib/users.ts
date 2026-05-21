import { UserRole } from '@/types';

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
