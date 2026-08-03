import { supabaseAdmin } from '@/lib/supabase/admin';

export type CommercialTimelineEvent = {
  leadId: string;
  actorId?: string | null;
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
};

export async function recordCommercialTimelineEvent(event: CommercialTimelineEvent) {
  const { error } = await supabaseAdmin.from('comercial_lead_interacoes').insert({
    lead_id: event.leadId,
    autor_id: event.actorId || null,
    comentario: event.description,
    tipo: event.type,
    metadata: event.metadata || {},
  });

  // A timeline complementa a operacao, mas nunca pode impedir uma mudanca no lead.
  if (error) console.error('commercial_timeline_event_failed', error.message);
}

