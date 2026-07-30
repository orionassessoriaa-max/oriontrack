export function concessionariaKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}

export type BoardCorretor = {
  id: string;
  nome: string | null;
  nome_empresa: string | null;
  gestor_trafego_id?: string | null;
  status?: string | null;
};

export function groupConcessionarias(corretores: BoardCorretor[]) {
  const grouped = new Map<string, { key: string; nome: string; corretor_ids: string[] }>();
  corretores.forEach((corretor) => {
    const nome = String(corretor.nome_empresa || corretor.nome || '').trim();
    const key = concessionariaKey(nome);
    if (!key || !nome) return;
    const current = grouped.get(key);
    if (current) current.corretor_ids.push(corretor.id);
    else grouped.set(key, { key, nome, corretor_ids: [corretor.id] });
  });
  return [...grouped.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
