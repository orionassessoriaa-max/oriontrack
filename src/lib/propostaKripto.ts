import { isDevOpsManagerProfile } from "@/lib/users";

/**
 * Quem enxerga a proposta comercial do Kripto.
 *
 * E uma lista curta de proposito, e nao um papel do time: a pagina mostra preco
 * e condicao comercial, entao liberar por "closer" abriria para qualquer closer
 * que entrar depois. Para dar acesso a mais alguem, acrescente o profile_id aqui
 * com o nome no comentario, igual COMMERCIAL_READ_ONLY_MANAGER_IDS faz em
 * src/lib/api/comercial.ts.
 */
export const PROPOSTA_KRIPTO_IDS = new Set([
  "97558b76-425a-42b7-900b-46830f2c28d3", // Leo Comercial (closer)
]);

type PerfilProposta = {
  id?: string | null;
  tipo_usuario?: string | null;
  email?: string | null;
  email_real?: string | null;
  is_admin_master?: boolean | null;
} | null;

export function podeVerPropostaKripto(profile?: PerfilProposta) {
  if (!profile) return false;
  if (isDevOpsManagerProfile(profile)) return true;
  if (String(profile.tipo_usuario) === "admin") return true;
  return Boolean(profile.id && PROPOSTA_KRIPTO_IDS.has(profile.id));
}
