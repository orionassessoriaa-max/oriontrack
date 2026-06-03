import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';

type CorretorMeta = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
};

async function requireTrafficAccess(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, tipo_usuario, corretor_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['admin', 'gestor_trafego', 'corretor', 'corretor_admin', 'corretor_membro'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

function normalizeAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

function parseDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function currentMonthRange() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - offset);
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    since: new Date(firstDay.getTime() - offset).toISOString().slice(0, 10),
    until: local.toISOString().slice(0, 10),
  };
}

function parseMoneyFromMetaText(value?: string | null) {
  const text = String(value || '');
  const match = text.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:\.\d{2})?)/);
  if (!match?.[1]) return null;

  const normalized = match[1].includes(',')
    ? match[1].replace(/\./g, '').replace(',', '.')
    : match[1];

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

async function fetchSheetLeadCount(corretorId: string, since: string, until: string) {
  const start = `${since}T00:00:00.000-03:00`;
  const end = `${until}T23:59:59.999-03:00`;

  const { count, error } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('corretor_id', corretorId)
    .gte('data_entrada', start)
    .lte('data_entrada', end);

  if (error) throw new Error(`Erro ao contar leads da planilha: ${error.message}`);
  return count || 0;
}

async function fetchAccountMetrics(corretor: CorretorMeta, since: string, until: string, accessToken: string, graphVersion: string) {
  const accountId = normalizeAccountId(String(corretor.meta_ad_account_id));
  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  insightsUrl.searchParams.set('fields', 'spend,ctr');
  insightsUrl.searchParams.set('level', 'account');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('access_token', accessToken);

  const accountUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}`);
  accountUrl.searchParams.set('fields', 'balance,currency,amount_spent,funding_source_details');
  accountUrl.searchParams.set('access_token', accessToken);

  const [insightsResponse, accountResponse, sheetLeads] = await Promise.all([
    fetch(insightsUrl.toString(), { next: { revalidate: 900 } }),
    fetch(accountUrl.toString(), { next: { revalidate: 900 } }),
    fetchSheetLeadCount(corretor.id, since, until),
  ]);

  const [insightsPayload, accountPayload] = await Promise.all([
    insightsResponse.json(),
    accountResponse.json(),
  ]);

  if (!insightsResponse.ok || insightsPayload.error) {
    throw new Error(insightsPayload.error?.message || 'Erro ao consultar metricas Meta.');
  }

  const row = insightsPayload.data?.[0] || {};
  const spend = Number(row.spend || 0);
  const leads = sheetLeads;
  const cpl = leads > 0 ? spend / leads : null;
  const ctr = Number(row.ctr || 0);
  const rawBalance = accountPayload?.balance;
  const balance = rawBalance === undefined || rawBalance === null ? null : Number(rawBalance) / 100;
  const fundingDetails = accountPayload?.funding_source_details;
  const fundingText = JSON.stringify(fundingDetails || {}).toLowerCase();
  const isCard = fundingText.includes('card') || fundingText.includes('cart') || fundingText.includes('visa') || fundingText.includes('mastercard') || fundingText.includes('amex');
  const displayBalance = parseMoneyFromMetaText(fundingDetails?.display_string);
  const effectiveBalance = displayBalance ?? balance;
  const formaPagamento = isCard
    ? 'Cartao'
    : fundingDetails?.display_string || fundingDetails?.type || (balance !== null ? 'Saldo pre-pago' : 'Nao informado');

    return {
    corretor_id: corretor.id,
    corretor_nome: corretor.nome,
    meta_ad_account_id: corretor.meta_ad_account_id,
    meta_ad_account_name: corretor.meta_ad_account_name,
    spend,
    leads,
    cpl,
    ctr,
    saldo: isCard ? null : effectiveBalance,
      currency: accountPayload?.currency || 'BRL',
      forma_pagamento: formaPagamento,
      alerta_cpl_alto: cpl !== null && cpl > 25,
      alerta_saldo_baixo: !isCard && effectiveBalance !== null && effectiveBalance < 100,
    };
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:alerts', { limit: 30, windowMs: 5 * 60_000 });
    if (limited) return limited;

    const guard = await requireTrafficAccess(request);
    if ('error' in guard) return guard.error;

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: 'META_ACCESS_TOKEN nao configurado no servidor.' }, { status: 500 });
    }

    const body = await request.json();
    const defaultRange = currentMonthRange();
    const since = parseDate(String(body.data_inicio || '')) || defaultRange.since;
    const until = parseDate(String(body.data_fim || '')) || defaultRange.until;
    const search = String(body.nome || '').trim().toLowerCase();

    const query = supabaseAdmin
      .from('corretores')
      .select('id, nome, gestor_trafego_id, meta_ad_account_id, meta_ad_account_name')
      .not('meta_ad_account_id', 'is', null)
      .order('nome', { ascending: true });

    if (guard.profile.tipo_usuario === 'gestor_trafego') {
      query.eq('gestor_trafego_id', guard.user.id);
    } else if (['corretor', 'corretor_admin', 'corretor_membro'].includes(guard.profile.tipo_usuario)) {
      if (!guard.profile.corretor_id) {
        return NextResponse.json({ success: true, accounts: [] });
      }
      query.eq('id', guard.profile.corretor_id);
    }

    const { data: corretores, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const filtered = ((corretores || []) as CorretorMeta[]).filter((corretor) => {
      if (!search) return true;
      return `${corretor.nome} ${corretor.meta_ad_account_name || ''}`.toLowerCase().includes(search);
    });

    const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
    const settled = await Promise.allSettled(
      filtered.map((corretor) => fetchAccountMetrics(corretor, since, until, accessToken, graphVersion))
    );

    const accounts = settled
      .map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        const corretor = filtered[index];
        return {
          corretor_id: corretor.id,
          corretor_nome: corretor.nome,
          meta_ad_account_id: corretor.meta_ad_account_id,
          meta_ad_account_name: corretor.meta_ad_account_name,
          spend: 0,
          leads: 0,
          cpl: null,
          ctr: 0,
          saldo: null,
          currency: 'BRL',
          forma_pagamento: 'Nao informado',
          alerta_cpl_alto: false,
          alerta_saldo_baixo: false,
          error: result.reason?.message || 'Erro ao consultar esta conta.',
        };
      })
      .sort((a, b) => Number(b.alerta_cpl_alto) - Number(a.alerta_cpl_alto));

    return NextResponse.json({
      success: true,
      data_inicio: since,
      data_fim: until,
      refreshed_at: new Date().toISOString(),
      threshold_cpl: 25,
      accounts,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar avisos Meta.' }, { status: 500 });
  }
}
