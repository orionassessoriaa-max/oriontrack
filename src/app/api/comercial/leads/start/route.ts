import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/api/security';
import { recordCommercialTimelineEvent } from '@/lib/commercialTimeline';
import { notifyCommercialLeadAssignment } from '@/lib/commercialLeadNotifications';
import { canAssignCommercialResponsible } from '@/lib/comercial';
import { claimCommercialLead } from '@/lib/commercialLeadClaim';

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'Lead obrigatorio.' }, { status: 400 });

  const canAssignAnySdr = guard.isDevOps || canAssignCommercialResponsible(
    guard.commercialRole,
    guard.profile.id,
  );
  const hasRequestedAssignee = Object.prototype.hasOwnProperty.call(body, 'sdr_id');
  const requestedSdrId = body.sdr_id === null || body.sdr_id === '' ? null : String(body.sdr_id || '').trim();

  if (canAssignAnySdr && hasRequestedAssignee) {
    const { data: previousLead, error: previousLeadError } = await supabaseAdmin
      .from('comercial_leads')
      .select('id,sdr_id')
      .eq('id', id)
      .maybeSingle();
    if (previousLeadError) return NextResponse.json({ error: previousLeadError.message }, { status: 500 });
    if (!previousLead) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });

    if (requestedSdrId) {
      // O closer nao entra no rodizio, mas atende quando precisa cobrir um SDR
      // ausente. Aceitar so papel de SDR aqui impedia justamente esse socorro.
      const { data: member, error: memberError } = await supabaseAdmin
        .from('comercial_membros')
        .select('profile_id,papel,ativo')
        .eq('profile_id', requestedSdrId)
        .in('papel', ['sdr', 'closer'])
        .eq('ativo', true)
        .maybeSingle();
      if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });
      if (!member) return NextResponse.json({ error: 'Selecione um SDR ou closer ativo para atribuir o lead.' }, { status: 400 });
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
    if (requestedSdrId && previousLead.sdr_id !== requestedSdrId) {
      try {
        await notifyCommercialLeadAssignment(data);
      } catch (notificationError) {
        console.error('commercial_lead_assignment_notification_failed', notificationError);
      }
    }
    return NextResponse.json({ lead: data, sdr_id: requestedSdrId });
  }

  // Fila comum: o lead novo chega sem dono e quem apertar Start primeiro fica
  // com ele. Ninguem toma lead de ninguem, entao so vale para lead sem dono.
  if (guard.commercialRole !== 'sdr') {
    return NextResponse.json({
      error: 'Apenas SDR assume lead pela fila. A coordenacao atribui pelo seletor.',
    }, { status: 403 });
  }

  const { data: alvo, error: alvoError } = await supabaseAdmin
    .from('comercial_leads')
    .select('id, nome, telefone, sdr_id, faturamento_mensal, investimento')
    .eq('id', id)
    .maybeSingle();
  if (alvoError) return NextResponse.json({ error: alvoError.message }, { status: 500 });
  if (!alvo) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });

  if (alvo.sdr_id && alvo.sdr_id !== guard.profile.id) {
    return NextResponse.json({ error: 'Outro SDR assumiu este lead primeiro.' }, { status: 409 });
  }
  if (alvo.sdr_id === guard.profile.id) {
    return NextResponse.json({ lead: alvo, sdr_id: guard.profile.id });
  }

  // A condicao no update e a trava de corrida: se dois SDRs clicarem no mesmo
  // instante, o segundo nao encontra a linha e recebe o aviso de que perdeu.
  try {
    const result = await claimCommercialLead(id, guard.profile.id, 'fila');
    if (result.status === 'forbidden') return NextResponse.json({ error: 'Apenas SDR ativo assume lead.' }, { status: 403 });
    if (result.status === 'not_found') return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });
    if (result.status === 'conflict') return NextResponse.json({ error: 'Outro SDR assumiu este lead primeiro.' }, { status: 409 });
    if (result.status === 'previous_contact_required') {
      const previousLeadName = result.previousLeadName || 'o lead anterior';
      return NextResponse.json({
        error: `Antes de assumir um novo lead, registre uma tentativa de contato com ${previousLeadName}.`,
        previous_lead_name: result.previousLeadName,
      }, { status: 409 });
    }
    if (result.status === 'already_owned') return NextResponse.json({ lead: { ...alvo, sdr_id: guard.profile.id }, sdr_id: guard.profile.id });
    return NextResponse.json({ lead: result.lead, sdr_id: guard.profile.id, notified: result.notified });
  } catch (error) {
    console.error('commercial_lead_claim_failed', error);
    return NextResponse.json({ error: 'Nao foi possivel assumir o lead.' }, { status: 500 });
  }
}
