import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { isMissingLeadOriginColumn, isOrionLead } from '@/lib/leadOrigin';

type Profile = { id: string; tipo_usuario: string; nome?: string | null };

function brl(value: number | null) {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function describeMetaError(error: any) {
  const message = String(error?.message || '').trim();
  const lower = message.toLowerCase();
  if (String(error?.code || '') === '190' || lower.includes('access token')) return 'Token Meta expirado ou inválido.';
  if (lower.includes('permission')) return 'Token Meta sem permissão para ler esta conta.';
  return message || 'Não foi possível consultar a conta Meta.';
}

async function requireAccess(request: Request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !user) return { error: NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin.from('profiles').select('id, tipo_usuario, nome').eq('id', user.id).maybeSingle();
  if (!profile || !['admin', 'gestor_trafego', 'account_manager'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }
  return { user, profile: profile as Profile };
}

function normalizeDate(value: unknown) {
  const date = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

async function readMetaSpend(accountId: string, since: string, until: string, accessToken: string) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const url = new URL(`https://graph.facebook.com/${version}/act_${accountId.replace(/^act_/, '')}/insights`);
  url.searchParams.set('fields', 'spend');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url.toString(), { next: { revalidate: 300 } });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(describeMetaError(payload.error));
  return (payload.data || []).reduce((sum: number, row: any) => sum + Number(row.spend || 0), 0);
}

async function readLeads(corretorId: string, since: string, until: string) {
  const start = new Date(`${since}T00:00:00.000Z`).toISOString();
  const end = new Date(`${until}T23:59:59.999Z`).toISOString();
  const base = supabaseAdmin.from('leads').select('id, origem, utm_source, utm_medium, utm_campaign, utm_term, utm_content, data_entrada').eq('corretor_id', corretorId).gte('data_entrada', start).lte('data_entrada', end);
  let result: any = await base;
  if (result.error && isMissingLeadOriginColumn(result.error)) {
    result = await supabaseAdmin.from('leads').select('id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, data_entrada').eq('corretor_id', corretorId).gte('data_entrada', start).lte('data_entrada', end);
  }
  if (result.error) throw new Error(result.error.message);
  return (result.data || []).filter(isOrionLead).length;
}

export async function POST(request: Request) {
  try {
    const guard = await requireAccess(request);
    if ('error' in guard) return guard.error;
    const body = await request.json().catch(() => ({}));
    const dataInicio = normalizeDate(body.data_inicio);
    const dataFim = normalizeDate(body.data_fim);
    if (!dataInicio || !dataFim || dataInicio > dataFim) {
      return NextResponse.json({ error: 'Informe um período semanal válido.' }, { status: 400 });
    }

    const { data: corretores, error: corretoresError } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, nome_empresa, gestor_trafego_id, time_operacional, meta_ad_account_id, meta_ad_account_name')
      .in('status', ['active', 'ativo', 'Ativo'])
      .order('nome_empresa', { ascending: true });
    if (corretoresError) return NextResponse.json({ error: corretoresError.message }, { status: 500 });

    const scoped = guard.profile.tipo_usuario === 'gestor_trafego'
      ? (corretores || []).filter((item) => isGestorLinkedToConcessionariaCorretor(item, guard.profile))
      : (corretores || []);
    const accessToken = process.env.META_ACCESS_TOKEN || '';
    const items = await Promise.all(scoped.map(async (corretor) => {
      const concessionaria = String(corretor.nome_empresa || corretor.nome || 'Concessionária sem nome');
      const [leadsResult, spendResult] = await Promise.allSettled([
        readLeads(corretor.id, dataInicio, dataFim),
        accessToken && corretor.meta_ad_account_id
          ? readMetaSpend(String(corretor.meta_ad_account_id), dataInicio, dataFim, accessToken)
          : Promise.resolve(null),
      ]);
      const leads = leadsResult.status === 'fulfilled' ? leadsResult.value : 0;
      const investimento = spendResult.status === 'fulfilled' ? spendResult.value : null;
      const cpl = investimento !== null && leads > 0 ? investimento / leads : null;
      const metaAviso = spendResult.status === 'rejected' ? ` Investimento: ${spendResult.reason?.message || 'indisponível'}` : '';
      const mensagem = `Olá, time! Segue o relatório da semana.\n\nLeads: ${leads}\nInvestimento: ${brl(investimento)}\nCusto por lead: ${brl(cpl)}${metaAviso}`;
      return { corretor_id: corretor.id, concessionaria, meta_ad_account_name: corretor.meta_ad_account_name || null, leads, investimento, cpl, mensagem };
    }));

    const { data: saved, error: saveError } = await supabaseAdmin.from('trafego_relatorios_semanais').insert({
      gestor_id: guard.profile.id,
      data_inicio: dataInicio,
      data_fim: dataFim,
      itens: items,
      status: 'PREVIEW'
    }).select('id, created_at').single();
    if (saveError) return NextResponse.json({ error: `Aplique a migration de relatórios semanais antes de gerar: ${saveError.message}` }, { status: 500 });

    return NextResponse.json({ success: true, report_id: saved.id, created_at: saved.created_at, data_inicio: dataInicio, data_fim: dataFim, items });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao gerar relatório semanal.' }, { status: 500 });
  }
}
