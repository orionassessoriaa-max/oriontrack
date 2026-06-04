import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';

function parseMoney(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(,|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1, 3)).toISOString().slice(0, 10);
}

function addMonthsDate(start: string, months: number) {
  const [year, month, day] = start.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day || 1, 3));
  return date.toISOString().slice(0, 10);
}

async function getScopedCorretorId(profile: any, requested?: string | null) {
  if (profile.tipo_usuario === 'admin') return requested || null;
  return profile.corretor_id || null;
}

async function ensureSaleRevenue(leadId: string, profile: any) {
  const { data: lead, error: leadError } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, status, valor_negociacao, valor_comissao, nome')
    .eq('id', leadId)
    .maybeSingle();

  if (leadError || !lead) throw new Error(leadError?.message || 'Lead nao encontrado.');
  if (lead.status !== 'Venda realizada') return null;
  if (profile.tipo_usuario !== 'admin' && lead.corretor_id !== profile.corretor_id) {
    throw new Error('Lead fora do seu corretor.');
  }

  const { data: existing } = await supabaseAdmin
    .from('financeiro_receitas')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1);

  if (existing?.length) return existing[0];

  const valorTotal = parseMoney(lead.valor_negociacao || lead.valor_comissao);
  if (valorTotal <= 0) return null;

  const { data: inserted, error } = await supabaseAdmin
    .from('financeiro_receitas')
    .insert([{
      corretor_id: lead.corretor_id,
      lead_id: lead.id,
      parcela_numero: 1,
      total_parcelas: 1,
      valor_total: valorTotal,
      valor_parcela: valorTotal,
      vencimento: monthStart(),
      status: 'pendente',
      created_by: profile.id,
    }])
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return inserted;
}

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'financeiro:receitas:read', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
    if ('error' in guard) return guard.error;

    const url = new URL(request.url);
    const leadId = url.searchParams.get('lead_id');
    if (leadId) await ensureSaleRevenue(leadId, guard.profile);

    let corretorId = await getScopedCorretorId(guard.profile, url.searchParams.get('corretor_id'));
    if (!corretorId && leadId && guard.profile.tipo_usuario === 'admin') {
      const { data: leadScope } = await supabaseAdmin
        .from('leads')
        .select('corretor_id')
        .eq('id', leadId)
        .maybeSingle();
      corretorId = leadScope?.corretor_id || null;
    }
    if (!corretorId) return NextResponse.json({ success: true, receitas: [] });

    let query = supabaseAdmin
      .from('financeiro_receitas')
      .select('*, leads:lead_id(id, nome, telefone, status, valor_negociacao, valor_comissao)')
      .eq('corretor_id', corretorId)
      .order('vencimento', { ascending: true })
      .order('parcela_numero', { ascending: true });

    if (leadId) query = query.eq('lead_id', leadId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, receitas: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar financeiro.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'financeiro:receitas:write', { limit: 60, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const action = String(body.action || 'save_plan');
    const leadId = String(body.lead_id || '').trim();

    if (action === 'ensure_sale') {
      const result = await ensureSaleRevenue(leadId, guard.profile);
      return NextResponse.json({ success: true, receita: result });
    }

    if (!leadId) return NextResponse.json({ error: 'Lead nao informado.' }, { status: 400 });

    const { data: lead, error: leadError } = await supabaseAdmin
      .from('leads')
      .select('id, corretor_id, status, valor_negociacao, valor_comissao')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError || !lead) return NextResponse.json({ error: leadError?.message || 'Lead nao encontrado.' }, { status: 404 });
    if (guard.profile.tipo_usuario !== 'admin' && lead.corretor_id !== guard.profile.corretor_id) {
      return NextResponse.json({ error: 'Lead fora do seu corretor.' }, { status: 403 });
    }

    const totalParcelas = Math.max(1, Math.min(24, Number(body.total_parcelas || 1)));
    const valorTotal = parseMoney(body.valor_total || lead.valor_negociacao || lead.valor_comissao);
    const firstDue = String(body.vencimento || monthStart());
    const statusRecebidaPrimeira = Boolean(body.primeira_recebida);

    if (valorTotal <= 0) return NextResponse.json({ error: 'Informe o valor total da venda.' }, { status: 400 });

    const valorParcela = Math.round((valorTotal / totalParcelas) * 100) / 100;
    const rows = Array.from({ length: totalParcelas }, (_, index) => ({
      corretor_id: lead.corretor_id,
      lead_id: lead.id,
      parcela_numero: index + 1,
      total_parcelas: totalParcelas,
      valor_total: valorTotal,
      valor_parcela: index === totalParcelas - 1
        ? Math.round((valorTotal - valorParcela * (totalParcelas - 1)) * 100) / 100
        : valorParcela,
      vencimento: addMonthsDate(firstDue, index),
      status: index === 0 && statusRecebidaPrimeira ? 'recebida' : 'pendente',
      observacoes: body.observacoes ? String(body.observacoes).trim() : null,
      created_by: guard.profile.id,
    }));

    await supabaseAdmin.from('financeiro_receitas').delete().eq('lead_id', lead.id);
    const { data, error } = await supabaseAdmin
      .from('financeiro_receitas')
      .insert(rows)
      .select('*, leads:lead_id(id, nome, telefone, status, valor_negociacao, valor_comissao)');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog(request, guard.profile, {
      action: 'financeiro.receita.save',
      entity_type: 'lead',
      entity_id: lead.id,
      metadata: { total_parcelas: totalParcelas, valor_total: valorTotal },
    });

    return NextResponse.json({ success: true, receitas: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao salvar financeiro.' }, { status: 500 });
  }
}
