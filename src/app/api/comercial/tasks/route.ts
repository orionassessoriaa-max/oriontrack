import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  let query = supabaseAdmin.from('comercial_tarefas').select('*').order('status').order('vencimento', { ascending: true, nullsFirst: false }).limit(1000);
  if (guard.commercialRole !== 'coordenador') query = query.eq('responsavel_id', guard.profile.id);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leadIds = Array.from(new Set((data || []).map((task) => task.lead_id).filter(Boolean)));
  const { data: leads } = leadIds.length
    ? await supabaseAdmin.from('comercial_leads').select('id,nome,telefone,status').in('id', leadIds)
    : { data: [] };
  const leadMap = new Map((leads || []).map((lead) => [lead.id, lead]));
  return NextResponse.json({ tasks: (data || []).map((task) => ({ ...task, lead: task.lead_id ? leadMap.get(task.lead_id) || null : null })) });
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const titulo = String(body.titulo || '').trim();
  if (!titulo) return NextResponse.json({ error: 'Titulo obrigatorio.' }, { status: 400 });
  const responsavelId = guard.commercialRole === 'coordenador' ? String(body.responsavel_id || guard.profile.id) : guard.profile.id;
  const { data, error } = await supabaseAdmin.from('comercial_tarefas').insert({
    lead_id: body.lead_id || null,
    responsavel_id: responsavelId,
    titulo,
    descricao: String(body.descricao || '').trim() || null,
    vencimento: body.vencimento || null,
    prioridade: ['baixa', 'normal', 'alta'].includes(body.prioridade) ? body.prioridade : 'normal',
    created_by: guard.profile.id,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'Tarefa obrigatoria.' }, { status: 400 });
  let check = supabaseAdmin.from('comercial_tarefas').select('id,responsavel_id').eq('id', id);
  if (guard.commercialRole !== 'coordenador') check = check.eq('responsavel_id', guard.profile.id);
  const { data: allowed } = await check.maybeSingle();
  if (!allowed) return NextResponse.json({ error: 'Tarefa sem permissao.' }, { status: 403 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of ['status', 'titulo', 'descricao', 'vencimento', 'prioridade', 'responsavel_id']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field];
  }
  const { error } = await supabaseAdmin.from('comercial_tarefas').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

