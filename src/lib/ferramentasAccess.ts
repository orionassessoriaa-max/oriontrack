type FerramentasPreviewProfile = {
  nome?: string | null;
  email?: string | null;
  email_real?: string | null;
  nome_empresa?: string | null;
};

function normalizeText(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function canUseFerramentasPreview(profile?: FerramentasPreviewProfile | null) {
  if (!profile) return false;

  const name = normalizeText(profile.nome);
  const email = normalizeText(profile.email_real || profile.email);
  const company = normalizeText(profile.nome_empresa);

  const isSilva =
    name.includes('silva corretor') ||
    email.includes('silvacorretor') ||
    email.includes('silva.corretor');

  const isOrionTest =
    company.includes('orion corretora') ||
    company.includes('orion teste');

  return isSilva && isOrionTest;
}
