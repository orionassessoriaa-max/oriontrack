import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { CommercialMqlLevel } from '@/lib/commercialQualification';

/**
 * Escolhe quem recebe o proximo lead.
 *
 * O nivel importa porque um membro pode estar limitado a um nivel: o Leo entra
 * no rodizio, mas so nos leads S. Quem nao tem limite recebe qualquer um.
 */
export async function assignNextCommercialSdr(nivel?: CommercialMqlLevel | null) {
  const { data, error } = await supabaseAdmin.rpc('assign_next_commercial_sdr', { p_nivel: nivel || null });
  if (!error) return String(data || '').trim() || null;

  if (!/assign_next_commercial_sdr|schema cache|function/i.test(String(error.message || ''))) {
    throw error;
  }

  // Compatibilidade durante o primeiro deploy, antes de a migration entrar:
  // escolhe o SDR ativo com menos leads. A funcao SQL assume no deploy seguinte
  // e passa a garantir a ordem atomica.
  const { data: members, error: memberError } = await supabaseAdmin
    .from('comercial_membros')
    .select('*')
    .eq('ativo', true)
    .order('created_at', { ascending: true });
  if (memberError) throw memberError;

  const elegiveis = (members || []).filter((member) => {
    if (member.distribuicao_ativa === false) return false;
    if (member.distribuicao_ativa === undefined && member.papel !== 'sdr') return false;
    const limite = member.recebe_apenas_mql;
    return !limite || limite === nivel;
  });
  if (!elegiveis.length) return null;

  const ids = elegiveis.map((member) => member.profile_id);
  const { data: leads, error: leadError } = await supabaseAdmin
    .from('comercial_leads')
    .select('sdr_id')
    .in('sdr_id', ids);
  if (leadError) throw leadError;
  const totals = new Map(ids.map((id) => [id, 0]));
  for (const lead of leads || []) {
    if (lead.sdr_id) totals.set(lead.sdr_id, (totals.get(lead.sdr_id) || 0) + 1);
  }
  return ids.sort((a, b) => (totals.get(a) || 0) - (totals.get(b) || 0))[0] || null;
}
