import { NextResponse } from 'next/server';
import { type ApiProfile, rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

const CRM_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro'] as const;
const NOTE_MAX_LENGTH = 4000;

type LeadAccessRow = {
  id: string;
  corretor_id: string | null;
  responsavel_profile_id: string | null;
};

async function canAccessLead(profile: ApiProfile, lead: LeadAccessRow) {
  if (profile.tipo_usuario === 'admin') return true;
  if (profile.tipo_usuario === 'corretor_membro') return lead.responsavel_profile_id === profile.id;
  if (!['corretor', 'corretor_admin'].includes(profile.tipo_usuario)) return false;
  if (lead.corretor_id === profile.corretor_id) return true;

  const { data: rows } = await supabaseAdmin
    .from('corretores')
    .select('id,nome_empresa')
    .in('id', [profile.corretor_id, lead.corretor_id].filter(Boolean));

  const own = rows?.find((row) => row.id === profile.corretor_id);
  const target = rows?.find((row) => row.id === lead.corretor_id);
  return Boolean(own?.nome_empresa && own.nome_empresa === target?.nome_empresa);
}

async function getAllowedLead(id: string, profile: ApiProfile) {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id,corretor_id,responsavel_profile_id')
    .eq('id', id)
    .maybeSingle();

  if (!lead || !(await canAccessLead(profile, lead))) return null;
  return lead;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireApiUser(request, [...CRM_ROLES]);
  if ('error' in guard) return guard.error;

  const { id } = await context.params;
  const leadId = String(id || '').trim();
  if (!leadId) return NextResponse.json({ error: 'Lead invalido.' }, { status: 400 });
  if (!await getAllowedLead(leadId, guard.profile)) {
    return NextResponse.json({ error: 'Acesso negado para este lead.' }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from('lead_atividades')
    .select('id,lead_id,profile_id,tipo,titulo,descricao,created_at,profiles:profile_id(nome)')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activities: data || [] });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, 'crm:lead-activity:create', { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const guard = await requireApiUser(request, [...CRM_ROLES]);
  if ('error' in guard) return guard.error;

  const { id } = await context.params;
  const leadId = String(id || '').trim();
  const body = await request.json().catch(() => ({}));
  const descricao = String(body.descricao || '').trim();

  if (!leadId) return NextResponse.json({ error: 'Lead invalido.' }, { status: 400 });
  if (!descricao) return NextResponse.json({ error: 'Digite uma observacao.' }, { status: 400 });
  if (descricao.length > NOTE_MAX_LENGTH) {
    return NextResponse.json({ error: `A observacao deve ter no maximo ${NOTE_MAX_LENGTH} caracteres.` }, { status: 400 });
  }
  if (!await getAllowedLead(leadId, guard.profile)) {
    return NextResponse.json({ error: 'Acesso negado para este lead.' }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from('lead_atividades')
    .insert({
      lead_id: leadId,
      profile_id: guard.profile.id,
      tipo: 'nota',
      titulo: 'Observacao registrada',
      descricao,
    })
    .select('id,lead_id,profile_id,tipo,titulo,descricao,created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const activity = {
    ...data,
    profiles: guard.profile.nome ? { nome: guard.profile.nome } : null,
  };

  await writeAuditLog(request, guard.profile, {
    action: 'lead.activity.create',
    entity_type: 'lead',
    entity_id: leadId,
    metadata: { activity_id: data.id, tipo: 'nota' },
  });

  return NextResponse.json({ activity }, { status: 201 });
}
