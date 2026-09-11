import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notifyCommercialLeadAssignment } from '@/lib/commercialLeadNotifications';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';

type ContactGateBlock = {
  status: 'previous_contact_required';
  previousLeadId: string | null;
  previousLeadName: string | null;
};

async function contactGateBlockFromError(error: unknown): Promise<ContactGateBlock | null> {
  const databaseError = error as { code?: string; message?: string; details?: string } | null;
  const message = String(databaseError?.message || '');
  if (databaseError?.code !== 'P0001' || !/(?:start bloqueado|tentativa de contato|lead anterior)/i.test(message)) {
    return null;
  }

  const details = String(databaseError.details || '');
  const previousLeadId = details.match(/lead_anterior_id=([0-9a-f-]{36})/i)?.[1] || null;
  let previousLeadName = message.match(/lead anterior\s*\(([^)]+)\)/i)?.[1]?.trim() || null;

  if (previousLeadId) {
    const { data, error: leadError } = await supabaseAdmin
      .from('comercial_leads')
      .select('nome')
      .eq('id', previousLeadId)
      .maybeSingle();
    if (leadError) throw leadError;
    previousLeadName = data?.nome?.trim() || previousLeadName;
  }

  return { status: 'previous_contact_required', previousLeadId, previousLeadName };
}

export async function claimCommercialLead(leadId: string, profileId: string, origin: 'fila' | 'whatsapp_grupo') {
  const { data: member, error: memberError } = await supabaseAdmin.from('comercial_membros')
    .select('profile_id').eq('profile_id', profileId).eq('papel', 'sdr').eq('ativo', true).maybeSingle();
  if (memberError) throw memberError;
  if (!member) return { status: 'forbidden' as const };

  // Uma unica escrita condicional protege disputas entre grupo e CRM, inclusive MQL S.
  const { data: lead, error } = await supabaseAdmin.from('comercial_leads')
    .update({ sdr_id: profileId, updated_at: new Date().toISOString() })
    .eq('id', leadId).is('sdr_id', null).select('*').maybeSingle();
  if (error) {
    const blocked = await contactGateBlockFromError(error);
    if (blocked) return blocked;
    throw error;
  }
  if (!lead) {
    const { data: existing, error: readError } = await supabaseAdmin.from('comercial_leads')
      .select('id,sdr_id').eq('id', leadId).maybeSingle();
    if (readError) throw readError;
    if (!existing) return { status: 'not_found' as const };
    return { status: existing.sdr_id === profileId ? 'already_owned' as const : 'conflict' as const };
  }

  const { data: profile } = await supabaseAdmin.from('profiles').select('nome').eq('id', profileId).maybeSingle();
  await recordCommercialTimelineEvent({
    leadId, actorId: profileId, type: 'sdr_assigned',
    description: `${profile?.nome || 'SDR'} assumiu o lead ${origin === 'whatsapp_grupo' ? 'pelo botao no grupo do WhatsApp' : 'na fila'}.`,
    metadata: { sdr_id: profileId, origem: origin },
  });
  const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: profileId, action: 'commercial.lead.claim',
    entity_type: 'commercial_lead', entity_id: leadId,
    metadata: { sdr_id: profileId, origem: origin },
  });
  if (auditError) console.error('commercial_claim_audit_failed', auditError.message);

  let notified = true;
  try {
    await notifyCommercialLeadAssignment(lead);
  } catch (notificationError) {
    notified = false;
    console.error('commercial_claim_notification_failed', notificationError);
  }
  return { status: 'claimed' as const, lead, notified };
}
