type GestorProfileLike = {
  id?: string | null;
  nome?: string | null;
  email?: string | null;
  email_real?: string | null;
};

type CorretorLike = {
  gestor_trafego_id?: string | null;
  time_operacional?: unknown;
  nome_empresa?: string | null;
};

export function normalizeAccessText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function isGestorLinkedToCorretor(corretor: CorretorLike, gestor: GestorProfileLike | null | undefined) {
  if (!gestor?.id) return false;
  const gestorId = gestor.id;
  if (corretor.gestor_trafego_id === gestorId) return true;

  const team = Array.isArray(corretor.time_operacional) ? corretor.time_operacional : [];
  const gestorName = normalizeAccessText(gestor.nome);
  const gestorEmails = [gestor.email, gestor.email_real].map(normalizeEmail).filter(Boolean);

  return team.some((member: any) => {
    const memberIds = [member?.profile_id, member?.id, member?.user_id].map((value) => String(value || ''));
    const memberName = normalizeAccessText(member?.nome);
    const memberEmails = [member?.email, member?.email_real].map(normalizeEmail).filter(Boolean);

    return memberIds.includes(gestorId)
      || (Boolean(gestorName) && memberName === gestorName)
      || memberEmails.some((email) => gestorEmails.includes(email));
  });
}

export function getGestorConcessionariaNames(corretores: CorretorLike[], gestor: GestorProfileLike | null | undefined) {
  const names = new Set<string>();

  corretores.forEach((corretor) => {
    if (!isGestorLinkedToCorretor(corretor, gestor)) return;
    const name = String(corretor.nome_empresa || '').trim();
    if (name) names.add(normalizeAccessText(name));
  });

  return names;
}
