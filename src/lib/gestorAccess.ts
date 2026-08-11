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

export function resolveActiveGestorId(
  corretor: CorretorLike,
  gestores: GestorProfileLike[]
) {
  const gestoresById = new Set(
    gestores.filter((gestor) => Boolean(gestor.id)).map((gestor) => String(gestor.id))
  );
  const gestoresByName = new Map(
    gestores
      .filter((gestor) => Boolean(gestor.id) && Boolean(normalizeAccessText(gestor.nome)))
      .map((gestor) => [normalizeAccessText(gestor.nome), String(gestor.id)])
  );

  const directId = String(corretor.gestor_trafego_id || '').trim();
  if (directId && gestoresById.has(directId)) return directId;

  const team = Array.isArray(corretor.time_operacional) ? corretor.time_operacional : [];
  for (const rawMember of team) {
    const member = rawMember as { profile_id?: string | null; nome?: string | null };
    const profileId = String(member?.profile_id || '').trim();
    if (profileId && gestoresById.has(profileId)) return profileId;

    const gestorIdByName = gestoresByName.get(normalizeAccessText(member?.nome));
    if (gestorIdByName) return gestorIdByName;
  }

  return null;
}

export function normalizeAccessText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isGestorLinkedToCorretor(corretor: CorretorLike, gestor: GestorProfileLike | null | undefined) {
  if (!gestor?.id) return false;
  return Boolean(corretor.gestor_trafego_id) && corretor.gestor_trafego_id === gestor.id;
}

export function hasConcessionaria(corretor: CorretorLike) {
  return Boolean(String(corretor.nome_empresa || '').trim());
}

export function isGestorLinkedToConcessionariaCorretor(
  corretor: CorretorLike,
  gestor: GestorProfileLike | null | undefined
) {
  return hasConcessionaria(corretor) && isGestorLinkedToCorretor(corretor, gestor);
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
