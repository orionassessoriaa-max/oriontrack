import { NextResponse } from 'next/server';
import { requireCommercialUser, applyCommercialLeadScope } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;

  let leadsQuery = supabaseAdmin
    .from('comercial_leads')
    .select('id,nome,telefone,email,status,empresa,data_entrada,updated_at,sdr_id,closer_id,observacoes,utm_source,utm_campaign')
    .order('data_entrada', { ascending: false })
    .limit(2000);
  if (guard.commercialRole !== 'coordenador') leadsQuery = applyCommercialLeadScope(leadsQuery, guard.commercialRole, guard.profile.id);
  const { data: leads, error: leadsError } = await leadsQuery;
  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });

  const leadIds = (leads || []).map((lead) => lead.id);
  if (!leadIds.length) return NextResponse.json({ leads: [], interactions: [], tasks: [], profiles: [] });

  const [{ data: interactions, error: interactionsError }, { data: tasks, error: tasksError }] = await Promise.all([
    supabaseAdmin.from('comercial_lead_interacoes').select('id,lead_id,autor_id,comentario,anexo_url,anexo_nome,created_at').in('lead_id', leadIds).order('created_at', { ascending: false }).limit(4000),
    supabaseAdmin.from('comercial_tarefas').select('id,lead_id,responsavel_id,titulo,descricao,vencimento,status,prioridade,created_at,updated_at').in('lead_id', leadIds).order('created_at', { ascending: false }).limit(4000),
  ]);
  if (interactionsError) return NextResponse.json({ error: interactionsError.message }, { status: 500 });
  if (tasksError) return NextResponse.json({ error: tasksError.message }, { status: 500 });

  const profileIds = Array.from(new Set([
    ...(leads || []).flatMap((lead) => [lead.sdr_id, lead.closer_id]),
    ...(interactions || []).map((item) => item.autor_id),
    ...(tasks || []).map((item) => item.responsavel_id),
  ].filter(Boolean)));
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabaseAdmin.from('profiles').select('id,nome,email').in('id', profileIds)
    : { data: [], error: null };
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  return NextResponse.json({ leads: leads || [], interactions: interactions || [], tasks: tasks || [], profiles: profiles || [] });
}
