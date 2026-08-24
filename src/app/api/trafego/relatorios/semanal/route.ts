import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { isMissingLeadOriginColumn, isOrionLead } from '@/lib/leadOrigin';

type Profile = { id: string; tipo_usuario: string; nome?: string | null };
type CorretorRow = {
  id: string;
  nome: string;
  nome_empresa: string | null;
  gestor_trafego_id: string | null;
  time_operacional: unknown;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
};
type LeadTrackingRow = {
  id: string;
  origem?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  data_entrada?: string | null;
};

function brl(value: number | null) {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function describeMetaError(error: unknown) {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = String(details.message || '').trim();
  const lower = message.toLowerCase();
  if (String(details.code || '') === '190' || lower.includes('access token')) return 'Token Meta expirado ou inválido.';
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

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readMetaSpend(accountId: string, since: string, until: string, accessToken: string) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const url = new URL(`https://graph.facebook.com/${version}/act_${accountId.replace(/^act_/, '')}/insights`);
  url.searchParams.set('fields', 'spend');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('access_token', accessToken);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url.toString(), { next: { revalidate: 300 } });
      const payload = await response.json();
      if (response.ok && !payload.error) {
        return (payload.data || []).reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.spend || 0), 0);
      }
      const errorCode = String(payload.error?.code || '');
      const transient = response.status === 429
        || response.status >= 500
        || ['1', '2', '4', '17', '32', '613'].includes(errorCode);
      if (!transient || attempt === 2) throw new Error(describeMetaError(payload.error));
    } catch (error: unknown) {
      if (attempt === 2) throw error;
    }
    await wait(400 * (2 ** attempt));
  }

  throw new Error('Não foi possível consultar o investimento após três tentativas.');
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => runWorker()));
  return results;
}

async function readLeads(corretorIds: string[], since: string, until: string) {
  const start = new Date(`${since}T00:00:00.000Z`).toISOString();
  const end = new Date(`${until}T23:59:59.999Z`).toISOString();
  const base = supabaseAdmin.from('leads').select('id, origem, utm_source, utm_medium, utm_campaign, utm_term, utm_content, data_entrada').in('corretor_id', corretorIds).gte('data_entrada', start).lte('data_entrada', end);
  const primary = await base;
  let data = primary.data as LeadTrackingRow[] | null;
  let queryError = primary.error;
  if (queryError && isMissingLeadOriginColumn(queryError)) {
    const retry = await supabaseAdmin.from('leads').select('id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, data_entrada').in('corretor_id', corretorIds).gte('data_entrada', start).lte('data_entrada', end);
    data = retry.data as LeadTrackingRow[] | null;
    queryError = retry.error;
  }
  if (queryError) throw new Error(queryError.message);
  return (data || []).filter(isOrionLead).length;
}

/** 2026-08-17 vira 17/08, do jeito que o gestor escreve no grupo. */
function diaMes(iso: string) {
  const [, mes, dia] = String(iso || '').split('-');
  return dia && mes ? `${dia}/${mes}` : iso;
}

export async function POST(request: Request) {
  try {
    const guard = await requireAccess(request);
    if ('error' in guard) return guard.error;
    const body = await request.json().catch(() => ({}));
    let scopedProfile = guard.profile;
    if (guard.profile.tipo_usuario === 'admin' && body.gestor_id) {
      const { data: requestedGestor } = await supabaseAdmin
        .from('profiles')
        .select('id, tipo_usuario, nome')
        .eq('id', String(body.gestor_id))
        .eq('tipo_usuario', 'gestor_trafego')
        .maybeSingle();
      if (!requestedGestor) return NextResponse.json({ error: 'Gestor de tráfego não encontrado.' }, { status: 404 });
      scopedProfile = requestedGestor as Profile;
    }
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

    const scoped = scopedProfile.tipo_usuario === 'gestor_trafego'
      ? (corretores || []).filter((item) => isGestorLinkedToConcessionariaCorretor(item, scopedProfile))
      : (corretores || []);
    const groups = new Map<string, CorretorRow[]>();
    (scoped as CorretorRow[]).forEach((corretor) => {
      const concessionaria = String(corretor.nome_empresa || '').trim();
      if (!concessionaria) return;
      const key = concessionaria.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      groups.set(key, [...(groups.get(key) || []), corretor]);
    });

    const accessToken = process.env.META_ACCESS_TOKEN || '';
    const items = await mapWithConcurrency(Array.from(groups.values()), 4, async (group) => {
      const metaOwner = group.find((item) => String(item.meta_ad_account_id || '').trim()) || group[0];
      const concessionaria = String(metaOwner.nome_empresa || metaOwner.nome || 'Concessionária sem nome');
      const [leadsResult, spendResult] = await Promise.allSettled([
        readLeads(group.map((item) => item.id), dataInicio, dataFim),
        accessToken && metaOwner.meta_ad_account_id
          ? readMetaSpend(String(metaOwner.meta_ad_account_id), dataInicio, dataFim, accessToken)
          : Promise.resolve(null),
      ]);
      const leads = leadsResult.status === 'fulfilled' ? leadsResult.value : null;
      const investimento = spendResult.status === 'fulfilled' ? spendResult.value : null;
      const cpl = investimento !== null && leads !== null && leads > 0 ? investimento / leads : null;
      const metaAviso = spendResult.status === 'rejected' ? ` Investimento: ${spendResult.reason?.message || 'indisponível'}` : '';
      const leadsAviso = leadsResult.status === 'rejected' ? ` Leads: ${leadsResult.reason?.message || 'indisponíveis'}` : '';
      // Formato que o gestor ja usa no WhatsApp, com o periodo no cabecalho:
      // sem a data, quem recebia nao sabia de qual semana era o numero.
      const mensagem = [
        `Logo abaixo estou deixando os dados das nossas campanhas (${diaMes(dataInicio)} até ${diaMes(dataFim)}): ⤵️`,
        '',
        '📈 CAMPANHAS PLANO DE SAÚDE:',
        `💸 Investimento: ${brl(investimento)}`,
        `✅ Nº Leads: ${leads === null ? 'N/A' : leads}`,
        `✅ Custo médio por Lead: ${brl(cpl)}`,
      ].join('\n') + `${leadsAviso}${metaAviso}`;
      return {
        corretor_id: metaOwner.id,
        corretor_ids: group.map((item) => item.id),
        concessionaria,
        meta_ad_account_name: metaOwner.meta_ad_account_name || null,
        leads,
        investimento,
        cpl,
        mensagem,
        erro_leads: leadsResult.status === 'rejected' ? String(leadsResult.reason?.message || 'Falha ao consultar leads.') : null,
        erro_investimento: spendResult.status === 'rejected' ? String(spendResult.reason?.message || 'Falha ao consultar investimento.') : null,
      };
    });

    const { data: saved, error: saveError } = await supabaseAdmin.from('trafego_relatorios_semanais').insert({
      gestor_id: scopedProfile.id,
      data_inicio: dataInicio,
      data_fim: dataFim,
      itens: items,
      status: 'PREVIEW'
    }).select('id, created_at').single();
    if (saveError) return NextResponse.json({ error: `Aplique a migration de relatórios semanais antes de gerar: ${saveError.message}` }, { status: 500 });

    return NextResponse.json({ success: true, report_id: saved.id, created_at: saved.created_at, data_inicio: dataInicio, data_fim: dataFim, items });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao gerar relatório semanal.',
    }, { status: 500 });
  }
}
