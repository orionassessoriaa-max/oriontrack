import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { LeadStatus } from '@/types';
import { normalizeKanbanStages, isSaleEquivalentStage } from '@/lib/kanbanStages';

const LEAD_STATUS_MAX_LENGTH = 80;

function numericOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  return ['true', 'sim', '1', 'yes'].includes(String(value).toLowerCase());
}

function isValidLeadStatus(value: string) {
  const status = value.trim();
  if (!status || status.length > LEAD_STATUS_MAX_LENGTH) return false;
  return !/[<>]/.test(status);
}

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
  if (!['corretor', 'corretor_admin'].includes(profile.tipo_usuario)) return false;
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
    const limited = rateLimit(request, 'crm:lead-status:update', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
    if ('error' in guard) return guard.error;

    const { id } = await context.params;
    const leadId = String(id || '').trim();
    const body = await request.json();
    const status = String(body.status || '').trim() as LeadStatus;

    if (!leadId || !isValidLeadStatus(status)) {
      return NextResponse.json({ error: 'Status ou lead invalido.' }, { status: 400 });
    }

    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, status, corretor_id, responsavel_profile_id, created_at, data_entrada, cadencia_inicio')
      .eq('id', leadId)
      .maybeSingle();

    if (!lead) {
      return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });
    }

    if (!(await canAccessLead(guard.profile, lead))) {
      return NextResponse.json({ error: 'Lead fora do seu corretor.' }, { status: 403 });
    }

    const isStatusChanging = lead.status !== status;
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    const { data: broker } = lead.corretor_id
      ? await supabaseAdmin.from('corretores').select('kanban_etapas').eq('id', lead.corretor_id).maybeSingle()
      : { data: null };
    updatePayload.conta_como_venda = isSaleEquivalentStage(normalizeKanbanStages(broker?.kanban_etapas), status);

    if (isStatusChanging) {
      updatePayload.cadencia_inicio = new Date().toISOString();
      updatePayload.cadencia_ativa = true;
      updatePayload.cadencia_fim = null;
    }

    if ('valor_negociacao' in body) updatePayload.valor_negociacao = numericOrNull(body.valor_negociacao);
    if ('operadora_negociacao' in body) updatePayload.operadora_negociacao = body.operadora_negociacao ? String(body.operadora_negociacao).trim() : null;
    if ('sem_interesse_motivo' in body) updatePayload.sem_interesse_motivo = body.sem_interesse_motivo ? String(body.sem_interesse_motivo).trim() : null;
    if ('sem_interesse_fez_cotacao' in body) updatePayload.sem_interesse_fez_cotacao = boolOrNull(body.sem_interesse_fez_cotacao);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', leadId)
      .select('id, status, conta_como_venda, valor_negociacao, operadora_negociacao, sem_interesse_motivo, sem_interesse_fez_cotacao, cadencia_inicio, cadencia_fim, cadencia_ativa')
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const oldStatus = lead.status;
    let activityDescription = '';
    if (isStatusChanging) {
      const daysInPrevStatus = cadenceDays(lead.cadencia_inicio || lead.data_entrada || lead.created_at, new Date().toISOString());
      if (status === 'Sem interesse') {
        activityDescription = [
          `Lead movido de ${oldStatus} para Sem interesse (ficou ${daysInPrevStatus} dia(s) na etapa anterior).`,
          updatePayload.sem_interesse_motivo ? `Motivo: ${updatePayload.sem_interesse_motivo}.` : null,
          updatePayload.sem_interesse_fez_cotacao ? `Teve cotacao de ${updatePayload.valor_negociacao ?? 'valor nao informado'}.` : 'Nao chegou a fazer cotacao.',
        ].filter(Boolean).join(' ');
      } else {
        activityDescription = `Lead movido de ${oldStatus} para ${status} (ficou ${daysInPrevStatus} dia(s) na etapa anterior).`;
      }
    } else {
      if (status === 'Sem interesse') {
        activityDescription = [
          'Dados do lead atualizados em Sem interesse.',
          updatePayload.sem_interesse_motivo ? `Motivo: ${updatePayload.sem_interesse_motivo}.` : null,
          updatePayload.sem_interesse_fez_cotacao ? `Teve cotacao de ${updatePayload.valor_negociacao ?? 'valor nao informado'}.` : 'Nao chegou a fazer cotacao.',
        ].filter(Boolean).join(' ');
      } else {
        activityDescription = `Dados do lead atualizados em ${status}.`;
      }
    }

    await supabaseAdmin.from('lead_atividades').insert([{
      lead_id: leadId,
      profile_id: guard.profile.id,
      tipo: 'status',
      titulo: 'Status atualizado',
      descricao: activityDescription,
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
