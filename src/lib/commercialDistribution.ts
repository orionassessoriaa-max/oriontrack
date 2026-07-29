import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';

export async function assignNextCommercialSdr() {
  const { data, error } = await supabaseAdmin.rpc('assign_next_commercial_sdr');
  if (!error) return String(data || '').trim() || null;

  if (!/assign_next_commercial_sdr|schema cache|function/i.test(String(error.message || ''))) {
    throw error;
  }

  // Compatibilidade durante o primeiro deploy, antes de a migration entrar:
  // escolhe o SDR ativo com menos leads. A funcao SQL assume no deploy seguinte
  // e passa a garantir a ordem atomica.
  const { data: members, error: memberError } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id')
    .eq('papel', 'sdr')
    .eq('ativo', true)
    .order('created_at', { ascending: true });
  if (memberError) throw memberError;
  if (!members?.length) return null;

  const ids = members.map((member) => member.profile_id);
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
