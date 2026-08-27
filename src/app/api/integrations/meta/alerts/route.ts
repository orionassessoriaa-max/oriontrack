import { openaiFetch } from '@/lib/openaiUso';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { isMissingLeadOriginColumn, isOrionLead } from '@/lib/leadOrigin';
import { fetchOrionCumulativeSpend } from '@/lib/meta/orionSpend';
import { fetchWithTimeout } from '@/lib/meta/fetchWithTimeout';
import { getMetaUsageSnapshot, metaCachedFetch } from '@/lib/meta/cachedFetch';
import {
  TRAFFIC_RULES,
  buildRecommendations,
  resolveTrackingStatus,
  type AccountLike,
  type CreativeLike,
  type Recommendation,
  type TrackingStatus,
} from '@/lib/trafego/rules';

type CorretorMeta = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  nome_empresa: string | null;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  time_operacional?: unknown;
  rastreio_status?: string | null;
  rastreio_desde?: string | null;
  scoped_corretor_ids?: string[];
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
    .select('id, nome, email, email_real, tipo_usuario, corretor_id')
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

function getMetaCompatibleRange(since: string, until: string) {
  const defaultRange = currentMonthRange();
  const end = parseDate(until) || defaultRange.until;
  const endDate = new Date(`${end}T00:00:00`);
  const minDate = new Date(endDate.getFullYear(), endDate.getMonth() - 36, 1);
  const minSince = minDate.toISOString().slice(0, 10);
  const validSince = parseDate(since) || defaultRange.since;

  return {
    since: validSince > minSince ? validSince : minSince,
    until: end,
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

function describeMetaError(error: any, accountId?: string | null) {
  const message = String(error?.message || '').trim();
  const code = String(error?.code || '').trim();
  const lower = message.toLowerCase();
  const accountText = accountId ? ` (${accountId})` : '';

  if (code === '1' && lower.includes('unknown error')) {
    return `Conta Meta${accountText} indisponivel para o token atual. Sincronize as contas Meta novamente e confira se este token tem acesso a essa conta de anuncios.`;
  }

  if (code === '190' || lower.includes('invalid oauth') || lower.includes('access token')) {
    return 'Token Meta expirado ou invalido. Gere um novo token e sincronize as contas novamente.';
  }

  if (lower.includes('permission') || lower.includes('permissions') || lower.includes('permiss')) {
    return `Token Meta sem permissao para ler a conta${accountText}. Revise as permissoes de Ads no Business Manager.`;
  }

  return message || 'Nao consegui consultar esta conta Meta agora.';
}

async function resolveCorretorGroupIds(corretor: CorretorMeta) {
  if (corretor.scoped_corretor_ids?.length) return corretor.scoped_corretor_ids;

  const corretoraNome = String(corretor.nome_empresa || '').trim();
  if (!corretoraNome) return [corretor.id];

  let groupQuery = supabaseAdmin
    .from('corretores')
    .select('id')
    .eq('nome_empresa', corretoraNome);

  if (corretor.gestor_trafego_id) {
    groupQuery = groupQuery.eq('gestor_trafego_id', corretor.gestor_trafego_id);
  }

  const { data, error } = await groupQuery;
  if (error) throw new Error(`Erro ao buscar corretores da concessionaria: ${error.message}`);

  const ids = (data || []).map((item) => item.id).filter(Boolean);
  return ids.length > 0 ? ids : [corretor.id];
}

async function fetchSheetLeads(corretor: CorretorMeta, since: string, until: string) {
  const start = `${since}T00:00:00.000-03:00`;
  const end = `${until}T23:59:59.999-03:00`;
  const corretorIds = await resolveCorretorGroupIds(corretor);

  let { data, error }: { data: any[] | null; error: any } = await supabaseAdmin
    .from('leads')
    .select('id, origem, utm_source, utm_medium, utm_campaign, utm_term, utm_content, operadora, observacoes, data_entrada')
    .in('corretor_id', corretorIds)
    .gte('data_entrada', start)
    .lte('data_entrada', end);

  if (error && isMissingLeadOriginColumn(error)) {
    const retry = await supabaseAdmin
      .from('leads')
      .select('id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, operadora, observacoes, data_entrada')
      .in('corretor_id', corretorIds)
      .gte('data_entrada', start)
      .lte('data_entrada', end);
    data = retry.data;
    error = retry.error;
  }

  if (error) throw new Error(`Erro ao buscar leads CRM: ${error.message}`);
  return (data || []).filter(isOrionLead);
}

/**
 * Quais concessionarias ja receberam algum lead Orion alguma vez, sem filtro de
 * periodo. E o que separa "ainda nao integrei" de "integrei e quebrou". Uma
 * consulta so para toda a carteira, apoiada no indice de leads.origem.
 */
type OrionTrackingSummary = {
  everHadLead: boolean;
  lastLeadAt: string | null;
};

async function fetchCorretoresComHistoricoOrion(corretorIds: string[]) {
  if (corretorIds.length === 0) return new Map<string, OrionTrackingSummary>();

  const { data, error } = await supabaseAdmin.rpc('get_corretores_rastreio_orion', {
    p_corretor_ids: corretorIds,
  });

  if (!error) {
    const historico = (data || []) as Array<{ corretor_id?: string | null; ultimo_lead_at?: string | null }>;
    return new Map(historico
      .map((row) => {
        const corretorId = String(row.corretor_id || '');
        return [corretorId, { everHadLead: true, lastLeadAt: row.ultimo_lead_at || null }] as const;
      })
      .filter(([corretorId]) => Boolean(corretorId)));
  }

  // Compatibilidade durante o deploy: se a migration ainda nao foi aplicada,
  // consulta apenas a existencia por corretor. Nao baixa milhares de leads e
  // nao sofre o corte de 10.000 linhas que causava falsos "sem integracao".
  const encontrados = new Map<string, OrionTrackingSummary>();
  for (let index = 0; index < corretorIds.length; index += 10) {
    const lote = corretorIds.slice(index, index + 10);
    const resultados = await Promise.all(lote.map(async (corretorId) => {
      const consulta = await supabaseAdmin
        .from('leads')
        .select('corretor_id, data_entrada')
        .eq('corretor_id', corretorId)
        .ilike('origem', 'orion')
        .order('data_entrada', { ascending: false })
        .limit(1);
      const lead = consulta.error ? null : consulta.data?.[0] || null;
      return lead ? {
        corretorId: String(lead.corretor_id),
        lastLeadAt: lead.data_entrada ? String(lead.data_entrada) : null,
      } : null;
    }));
    resultados.forEach((resultado) => {
      if (resultado) encontrados.set(resultado.corretorId, {
        everHadLead: true,
        lastLeadAt: resultado.lastLeadAt,
      });
    });
  }

  return encontrados;
}

function normalizeKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function countCreativeLeads(leads: any[], adName?: string | null) {
  const target = normalizeKey(adName);
  if (!target) return 0;
  return leads.filter((lead) => normalizeKey(lead.utm_content) === target).length;
}

async function fetchObjectMap(ids: string[], fields: string, accessToken: string, graphVersion: string, cacheOnly = false) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const result = new Map<string, any>();

  for (let index = 0; index < uniqueIds.length; index += 50) {
    const chunk = uniqueIds.slice(index, index + 50);
    const url = new URL(`https://graph.facebook.com/${graphVersion}/`);
    url.searchParams.set('ids', chunk.join(','));
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', accessToken);

    const response = await metaCachedFetch(url.toString(), {
      ttlSeconds: 3600,
      resourceKind: 'creative-details',
      cacheOnly,
    });
    const payload = await response.json();
    if (!response.ok || payload.error) continue;
    Object.entries(payload || {}).forEach(([id, value]) => result.set(id, value));
  }

  return result;
}

async function fetchActiveCreatives(
  corretor: CorretorMeta,
  since: string,
  until: string,
  accessToken: string,
  graphVersion: string,
  leads: any[],
  cacheOnly = false
) {
  const accountId = normalizeAccountId(String(corretor.meta_ad_account_id));
  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  insightsUrl.searchParams.set('fields', 'spend,ctr,cpc,cpm,frequency,inline_link_clicks,ad_id,ad_name');
  insightsUrl.searchParams.set('level', 'ad');
  insightsUrl.searchParams.set('limit', '100');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('access_token', accessToken);

  const insightsResponse = await metaCachedFetch(insightsUrl.toString(), {
    ttlSeconds: 3600,
    resourceKind: 'active-creatives',
    cacheOnly,
  });
  const insightsPayload = await insightsResponse.json();
  if (!insightsResponse.ok || insightsPayload.error) throw new Error(describeMetaError(insightsPayload.error, accountId));

  const rows = insightsPayload.data || [];
  const adDetails = await fetchObjectMap(
    rows.map((row: any) => row.ad_id),
    'id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,title,body,object_story_spec}',
    accessToken,
    graphVersion,
    cacheOnly
  );

  return rows
    .map((row: any) => {
      const details = adDetails.get(row.ad_id);
      const effectiveStatus = String(details?.effective_status || details?.status || '').toUpperCase();
      const spend = Number(row.spend || 0);
      const leadCount = countCreativeLeads(leads, row.ad_name);
      return {
        id: String(row.ad_id || row.ad_name),
        ad_name: row.ad_name || details?.name || 'Anuncio sem nome',
        corretor_id: corretor.id,
        concessionaria_nome: corretor.nome_empresa || corretor.nome,
        meta_ad_account_id: corretor.meta_ad_account_id,
        meta_ad_account_name: corretor.meta_ad_account_name,
        thumbnail_url: details?.creative?.thumbnail_url || null,
        image_url: details?.creative?.image_url || null,
        spend,
        leads: leadCount,
        cpl: leadCount > 0 ? spend / leadCount : null,
        currency: 'BRL',
        status: effectiveStatus || 'UNKNOWN',
      };
    })
    .filter((creative: any) => creative.status === 'ACTIVE')
    .sort((a: any, b: any) => Number(b.spend || 0) - Number(a.spend || 0))
    .slice(0, 10);
}

async function settleInBatches<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  batchSize = 6
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...await Promise.allSettled(batch.map(worker)));
  }
  return results;
}

function localPortfolioReview(accounts: any[], activeCreatives: any[], recommendations: Recommendation[]) {
  const critical = recommendations.filter((item) => item.severidade === 'critico').length;
  const waiting = accounts.filter((account) => account.rastreio === 'aguardando_integracao').length;
  const broken = accounts.filter((account) => account.rastreio === 'rastreio_quebrado').length;
  const best = accounts
    .filter((account) => account.rastreio === 'ativo' && Number(account.leads || 0) > 0 && Number(account.cpl || 999) < TRAFFIC_RULES.cplAttention)
    .sort((a, b) => Number(a.cpl || 999) - Number(b.cpl || 999))[0];
  const topCreative = activeCreatives
    .filter((creative) => Number(creative.leads || 0) > 0)
    .sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0))[0];

  return [
    `Resumo: ${recommendations.length} acao(oes) na fila, sendo ${critical} critica(s).`,
    waiting ? `${waiting} concessionaria(s) ainda sem integracao de leads. Elas ficaram fora do calculo de CPL.` : 'Todas as concessionarias monitoradas tem rastreio de leads.',
    broken ? `${broken} conta(s) com rastreio quebrado: ja receberam leads antes e zeraram agora.` : '',
    best ? `Melhor conta no momento: ${best.concessionaria_nome || best.corretor_nome}, com CPL de ${Number(best.cpl || 0).toLocaleString('pt-BR', { style: 'currency', currency: best.currency || 'BRL' })}.` : '',
    topCreative ? `Criativo com mais leads: ${topCreative.ad_name}, em ${topCreative.concessionaria_nome}, com ${topCreative.leads} lead(s).` : '',
  ].filter(Boolean).join('\n');
}

async function generatePortfolioAiReview(
  accounts: any[],
  activeCreatives: any[],
  recommendations: Recommendation[],
  since: string,
  until: string
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return localPortfolioReview(accounts, activeCreatives, recommendations);

  const payload = {
    periodo: { since, until },
    regras: TRAFFIC_RULES,
    // Contas sem rastreio ativo entram marcadas para a IA nunca sugerir pausa
    // em cima de um CPL que nao existe.
    contas: accounts.map((account) => ({
      concessionaria: account.concessionaria_nome || account.corretor_nome,
      rastreio: account.rastreio,
      investimento: account.spend,
      leads_crm: account.rastreio === 'ativo' ? account.leads : null,
      cpl_crm: account.rastreio === 'ativo' ? account.cpl : null,
      cpc: account.cpc,
      ctr: account.ctr,
      frequencia: account.frequency,
    })),
    acoes_ja_decididas_pela_regra: recommendations.map((item) => ({
      concessionaria: item.concessionaria_nome,
      alvo: item.alvo_nome,
      acao: item.acao,
      severidade: item.severidade,
      motivo: item.motivo,
    })),
  };

  const response = await openaiFetch('trafego_alertas', 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.ORION_TRAFFIC_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 520,
      messages: [
        {
          role: 'system',
          content: `Voce e uma IA de gestao de trafego para corretoras de planos de saude.
As acoes ja foram decididas por regra deterministica e vem prontas no campo acoes_ja_decididas_pela_regra.
Sua funcao e apenas resumir a carteira em portugues do Brasil, curto, em bullets, para o gestor entender a prioridade do dia.
Regras fixas:
- Nunca invente numero nem crie acao que nao esteja na lista recebida.
- Conta com rastreio "aguardando_integracao" nao tem CPL. Nunca sugira pausar nada nela e deixe claro que a pendencia e de integracao, nao de campanha.
- Conta com rastreio "rastreio_quebrado" precisa de conferencia de webhook e UTM antes de qualquer otimizacao.
- CPL critico e ${TRAFFIC_RULES.cplCritical} reais, atencao e ${TRAFFIC_RULES.cplAttention}, CPC maximo ${TRAFFIC_RULES.cpcMax}, CTR minimo ${TRAFFIC_RULES.ctrMin}%.`
        },
        { role: 'user', content: JSON.stringify(payload).slice(0, 16000) },
      ],
    }),
  });

  if (!response.ok) return localPortfolioReview(accounts, activeCreatives, recommendations);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || localPortfolioReview(accounts, activeCreatives, recommendations);
}

async function fetchAccountMetrics(
  corretor: CorretorMeta,
  since: string,
  until: string,
  accessToken: string,
  graphVersion: string,
  leads: any[]
) {
  const accountId = normalizeAccountId(String(corretor.meta_ad_account_id));
  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  insightsUrl.searchParams.set('fields', 'spend,ctr,cpc,cpm,frequency,clicks,inline_link_clicks,cost_per_inline_link_click,actions,cost_per_action_type');
  insightsUrl.searchParams.set('level', 'account');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('access_token', accessToken);

  const accountUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}`);
  accountUrl.searchParams.set('fields', 'balance,currency,amount_spent,funding_source_details');
  accountUrl.searchParams.set('access_token', accessToken);

  const [insightsResponse, accountResponse] = await Promise.all([
    metaCachedFetch(insightsUrl.toString(), {
      ttlSeconds: 3600,
      resourceKind: 'account-insights',
    }),
    metaCachedFetch(accountUrl.toString(), {
      ttlSeconds: 3600,
      resourceKind: 'account-billing',
    }),
  ]);

  const [insightsPayload, accountPayload] = await Promise.all([
    insightsResponse.json(),
    accountResponse.json(),
  ]);

  if (!insightsResponse.ok || insightsPayload.error) {
    throw new Error(describeMetaError(insightsPayload.error, accountId));
  }

  if (!accountResponse.ok || accountPayload.error) {
    throw new Error(describeMetaError(accountPayload.error, accountId));
  }

  const row = insightsPayload.data?.[0] || {};
  const spend = Number(row.spend || 0);
  const leadCount = leads.length;
  const cpl = leadCount > 0 ? spend / leadCount : null;
  const ctr = Number(row.ctr || 0);
  const cpc = Number(row.cpc || 0);
  const cpm = Number(row.cpm || 0);
  const frequency = Number(row.frequency || 0);
  const clicks = Number(row.clicks || 0);
  const linkClicks = Number(row.inline_link_clicks || 0);
  const costPerLinkClick = Number(row.cost_per_inline_link_click || 0);
  const landingPageViews = Number((row.actions || []).find((item: any) => item.action_type === 'landing_page_view')?.value || 0);
  const costPerLandingPageView = Number((row.cost_per_action_type || []).find((item: any) => item.action_type === 'landing_page_view')?.value || 0);
  const rawBalance = accountPayload?.balance;
  const balance = rawBalance === undefined || rawBalance === null ? null : Number(rawBalance) / 100;
  const fundingDetails = accountPayload?.funding_source_details;
  const fundingText = JSON.stringify(fundingDetails || {}).toLowerCase();
  const isCard = fundingText.includes('card') || fundingText.includes('cart') || fundingText.includes('visa') || fundingText.includes('mastercard') || fundingText.includes('amex');
  const cardPaymentError = isCard && /failed|declined|past.?due|unpaid|payment.?error|billing.?error|recusad|falh/.test(fundingText);
  const displayBalance = parseMoneyFromMetaText(fundingDetails?.display_string);
  const effectiveBalance = displayBalance ?? balance;
  const formaPagamento = isCard
    ? 'Cartao'
    : fundingDetails?.display_string || fundingDetails?.type || (balance !== null ? 'Saldo pre-pago' : 'Nao informado');

  return {
    corretor_id: corretor.id,
    corretor_nome: corretor.nome,
    concessionaria_nome: corretor.nome_empresa || corretor.nome,
    meta_ad_account_id: corretor.meta_ad_account_id,
    meta_ad_account_name: corretor.meta_ad_account_name,
    spend,
    leads: leadCount,
    cpl,
    ctr,
    saldo: isCard ? null : effectiveBalance,
    currency: accountPayload?.currency || 'BRL',
    forma_pagamento: formaPagamento,
    clicks,
    link_clicks: linkClicks,
    cpc,
    cpm,
    frequency,
    landing_page_views: landingPageViews,
    cost_per_link_click: costPerLinkClick,
    cost_per_landing_page_view: costPerLandingPageView,
    alerta_cpl_alto: cpl !== null && cpl >= TRAFFIC_RULES.cplCritical,
    alerta_cpl_atencao: cpl !== null && cpl >= TRAFFIC_RULES.cplAttention && cpl < TRAFFIC_RULES.cplCritical,
    alerta_metricas_secundarias: cpl !== null && cpl >= TRAFFIC_RULES.cplAttention && (cpc > TRAFFIC_RULES.cpcMax || ctr < TRAFFIC_RULES.ctrMin),
    alerta_saldo_baixo: !isCard && effectiveBalance !== null && effectiveBalance <= TRAFFIC_RULES.lowBalance,
    dados_crm_pendentes: spend > 0 && leadCount === 0,
    error: cardPaymentError ? 'A Meta informou um erro de pagamento no cartao desta conta.' : undefined,
    regras: TRAFFIC_RULES,
  };
}

function resolveBrokerageMetaAccount(corretor: CorretorMeta, scopedCorretores: CorretorMeta[]) {
  if (String(corretor.meta_ad_account_id || '').trim()) {
    return corretor;
  }

  const corretoraNome = String(corretor.nome_empresa || '').trim();
  if (!corretoraNome) {
    return corretor;
  }

  const metaOwner = scopedCorretores.find((item) =>
    item.nome_empresa === corretoraNome && String(item.meta_ad_account_id || '').trim()
  );

  if (!metaOwner) return corretor;

  return {
    ...corretor,
    meta_ad_account_id: metaOwner.meta_ad_account_id,
    meta_ad_account_name: metaOwner.meta_ad_account_name,
  };
}

/**
 * Grava a fila do gestor. Recomendacao pendente identica e atualizada em vez de
 * duplicada, e pendencia que a regra deixou de emitir e descartada para a fila
 * nao acumular acao que ja perdeu a validade.
 */
const DECISION_COOLDOWN_DAYS = 7;

function targetKey(accountId: unknown, alvoId: unknown, acao: unknown) {
  return `${accountId || ''}::${alvoId || ''}::${acao}`;
}

async function persistRecommendations(
  recommendations: Recommendation[],
  since: string,
  until: string,
  accountIds: string[]
) {
  const uniqueAccountIds = Array.from(new Set(accountIds.filter(Boolean)));
  if (uniqueAccountIds.length === 0) return [] as any[];

  const cooldownSince = new Date(Date.now() - DECISION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: decided } = await supabaseAdmin
    .from('trafego_recomendacoes')
    .select('meta_ad_account_id, alvo_id, acao, status, decidido_em')
    .in('meta_ad_account_id', uniqueAccountIds)
    .in('status', ['ignorada', 'executada', 'aprovada'])
    .gte('decidido_em', cooldownSince);

  // Acao que o gestor ja decidiu nos ultimos dias nao volta para a fila.
  const recentlyDecided = new Set((decided || []).map((row: any) => targetKey(row.meta_ad_account_id, row.alvo_id, row.acao)));

  // A fila pendente e sempre regenerada a partir das metricas do momento, entao
  // pendencia que a regra deixou de emitir some sozinha. Decisoes ja tomadas
  // ficam preservadas porque so as pendentes sao apagadas.
  const pendingDelete = supabaseAdmin
    .from('trafego_recomendacoes')
    .delete()
    .eq('status', 'pendente')
    .in('meta_ad_account_id', uniqueAccountIds);

  const { error: deleteError } = await pendingDelete;

  if (deleteError) {
    console.error('Erro ao limpar fila de recomendacoes:', deleteError.message);
    throw new Error(`Nao foi possivel preparar a fila de recomendacoes: ${deleteError.message}`);
  }

  // Uma mesma conta pode aparecer mais de uma vez no retorno da Meta. A fila
  // tem uma restricao unica por conta + alvo + acao, entao deduplicamos antes
  // do insert para garantir que cada recomendacao receba um id persistido.
  const uniqueRecommendations = new Map<string, Recommendation>();
  recommendations.forEach((item) => {
    const key = targetKey(item.meta_ad_account_id, item.alvo_id, item.acao);
    if (!uniqueRecommendations.has(key)) uniqueRecommendations.set(key, item);
  });

  const rows = Array.from(uniqueRecommendations.values())
    .filter((item) => !recentlyDecided.has(targetKey(item.meta_ad_account_id, item.alvo_id, item.acao)))
    .map((item) => ({
      corretor_id: item.corretor_id,
      concessionaria_nome: item.concessionaria_nome,
      meta_ad_account_id: item.meta_ad_account_id,
      nivel: item.nivel,
      alvo_id: item.alvo_id,
      alvo_nome: item.alvo_nome,
      acao: item.acao,
      severidade: item.severidade,
      motivo: item.motivo,
      metricas: item.metricas,
      periodo_inicio: since,
      periodo_fim: until,
      status: 'pendente',
      updated_at: new Date().toISOString(),
    }));

  // A troca aprovada cria o novo anuncio pausado e fica na fila ate o gestor
  // confirmar a ativacao. Ela precisa sobreviver a toda nova leitura da Meta.
  const { data: awaitingActivation, error: awaitingError } = await supabaseAdmin
    .from('trafego_recomendacoes')
    .select('id, corretor_id, concessionaria_nome, meta_ad_account_id, nivel, alvo_id, alvo_nome, acao, severidade, motivo, metricas, status')
    .in('meta_ad_account_id', uniqueAccountIds)
    .eq('status', 'aprovada')
    .eq('acao', 'trocar_criativo');
  if (awaitingError) {
    console.error('Erro ao carregar trocas aguardando ativacao:', awaitingError.message);
    throw new Error(`Nao foi possivel carregar as trocas aguardando ativacao: ${awaitingError.message}`);
  }

  let inserted: Record<string, unknown>[] = [];
  if (rows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('trafego_recomendacoes')
      .insert(rows)
      .select('id, corretor_id, concessionaria_nome, meta_ad_account_id, nivel, alvo_id, alvo_nome, acao, severidade, motivo, metricas, status');

    if (error && error.code === '23505') {
      // Duas abas podem concluir a mesma otimização quase juntas. A restrição
      // parcial protege a fila; nesse caso devolvemos a fila que venceu a
      // corrida em vez de transformar a colisão esperada em erro para o gestor.
      const { data: concurrentRows, error: concurrentError } = await supabaseAdmin
        .from('trafego_recomendacoes')
        .select('id, corretor_id, concessionaria_nome, meta_ad_account_id, nivel, alvo_id, alvo_nome, acao, severidade, motivo, metricas, status')
        .in('meta_ad_account_id', uniqueAccountIds)
        .eq('status', 'pendente');
      if (concurrentError) throw new Error(`Não foi possível recuperar as recomendações: ${concurrentError.message}`);
      inserted = concurrentRows || [];
    } else if (error) {
      console.error('Erro ao gravar recomendacoes de trafego:', error.message);
      throw new Error(`Nao foi possivel salvar as recomendacoes: ${error.message}`);
    } else {
      inserted = data || [];
    }
  }

  return [...(awaitingActivation || []), ...inserted];
}

async function loadPersistedRecommendations(accountIds: string[]) {
  const uniqueAccountIds = Array.from(new Set(accountIds.filter(Boolean)));
  if (uniqueAccountIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('trafego_recomendacoes')
    .select('id, corretor_id, concessionaria_nome, meta_ad_account_id, nivel, alvo_id, alvo_nome, acao, severidade, motivo, metricas, status')
    .in('meta_ad_account_id', uniqueAccountIds)
    .in('status', ['pendente', 'aprovada'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Não foi possível carregar as recomendações: ${error.message}`);
  return data || [];
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
    const requestedSince = parseDate(String(body.data_inicio || '')) || defaultRange.since;
    const requestedUntil = parseDate(String(body.data_fim || '')) || defaultRange.until;
    const { since, until } = getMetaCompatibleRange(requestedSince, requestedUntil);
    const search = String(body.nome || '').trim().toLowerCase();
    const corretorId = body.corretor_id ? String(body.corretor_id) : null;
    const requestedGestorId = body.gestor_id ? String(body.gestor_id) : null;
    const shouldAnalyze = Boolean(body.analyze);
    const useCumulativeOrion = body.acumulado_orion === true;
    let scopedGestorProfile = guard.profile;

    if (guard.profile.tipo_usuario === 'admin' && requestedGestorId) {
      const { data: gestorProfile, error: gestorError } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, email_real, tipo_usuario, corretor_id')
        .eq('id', requestedGestorId)
        .eq('tipo_usuario', 'gestor_trafego')
        .maybeSingle();

      if (gestorError) {
        return NextResponse.json({ error: gestorError.message }, { status: 500 });
      }

      if (!gestorProfile) {
        return NextResponse.json({ error: 'Gestor de trafego nao encontrado.' }, { status: 404 });
      }

      scopedGestorProfile = gestorProfile;
    }

    const isCorretorRole = ['corretor', 'corretor_admin', 'corretor_membro'].includes(guard.profile.tipo_usuario);
    if (isCorretorRole && !guard.profile.corretor_id) {
      return NextResponse.json({ success: true, accounts: [] });
    }

    // O escopo por papel precisa ser aplicado nas DUAS consultas. Quando o
    // filtro so existia na primeira, o fallback abaixo devolvia a carteira
    // inteira para um usuario corretor.
    const aplicaEscopo = (consulta: any) => {
      if (scopedGestorProfile.tipo_usuario === 'gestor_trafego') {
        return corretorId ? consulta.eq('id', corretorId) : consulta.not('nome_empresa', 'is', null);
      }
      if (isCorretorRole) {
        return consulta.eq('id', guard.profile.corretor_id);
      }
      if (guard.profile.tipo_usuario === 'admin') {
        return corretorId ? consulta.eq('id', corretorId) : consulta.not('meta_ad_account_id', 'is', null);
      }
      return consulta;
    };

    const colunasBase = 'id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name, time_operacional';

    const primeira = await aplicaEscopo(
      supabaseAdmin
        .from('corretores')
        .select(`${colunasBase}, rastreio_status, rastreio_desde`)
        .order('nome', { ascending: true })
    );

    let corretores: CorretorMeta[] | null = primeira.data;
    let error = primeira.error;

    // A coluna de rastreio pode ainda nao ter sido migrada neste ambiente.
    if (error && String(error.message || '').includes('rastreio_status')) {
      const retry = await aplicaEscopo(
        supabaseAdmin
          .from('corretores')
          .select(colunasBase)
          .order('nome', { ascending: true })
      );
      corretores = ((retry.data || []) as CorretorMeta[]).map((row) => ({ ...row, rastreio_status: null, rastreio_desde: null }));
      error = retry.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const scopedCorretores = scopedGestorProfile.tipo_usuario === 'gestor_trafego'
      ? ((corretores || []) as CorretorMeta[]).filter((corretor) =>
          isGestorLinkedToConcessionariaCorretor(corretor, scopedGestorProfile)
        )
      : ((corretores || []) as CorretorMeta[]);

    const resolvedCorretores = scopedCorretores.map((corretor) => {
      const corretoraNome = String(corretor.nome_empresa || '').trim();
      const scopedGroupIds = corretoraNome
        ? scopedCorretores.filter((item) => item.nome_empresa === corretoraNome).map((item) => item.id)
        : [corretor.id];
      return {
        ...resolveBrokerageMetaAccount(corretor, scopedCorretores),
        scoped_corretor_ids: scopedGroupIds,
      };
    });

    const uniqueByAccount = new Map<string, CorretorMeta>();
    resolvedCorretores.forEach((corretor) => {
      const accountId = String(corretor.meta_ad_account_id || '').trim();
      if (!accountId) return;
      if (!uniqueByAccount.has(accountId)) uniqueByAccount.set(accountId, corretor);
    });

    const filtered = Array.from(uniqueByAccount.values()).filter((corretor) => {
      if (!search) return true;
      return `${corretor.nome} ${corretor.nome_empresa || ''} ${corretor.meta_ad_account_name || ''}`.toLowerCase().includes(search);
    });

    const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';

    const cumulativeByCorretor = new Map<string, { spend: number | null; since: string | null }>();
    if (useCumulativeOrion) {
      const cumulativeSettled = await Promise.allSettled(
        filtered.map((corretor) => fetchOrionCumulativeSpend(
          String(corretor.meta_ad_account_id || ''),
          until,
          accessToken,
          graphVersion
        ))
      );
      filtered.forEach((corretor, index) => {
        const result = cumulativeSettled[index];
        if (result.status === 'fulfilled') cumulativeByCorretor.set(corretor.id, result.value);
      });
    }

    // Leads do CRM sao buscados uma unica vez por concessionaria e reaproveitados
    // pelas metricas de conta e pelos criativos.
    const leadsSettled = await Promise.allSettled(
      filtered.map((corretor) => {
        const cumulativeSince = cumulativeByCorretor.get(corretor.id)?.since;
        return fetchSheetLeads(corretor, cumulativeSince || since, until);
      })
    );
    const leadsByCorretor = new Map<string, any[]>();
    filtered.forEach((corretor, index) => {
      const result = leadsSettled[index];
      leadsByCorretor.set(corretor.id, result.status === 'fulfilled' ? result.value : []);
    });

    const allGroupIds = Array.from(new Set(filtered.flatMap((corretor) => corretor.scoped_corretor_ids || [corretor.id])));
    const historicoOrion = await fetchCorretoresComHistoricoOrion(allGroupIds);

    // Lotes pequenos permitem ler o consumo retornado pela Meta entre uma leva
    // e outra. Assim a protecao de 90% consegue agir antes da proxima rajada.
    const settled = await settleInBatches(
      filtered,
      (corretor) => fetchAccountMetrics(
        corretor,
        since,
        until,
        accessToken,
        graphVersion,
        leadsByCorretor.get(corretor.id) || []
      )
    );

    const accounts = settled
      .map((result, index) => {
        const corretor = filtered[index];
        const groupIds = corretor.scoped_corretor_ids || [corretor.id];
        const groupTracking = groupIds
          .map((id) => historicoOrion.get(id))
          .filter((item): item is OrionTrackingSummary => Boolean(item));
        const everHadOrionLead = groupTracking.length > 0;
        const lastOrionLeadAt = groupTracking
          .map((item) => item.lastLeadAt)
          .filter((value): value is string => Boolean(value))
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

        if (result.status === 'fulfilled') {
          const cumulative = cumulativeByCorretor.get(corretor.id);
          const spend = cumulative?.spend !== null && cumulative?.spend !== undefined
            ? cumulative.spend
            : result.value.spend;
          const leads = leadsByCorretor.get(corretor.id) || [];
          const rastreio: TrackingStatus = resolveTrackingStatus({
            explicitStatus: corretor.rastreio_status,
            everHadOrionLead,
            spend,
            leadsInPeriod: leads.length,
            lastOrionLeadAt,
          });
          return {
            ...result.value,
            spend,
            leads: leads.length,
            rastreio,
            rastreio_desde: corretor.rastreio_desde || null,
            // Sem rastreio ativo o CPL nao significa nada e nao pode alimentar alerta.
            cpl: rastreio === 'ativo' && leads.length > 0 ? spend / leads.length : null,
            alerta_cpl_alto: rastreio === 'ativo' && result.value.alerta_cpl_alto,
            alerta_cpl_atencao: rastreio === 'ativo' && result.value.alerta_cpl_atencao,
            alerta_metricas_secundarias: rastreio === 'ativo' && result.value.alerta_metricas_secundarias,
            dados_crm_pendentes: rastreio === 'rastreio_quebrado',
          };
        }

        return {
          corretor_id: corretor.id,
          corretor_nome: corretor.nome,
          concessionaria_nome: corretor.nome_empresa || corretor.nome,
          meta_ad_account_id: corretor.meta_ad_account_id,
          meta_ad_account_name: corretor.meta_ad_account_name,
          spend: 0,
          leads: 0,
          cpl: null,
          ctr: 0,
          clicks: 0,
          link_clicks: 0,
          cpc: 0,
          cpm: 0,
          frequency: 0,
          landing_page_views: 0,
          cost_per_link_click: 0,
          cost_per_landing_page_view: 0,
          saldo: null,
          currency: 'BRL',
          forma_pagamento: 'Nao informado',
          rastreio: (everHadOrionLead ? 'ativo' : 'aguardando_integracao') as TrackingStatus,
          rastreio_desde: corretor.rastreio_desde || null,
          alerta_cpl_alto: false,
          alerta_cpl_atencao: false,
          alerta_metricas_secundarias: false,
          alerta_saldo_baixo: false,
          dados_crm_pendentes: false,
          regras: TRAFFIC_RULES,
          error: result.reason?.message || 'Erro ao consultar esta conta.',
        };
      })
      .sort((a, b) => Number(b.alerta_cpl_alto) - Number(a.alerta_cpl_alto));

    // O período selecionado atualiza também os criativos. O cache continua
    // protegendo a cota da Meta, mas uma combinação de datas ainda não lida
    // pode consultar a API sem exigir o botão Otimizar.
    const creativeSettled = await settleInBatches(
      filtered,
      (corretor) => fetchActiveCreatives(
        corretor,
        since,
        until,
        accessToken,
        graphVersion,
        leadsByCorretor.get(corretor.id) || [],
        false
      )
    );
    const activeCreatives = creativeSettled
      .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      .sort((a: any, b: any) => Number(b.spend || 0) - Number(a.spend || 0));

    const recommendations = shouldAnalyze
      ? buildRecommendations({
          accounts: accounts as unknown as AccountLike[],
          creatives: activeCreatives as unknown as CreativeLike[],
        })
      : [];

    const accountIds = filtered.map((corretor) => String(corretor.meta_ad_account_id || '')).filter(Boolean);
    // Trocar o período é somente leitura. Recomendações e resumo da IA são
    // gerados e gravados exclusivamente pelo comando Otimizar.
    const persisted = shouldAnalyze
      ? await persistRecommendations(recommendations, since, until, accountIds)
      : await loadPersistedRecommendations(accountIds);

    const portfolioAiReview = shouldAnalyze
      ? await generatePortfolioAiReview(accounts, activeCreatives, recommendations, since, until)
      : '';

    if (shouldAnalyze) {
      await supabaseAdmin.from('trafego_analises').insert({
        gestor_id: scopedGestorProfile.id,
        periodo_inicio: since,
        periodo_fim: until,
        contas_lidas: accounts.length,
        recomendacoes_geradas: recommendations.length,
        resumo_ia: portfolioAiReview,
      });
    }

    const { count: analisesHoje } = await supabaseAdmin
      .from('trafego_analises')
      .select('id', { count: 'exact', head: true })
      .eq('gestor_id', scopedGestorProfile.id)
      .gte('created_at', `${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}T00:00:00.000Z`);

    const { data: ultimaAnalise } = await supabaseAdmin
      .from('trafego_analises')
      .select('created_at, resumo_ia')
      .eq('gestor_id', scopedGestorProfile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const metaUsage = await getMetaUsageSnapshot();

    return NextResponse.json({
      success: true,
      data_inicio: since,
      data_fim: until,
      meta_api: metaUsage ? {
        usage_percent: Number(metaUsage.max_usage_percent || 0),
        updated_at: metaUsage.updated_at,
        protected: Number(metaUsage.max_usage_percent || 0) >= 90,
      } : null,
      refreshed_at: new Date().toISOString(),
      threshold_cpl: TRAFFIC_RULES.cplCritical,
      rules: TRAFFIC_RULES,
      accounts,
      active_creatives: activeCreatives,
      // As acoes precisam vir do banco para carregar o id usado por Aprovar,
      // Pausar e Ignorar. Nunca devolver a lista calculada sem id.
      recomendacoes: persisted,
      analises_hoje: analisesHoje || 0,
      ultima_analise_em: ultimaAnalise?.created_at || null,
      portfolio_ai_review: portfolioAiReview || ultimaAnalise?.resumo_ia || '',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar avisos Meta.' }, { status: 500 });
  }
}
