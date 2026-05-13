export type OrionTeamMember = {
  nome: string;
  cargo: string;
};

export const ORION_TEAM_MEMBERS: OrionTeamMember[] = [
  { nome: 'Ewertton', cargo: 'Gestor de Tráfego' },
  { nome: 'Geovana', cargo: 'Gestora de Tráfego' },
  { nome: 'Lucas', cargo: 'Gestor de Projetos' },
  { nome: 'Patrick', cargo: 'Diretor Operacional' },
  { nome: 'Nataline', cargo: 'Designer' },
];

const TEAM_PHOTOS: Record<string, string> = {
  ewertton: '/fotos/Ewertton.png',
  geovana: '/fotos/Geovana.png',
  lucas: '/fotos/lucas.png',
  patrick: '/fotos/Patrick.png',
  nataline: '/fotos/Nataline.png',
};

export function normalizeTeamMemberName(name?: string | null) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function getTeamMemberPhoto(name?: string | null) {
  return TEAM_PHOTOS[normalizeTeamMemberName(name)] || null;
}

export function isTrafficManagerMember(member: OrionTeamMember) {
  return ['ewertton', 'geovana'].includes(normalizeTeamMemberName(member.nome));
}
