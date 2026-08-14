import { getProfileRoleLabel } from './users';

export type OrionTeamMember = {
  nome: string;
  cargo: string;
  profile_id?: string;
  foto_url?: string | null;
  tipo_usuario?: string;
  email?: string | null;
  email_real?: string | null;
  is_admin_master?: boolean | null;
};

export const ORION_TEAM_MEMBERS: OrionTeamMember[] = [
  { nome: 'Ewertton', cargo: 'Gestor de Tráfego' },
  { nome: 'Geovana', cargo: 'Gestora de Tráfego' },
  { nome: 'Lucas', cargo: 'Coordenador Operacional' },
  { nome: 'Patrick', cargo: 'Coordenador Operacional' },
  { nome: 'Nataline', cargo: 'Gestora de Tráfego' },
];
// ...
const TEAM_PHOTOS: Record<string, string> = {
  ewertton: '/fotos/EWERTTON DEVOPS.png',
  geovana: '/fotos/GEOVANNA GESTORA.png',
  geovanna: '/fotos/GEOVANNA GESTORA.png',
  lucas: '/fotos/LUCAS ACOOUNT.png',
  patrick: '/fotos/PATRICK ADMIN.png',
  nataline: '/fotos/NATALINE DESIGNER.png',
  matheus: '/fotos/MATHEUS GESTOR.png',
  pedro: '/fotos/PEDRO ADMIN.png',
  leo: '/fotos/LÉO CLOSER.png',
  renan: '/fotos/RENAN SDR.png',
};

export function normalizeTeamMemberName(name?: string | null) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function getTeamMemberPhoto(name?: string | null) {
  const normName = normalizeTeamMemberName(name);
  for (const key of Object.keys(TEAM_PHOTOS)) {
    if (normName.includes(key)) {
      return TEAM_PHOTOS[key];
    }
  }
  return null;
}

export function isTrafficManagerMember(member: OrionTeamMember) {
  return member.cargo.toLowerCase().includes('tráfego') || ['ewertton', 'geovana', 'geovanna', 'nataline'].includes(normalizeTeamMemberName(member.nome));
}

export function getTeamMemberAvatar(member: OrionTeamMember) {
  return member.foto_url || getTeamMemberPhoto(member.nome);
}

function roleToCargo(role?: string | null) {
  if (role === 'gestor_trafego') return 'Gestor de Tráfego';
  if (role === 'designer') return 'Designer';
  if (role === 'account_manager') return 'Account Manager';
  if (role === 'admin') return 'Admin Orion';
  return 'Time Orion';
}

export function buildOperationalTeamMembers(
  profiles: Array<{ id: string; nome: string; tipo_usuario: string; foto_url?: string | null; status?: string | null; email?: string | null; email_real?: string | null; is_admin_master?: boolean | null }>
) {
  const activeProfiles = profiles
    .filter((profile) => ['active', 'ativo', 'Ativo'].includes(String(profile.status || 'active')))
    .filter((profile) => ['gestor_trafego', 'designer', 'account_manager', 'admin'].includes(profile.tipo_usuario));

  if (activeProfiles.length === 0) return ORION_TEAM_MEMBERS;

  return activeProfiles
    .sort((a, b) => {
      const order = ['gestor_trafego', 'account_manager', 'designer', 'admin'];
      return order.indexOf(a.tipo_usuario) - order.indexOf(b.tipo_usuario) || a.nome.localeCompare(b.nome);
    })
    .map((profile) => {
      const isPatrick = profile.nome.toLowerCase().includes('patrick');
      return {
        nome: profile.nome,
        cargo: isPatrick ? 'Coordenador Operacional' : getProfileRoleLabel(profile),
        profile_id: profile.id,
        foto_url: profile.foto_url || null,
        tipo_usuario: profile.tipo_usuario,
        email: profile.email || null,
        email_real: profile.email_real || null,
        is_admin_master: profile.is_admin_master || null,
      };
    });
}
