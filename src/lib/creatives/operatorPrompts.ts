export type CreativeOperatorProfile = 'empresarial_3_vidas' | 'amil_2_vidas' | 'medsenior_49' | 'generico';

function normalizeOperator(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function creativeOperatorProfile(operadora: string): CreativeOperatorProfile {
  const normalized = normalizeOperator(operadora);
  if (['sulamerica', 'sul america', 'bradesco', 'porto', 'porto seguro'].some((name) => normalized.includes(name))) {
    return 'empresarial_3_vidas';
  }
  if (normalized.includes('amil')) return 'amil_2_vidas';
  if (normalized.includes('medsenior') || normalized.includes('med senior')) return 'medsenior_49';
  return 'generico';
}

export function getDefaultCreativePrompt(operadora: string) {
  const operatorName = String(operadora || 'a operadora').trim();
  const shared = `Crie anúncios de plano de saúde para ${operatorName} com visual premium, limpo e de leitura imediata no celular. Use somente uma headline curta e, quando necessário, uma linha curta de apoio. Evite excesso de texto, selos, listas e elementos competindo entre si. A copy deve ser convincente, direta e voltada à geração de leads qualificados, sem inventar preço, percentual de economia, cobertura, rede, carência ou garantia de redução.`;

  switch (creativeOperatorProfile(operadora)) {
    case 'empresarial_3_vidas':
      return `${shared}\n\nPúblico obrigatório: empresas com CNPJ ou MEI e a partir de 3 vidas. O ângulo principal deve ser redução de custo no plano de saúde empresarial. A headline precisa deixar claro, de forma natural, que a oportunidade é para CNPJ e grupos a partir de 3 vidas, ajudando a afastar contatos fora desse perfil. Use chamadas como comparar o plano atual, verificar possibilidade de pagar menos ou reduzir custos sem prometer economia garantida.`;
    case 'amil_2_vidas':
      return `${shared}\n\nPúblico obrigatório: empresas com CNPJ ou MEI e a partir de 2 vidas. O ângulo principal deve ser redução de custo no plano de saúde empresarial. A headline precisa comunicar CNPJ e a partir de 2 vidas de forma simples e chamativa. Convide o público a comparar o plano atual e verificar oportunidades de redução, sem prometer economia garantida.`;
    case 'medsenior_49':
      return `${shared}\n\nPúblico obrigatório: pessoas a partir de 49 anos. Converse com o público maduro com respeito, clareza, confiança e boa legibilidade, sem infantilizar. O ângulo principal deve ser redução de custo e cuidado adequado a esta fase da vida. Não mencione CNPJ, MEI ou quantidade mínima de vidas. Mostre adultos maduros brasileiros ativos e autênticos, evitando estereótipos de fragilidade.`;
    default:
      return `${shared}\n\nAdapte a mensagem ao público descrito pelo gestor. Quando faltarem critérios de qualificação, use uma chamada consultiva para comparar alternativas e verificar oportunidades de redução, sem criar requisitos ou benefícios não informados.`;
  }
}

function comparable(value: string) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

export function mergeCreativeBriefing(operadora: string, savedPrompt?: string | null, additionalBriefing?: string | null) {
  const base = String(savedPrompt || '').trim() || getDefaultCreativePrompt(operadora);
  const additional = String(additionalBriefing || '').trim();
  if (!additional || comparable(additional) === comparable(base) || comparable(additional).includes(comparable(base))) {
    return additional || base;
  }
  return `${base}\n\nAJUSTES ADICIONAIS DO GESTOR:\n${additional}`;
}
