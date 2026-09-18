import { supabaseAdmin } from '@/lib/supabase/admin';

export async function assignLeadToNextTeamMember(corretorId: string, leadId: string) {
  const { data: currentLead } = await supabaseAdmin
    .from('leads')
    .select('responsavel_membro_id, responsavel_profile_id')
    .eq('id', leadId)
    .eq('corretor_id', corretorId)
    .maybeSingle();

  if (currentLead?.responsavel_membro_id || currentLead?.responsavel_profile_id) {
    return currentLead.responsavel_membro_id || null;
  }

  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('rodizio_ativo, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  if (broker?.rodizio_ativo === false) return null;

  if (broker?.nome_empresa) {
    const { data: distribution } = await supabaseAdmin
      .from('corretoras')
      .select('distribuicao_modelo')
      .ilike('nome', broker.nome_empresa)
      .maybeSingle();
    if (distribution?.distribuicao_modelo === 'fila_compartilhada') return null;
  }

  const { data: team } = await supabaseAdmin
    .from('corretor_times')
    .select('id')
    .eq('corretor_id', corretorId)
    .eq('ativo', true)
    .maybeSingle();

  if (!team?.id) return null;

  const { data: members } = await supabaseAdmin
    .from('corretor_time_membros')
    .select('id, profile_id, ordem, ultimo_lead_at, created_at')
    .eq('time_id', team.id)
    .in('status', ['active', 'ativo'])
    .not('profile_id', 'is', null)
    .neq('participa_rodizio', false)
    .order('ultimo_lead_at', { ascending: true, nullsFirst: true })
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true });

  if (!members || members.length === 0) return null;

  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const memberIds = members.map((item) => item.id);
  const { data: recentLeads } = await supabaseAdmin
    .from('leads')
    .select('responsavel_membro_id')
    .in('responsavel_membro_id', memberIds)
    .gte('created_at', windowStart)
    .limit(4000);

  const load = new Map(memberIds.map((id) => [id, 0]));
  for (const lead of recentLeads || []) {
    const owner = String(lead.responsavel_membro_id || '');
    if (load.has(owner)) load.set(owner, (load.get(owner) || 0) + 1);
  }

  const member = members.reduce((selected, candidate) => (
    (load.get(candidate.id) || 0) < (load.get(selected.id) || 0) ? candidate : selected
  ), members[0]);
  const now = new Date().toISOString();

  const { error: assignmentError } = await supabaseAdmin
    .from('leads')
    .update({
      responsavel_membro_id: member.id,
      responsavel_profile_id: member.profile_id,
      updated_at: now,
    })
    .eq('id', leadId)
    .eq('corretor_id', corretorId);
  if (assignmentError) throw assignmentError;

  const { error: rotationError } = await supabaseAdmin
    .from('corretor_time_membros')
    .update({ ultimo_lead_at: now })
    .eq('id', member.id);
  if (rotationError) throw rotationError;

  return member.id;
}
