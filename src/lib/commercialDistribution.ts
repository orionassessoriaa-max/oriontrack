import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { CommercialMqlLevel } from '@/lib/commercialQualification';

/**
 * Escolhe quem recebe o proximo lead.
 *
 * O nivel importa porque um membro pode estar limitado a um nivel: o Leo entra
 * no rodizio, mas so nos leads S. Quem nao tem limite recebe qualquer um.
 */
/**
 * Dono automatico do lead novo.
 *
 * O lead comum nao tem mais dono na entrada: fica na fila comum, visivel para
 * todos os SDRs, e quem aperta Start primeiro fica com ele. So o nivel com dono
 * fixo escapa disso, que hoje e o S do Leo, configurado em
 * comercial_membros.recebe_apenas_mql.
 */
export async function donoAutomaticoDoLead(nivel?: CommercialMqlLevel | null) {
  if (!nivel) return null;
  const { data, error } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id, ativo, distribuicao_ativa, recebe_apenas_mql')
    .eq('recebe_apenas_mql', nivel)
    .eq('ativo', true);
  if (error) {
    // Antes da migration a coluna nao existe: sem dono fixo, cai na fila comum.
    if (/recebe_apenas_mql|column|schema cache/i.test(String(error.message || ''))) return null;
    throw error;
  }
  const elegivel = (data || []).find((membro) => membro.distribuicao_ativa !== false);
  return elegivel ? String(elegivel.profile_id) : null;
}

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
