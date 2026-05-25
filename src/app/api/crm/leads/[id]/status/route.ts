import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { LEAD_STATUSES } from '@/lib/leadStatus';
import { LeadStatus } from '@/types';

const ALLOWED_STATUSES = LEAD_STATUSES;

function numericOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimit(request, 'crm:lead-status:update', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_membro']);
    if ('error' in guard) return guard.error;

    const { id } = await context.params;
    const leadId = String(id || '').trim();
    const body = await request.json();
    const status = String(body.status || '') as LeadStatus;

    if (!leadId || !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Status ou lead invalido.' }, { status: 400 });
    }

    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, corretor_id, responsavel_profile_id')
      .eq('id', leadId)
      .maybeSingle();

    if (!lead) {
      return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });
    }

    if (guard.profile.tipo_usuario === 'corretor' && lead.corretor_id !== guard.profile.corretor_id) {
      return NextResponse.json({ error: 'Lead fora do seu corretor.' }, { status: 403 });
    }

    if (guard.profile.tipo_usuario === 'corretor_membro' && lead.responsavel_profile_id !== guard.profile.id) {
      return NextResponse.json({ error: 'Lead fora da sua fila.' }, { status: 403 });
    }

    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if ('valor_negociacao' in body) updatePayload.valor_negociacao = numericOrNull(body.valor_negociacao);
    if ('operadora_negociacao' in body) updatePayload.operadora_negociacao = body.operadora_negociacao ? String(body.operadora_negociacao).trim() : null;
    if ('valor_comissao' in body) updatePayload.valor_comissao = numericOrNull(body.valor_comissao);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', leadId)
      .select('id, status, valor_negociacao, operadora_negociacao, valor_comissao')
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabaseAdmin.from('lead_atividades').insert([{
      lead_id: leadId,
      profile_id: guard.profile.id,
      tipo: 'status',
      titulo: 'Status atualizado',
      descricao: `Lead movido para ${status}`,
    }]);

    await writeAuditLog(request, guard.profile, {
      action: 'lead.status.update',
      entity_type: 'lead',
      entity_id: leadId,
      metadata: { status },
    });

    return NextResponse.json({ success: true, lead: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao atualizar status.' }, { status: 500 });
  }
}
