import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { buildSemInterestReportPdf, type SemInterestReportRow } from '@/lib/semInterestReportPdf';
import { supabaseAdmin } from '@/lib/supabase/admin';

const CRM_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro'] as const;
const DANILO_PROFILE_ID = 'e1db6a41-8395-4c7d-b92d-70642f26edc0';

type LeadRow = {
  id: string;
  nome: string | null;
  corretor_id: string | null;
  responsavel_profile_id: string | null;
  sem_interesse_motivo: string | null;
  observacoes: string | null;
  updated_at: string | null;
};

function reasonFromDescription(value: string | null) {
  const match = String(value || '').match(/Motivo:\s*([^\.]+)(?:\.|$)/i);
  return match?.[1]?.trim() || null;
}

function reasonFromObservations(value: string | null) {
  const match = String(value || '').match(/Motivo de sem interesse:\s*([^|]+)/i);
  return match?.[1]?.trim() || null;
}

export async function GET(request: Request) {
  const limited = rateLimit(request, 'crm:report:sem-interesse', { limit: 8, windowMs: 60_000 });
  if (limited) return limited;

  const guard = await requireApiUser(request, [...CRM_ROLES]);
  if ('error' in guard) return guard.error;

  const { profile } = guard;
  if (profile.id !== DANILO_PROFILE_ID) {
    return NextResponse.json({ error: 'Este relatorio esta disponivel somente para Danilo.' }, { status: 403 });
  }
  let brokerIds: string[] | null = null;
  if (profile.tipo_usuario === 'corretor' || profile.tipo_usuario === 'corretor_admin') {
    if (!profile.corretor_id) return NextResponse.json({ error: 'Corretor do usuario nao encontrado.' }, { status: 400 });
    const { data: ownBroker, error: ownBrokerError } = await supabaseAdmin
      .from('corretores').select('id,nome_empresa').eq('id', profile.corretor_id).maybeSingle();
    if (ownBrokerError) return NextResponse.json({ error: ownBrokerError.message }, { status: 500 });
    if (ownBroker?.nome_empresa) {
      const { data: siblings, error: siblingsError } = await supabaseAdmin
        .from('corretores').select('id').eq('nome_empresa', ownBroker.nome_empresa);
      if (siblingsError) return NextResponse.json({ error: siblingsError.message }, { status: 500 });
      brokerIds = (siblings || []).map((broker) => broker.id);
    } else {
      brokerIds = [profile.corretor_id];
    }
  }

  let leadsQuery = supabaseAdmin
    .from('leads')
    .select('id,nome,corretor_id,responsavel_profile_id,sem_interesse_motivo,observacoes,updated_at')
    .eq('status', 'Sem interesse')
    .order('updated_at', { ascending: false });
  if (brokerIds?.length) leadsQuery = leadsQuery.in('corretor_id', brokerIds);
  if (profile.tipo_usuario === 'corretor_membro') {
    leadsQuery = leadsQuery.or(`responsavel_profile_id.eq.${profile.id},responsavel_profile_id.is.null`);
  }
  const { data: leadsData, error: leadsError } = await leadsQuery;
  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });
  const leads = (leadsData || []) as LeadRow[];
  const leadIds = leads.map((lead) => lead.id);

  const activitiesByLead = new Map<string, { profile_id: string | null; descricao: string | null; created_at: string | null }>();
  if (leadIds.length) {
    const { data: activities, error: activitiesError } = await supabaseAdmin
      .from('lead_atividades')
      .select('lead_id,profile_id,descricao,created_at')
      .in('lead_id', leadIds)
      .eq('tipo', 'status')
      .ilike('descricao', '%Sem interesse%')
      .order('created_at', { ascending: false });
    if (activitiesError) return NextResponse.json({ error: activitiesError.message }, { status: 500 });
    for (const activity of activities || []) {
      if (!activitiesByLead.has(activity.lead_id)) activitiesByLead.set(activity.lead_id, activity);
    }
  }

  const profileIds = [...new Set([
    ...leads.map((lead) => lead.responsavel_profile_id),
    ...[...activitiesByLead.values()].map((activity) => activity.profile_id),
  ].filter((id): id is string => Boolean(id)))];
  const profileNames = new Map<string, string>();
  if (profileIds.length) {
    const { data: profiles, error: profilesError } = await supabaseAdmin.from('profiles').select('id,nome').in('id', profileIds);
    if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });
    for (const item of profiles || []) if (item.nome) profileNames.set(item.id, item.nome);
  }

  const rows: SemInterestReportRow[] = leads.map((lead) => {
    const activity = activitiesByLead.get(lead.id);
    return {
      name: lead.nome || 'Lead sem nome',
      markedAt: activity?.created_at || lead.updated_at,
      reason: lead.sem_interesse_motivo || reasonFromDescription(activity?.descricao || null) || reasonFromObservations(lead.observacoes),
      responsible: (activity?.profile_id && profileNames.get(activity.profile_id)) || (lead.responsavel_profile_id && profileNames.get(lead.responsavel_profile_id)) || null,
    };
  });
  const pdf = await buildSemInterestReportPdf(rows);
  await writeAuditLog(request, profile, {
    action: 'crm.report.sem_interesse.download', entity_type: 'lead', metadata: { total_leads: rows.length },
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="relatorio-leads-sem-interesse.pdf"',
      'Cache-Control': 'no-store',
    },
  });
}
