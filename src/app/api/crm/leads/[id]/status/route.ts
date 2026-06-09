import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { LEAD_STATUSES } from '@/lib/leadStatus';
import { LeadStatus } from '@/types';

const ALLOWED_STATUSES = LEAD_STATUSES;

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

function calculateCommission(value: unknown, percent: unknown) {
  const numeric = numericOrNull(value);
  const rate = Number(percent);
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : 2.5;
  return numeric === null ? null : numeric * (safeRate / 100);
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 3)).toISOString().slice(0, 10);
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
    const limited = rateLimit(request, 'crm:lead-status:update', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
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
      .select('id, status, corretor_id, responsavel_profile_id, comissao_percentual, corretores:corretor_id(comissao_percentual)')
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

    if (isStatusChanging) {
      updatePayload.cadencia_inicio = new Date().toISOString();
      updatePayload.cadencia_ativa = true;
      updatePayload.cadencia_fim = null;
    }

    if ('valor_negociacao' in body) updatePayload.valor_negociacao = numericOrNull(body.valor_negociacao);
    if ('operadora_negociacao' in body) updatePayload.operadora_negociacao = body.operadora_negociacao ? String(body.operadora_negociacao).trim() : null;
    if ('valor_comissao' in body) updatePayload.valor_comissao = numericOrNull(body.valor_comissao);
    if ('comissao_percentual' in body) updatePayload.comissao_percentual = numericOrNull(body.comissao_percentual);
    if ('sem_interesse_motivo' in body) updatePayload.sem_interesse_motivo = body.sem_interesse_motivo ? String(body.sem_interesse_motivo).trim() : null;
    if ('sem_interesse_fez_cotacao' in body) updatePayload.sem_interesse_fez_cotacao = boolOrNull(body.sem_interesse_fez_cotacao);

    if (status !== 'Sem interesse' && 'valor_negociacao' in body) {
      const corretor = Array.isArray((lead as any).corretores) ? (lead as any).corretores[0] : (lead as any).corretores;
      const commissionPercent = numericOrNull(body.comissao_percentual) ?? numericOrNull((lead as any).comissao_percentual) ?? numericOrNull(corretor?.comissao_percentual) ?? 2.5;
      updatePayload.comissao_percentual = commissionPercent;
      updatePayload.valor_comissao = calculateCommission(body.valor_negociacao, commissionPercent);
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', leadId)
      .select('id, status, valor_negociacao, operadora_negociacao, valor_comissao, comissao_percentual, sem_interesse_motivo, sem_interesse_fez_cotacao')
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (status === 'Venda realizada') {
      const saleValue = numericOrNull(updated.valor_negociacao) || numericOrNull(updated.valor_comissao) || 0;
      if (saleValue > 0) {
        const { data: existingFinance } = await supabaseAdmin
          .from('financeiro_receitas')
          .select('id')
          .eq('lead_id', leadId)
          .limit(1);

        if (!existingFinance?.length) {
          await supabaseAdmin.from('financeiro_receitas').insert([{
            corretor_id: lead.corretor_id,
            lead_id: leadId,
            parcela_numero: 1,
            total_parcelas: 1,
            valor_total: saleValue,
            valor_parcela: saleValue,
            vencimento: monthStart(),
            status: 'pendente',
            created_by: guard.profile.id,
          }]);
        }
      }
    }

    const activityDescription = status === 'Sem interesse'
      ? [
          'Lead movido para Sem interesse.',
          updatePayload.sem_interesse_motivo ? `Motivo: ${updatePayload.sem_interesse_motivo}.` : null,
          updatePayload.sem_interesse_fez_cotacao ? `Teve cotacao de ${updatePayload.valor_negociacao ?? 'valor nao informado'}.` : 'Nao chegou a fazer cotacao.',
        ].filter(Boolean).join(' ')
      : `Lead movido para ${status}`;

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
