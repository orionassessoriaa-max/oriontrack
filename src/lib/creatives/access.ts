import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { isGestorLinkedToConcessionariaCorretor, normalizeAccessText } from '@/lib/gestorAccess';
import type { ApiProfile } from '@/lib/api/security';

export type CreativeCorretor = {
  id: string;
  nome: string;
  nome_empresa: string | null;
  gestor_trafego_id: string | null;
  time_operacional: unknown;
  meta_ad_account_id: string | null;
  status: string | null;
};

export async function getCreativeCorretorScope(profile: ApiProfile, requestedGestorId?: string | null) {
  let gestor: { id: string; nome: string | null; email: string | null; email_real: string | null } | null = null;

  if (profile.tipo_usuario === 'gestor_trafego') {
    gestor = profile;
  } else if (profile.tipo_usuario === 'admin' && requestedGestorId) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real')
      .eq('id', requestedGestorId)
      .eq('tipo_usuario', 'gestor_trafego')
      .maybeSingle();
    gestor = data;
    if (!gestor) return [];
  }

  let query = supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, gestor_trafego_id, time_operacional, meta_ad_account_id, status')
    .order('nome_empresa', { ascending: true });

  if (profile.tipo_usuario === 'corretor' && profile.corretor_id) {
    query = query.eq('id', profile.corretor_id);
  }

  const { data, error } = await query;
  if (error) throw error;

  const corretores = (data || []) as CreativeCorretor[];
  return gestor
    ? corretores.filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, gestor))
    : corretores;
}

export function groupCreativeFolders(corretores: CreativeCorretor[]) {
  const grouped = new Map<string, CreativeCorretor[]>();

  corretores.forEach((corretor) => {
    const name = String(corretor.nome_empresa || '').trim();
    if (!name) return;
    const key = normalizeAccessText(name);
    grouped.set(key, [...(grouped.get(key) || []), corretor]);
  });

  return [...grouped.entries()]
    .map(([key, entries]) => {
      const owner = entries.find((entry) => Boolean(entry.meta_ad_account_id)) || entries[0];
      return {
        id: owner.id,
        key,
        name: String(owner.nome_empresa || owner.nome).trim(),
        corretor_ids: entries.map((entry) => entry.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function canUseCreativeFolder(
  profile: ApiProfile,
  corretorId: string,
  requestedGestorId?: string | null
) {
  const scope = await getCreativeCorretorScope(profile, requestedGestorId);
  return scope.some((corretor) => corretor.id === corretorId);
}
