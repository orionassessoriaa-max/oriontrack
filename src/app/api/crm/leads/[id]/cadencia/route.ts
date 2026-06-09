import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

function cadenceDays(startValue?: string | null, endValue?: string | null) {
  if (!startValue) return 0;
  const start = new Date(startValue).getTime();
  const end = endValue ? new Date(endValue).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

async function canAccessLead(profile: any, lead: any) {
  if (profile.tipo_usuario === 'admin') return true;
  if (profile.tipo_usuario === 'corretor_membro') return lead.responsavel_profile_id === profile.id;
  if (profile.tipo_usuario === 'corretor') return lead.corretor_id === profile.corretor_id;
  if (profile.tipo_usuario !== 'corretor_admin') return false;
  if (lead.corretor_id === profile.corretor_id) return true;

  const { data: rows } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa')
    .in('id', [profile.corretor_id, lead.corretor_id].filter(Boolean));

  const own = rows?.find((row) => row.id === profile.corretor_id);
  const target = rows?.find((row) => row.id === lead.corretor_id);
  return Boolean(own?.nome_empresa && own.nome_empresa === target?.nome_empresa);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimit(request, 'crm:lead-cadencia:update', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
    if ('error' in guard) return guard.error;

    const { id } = await context.params;
    const leadId = String(id || '').trim();
    const body = await request.json();
    const action = String(body.action || '').trim();

    if (!leadId || !['start', 'stop'].includes(action)) {
      return NextResponse.json({ error: 'Acao ou lead invalido.' }, { status: 400 });
    }

    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, corretor_id, responsavel_profile_id, cadencia_ativa, cadencia_inicio, cadencia_fim')
      .eq('id', leadId)
      .maybeSingle();

    if (!lead) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });

    if (!(await canAccessLead(guard.profile, lead))) {
      return NextResponse.json({ error: 'Lead fora do seu corretor.' }, { status: 403 });
    }

    const now = new Date().toISOString();
    const updatePayload = action === 'start'
      ? { cadencia_ativa: true, cadencia_inicio: now, cadencia_fim: null, updated_at: now }
      : { cadencia_ativa: false, cadencia_fim: now, updated_at: now };

    const { data: updated, error } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', leadId)
      .select('id, cadencia_ativa, cadencia_inicio, cadencia_fim')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const days = action === 'start' ? 1 : cadenceDays(lead.cadencia_inicio, now);

    await supabaseAdmin.from('lead_atividades').insert([{
      lead_id: leadId,
      profile_id: guard.profile.id,
      tipo: 'sistema',
      titulo: action === 'start' ? 'Cadencia iniciada' : 'Cadencia encerrada',
      descricao: action === 'start'
        ? 'Acompanhamento em cadencia iniciado para este lead.'
        : `Este lead ficou ${days} dia(s) em cadencia.`,
    }]);

    await writeAuditLog(request, guard.profile, {
      action: action === 'start' ? 'lead.cadence.start' : 'lead.cadence.stop',
      entity_type: 'lead',
      entity_id: leadId,
      metadata: { days },
    });

    return NextResponse.json({ success: true, lead: updated, days });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao atualizar cadencia.' }, { status: 500 });
  }
}
