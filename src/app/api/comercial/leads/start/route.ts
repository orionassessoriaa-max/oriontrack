import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/api/security';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'Lead obrigatorio.' }, { status: 400 });

  const canAssignAnySdr = guard.isDevOps || guard.commercialRole === 'coordenador';
  const hasRequestedAssignee = Object.prototype.hasOwnProperty.call(body, 'sdr_id');
  const requestedSdrId = body.sdr_id === null || body.sdr_id === '' ? null : String(body.sdr_id || '').trim();

  if (canAssignAnySdr && hasRequestedAssignee) {
    if (requestedSdrId) {
      const { data: member, error: memberError } = await supabaseAdmin
        .from('comercial_membros')
        .select('profile_id,papel,ativo')
        .eq('profile_id', requestedSdrId)
        .eq('papel', 'sdr')
        .eq('ativo', true)
        .maybeSingle();
      if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });
      if (!member) return NextResponse.json({ error: 'Selecione um SDR ativo para atribuir o lead.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('comercial_leads')
      .update({ sdr_id: requestedSdrId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });

    await writeAuditLog(request, guard.profile, {
      action: requestedSdrId ? 'commercial.lead.assign_sdr' : 'commercial.lead.unassign_sdr',
      entity_type: 'commercial_lead',
      entity_id: id,
      metadata: { sdr_id: requestedSdrId },
    });
    const { data: assignedProfile } = requestedSdrId
      ? await supabaseAdmin.from('profiles').select('nome').eq('id', requestedSdrId).maybeSingle()
      : { data: null };
    await recordCommercialTimelineEvent({
      leadId: id,
      actorId: guard.profile.id,
      type: requestedSdrId ? 'sdr_assigned' : 'sdr_unassigned',
      description: requestedSdrId
        ? `${guard.profile.nome || 'Equipe comercial'} atribuiu o SDR ${assignedProfile?.nome || 'selecionado'}.`
        : `${guard.profile.nome || 'Equipe comercial'} removeu o SDR responsavel.`,
      metadata: { sdr_id: requestedSdrId },
    });
    return NextResponse.json({ lead: data, sdr_id: requestedSdrId });
  }

  return NextResponse.json({
    error: 'A atribuicao e feita pelo rodizio. Somente coordenadores podem alterar o responsavel.',
  }, { status: 403 });
}
