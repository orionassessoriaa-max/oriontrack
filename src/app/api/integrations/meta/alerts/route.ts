import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

type CorretorMeta = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  nome_empresa: string | null;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  time_operacional?: unknown;
  scoped_corretor_ids?: string[];
};

const TRAFFIC_RULES = {
  cplAttention: 20,
  cplCritical: 28,
  cpcMax: 6,
  ctrMin: 1,
  lowBalance: 100,
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

async function fetchSheetLeadCount(corretor: CorretorMeta, since: string, until: string) {
  const start = `${since}T00:00:00.000-03:00`;
  const end = `${until}T23:59:59.999-03:00`;
  let corretorIds = corretor.scoped_corretor_ids?.length ? corretor.scoped_corretor_ids : [corretor.id];

  const corretoraNome = String(corretor.nome_empresa || '').trim();
  if (!corretor.scoped_corretor_ids?.length && corretoraNome) {
    let groupQuery = supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', corretoraNome);

    if (corretor.gestor_trafego_id) {
      groupQuery = groupQuery.eq('gestor_trafego_id', corretor.gestor_trafego_id);
    }

    const { data: groupCorretores, error: groupError } = await groupQuery;

    if (groupError) throw new Error(`Erro ao buscar corretores da concessionaria: ${groupError.message}`);
    const groupIds = (groupCorretores || []).map((item) => item.id).filter(Boolean);
    if (groupIds.length > 0) corretorIds = groupIds;
  }

  const { count, error } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('corretor_id', corretorIds)
    .gte('data_entrada', start)
    .lte('data_entrada', end);

  if (error) throw new Error(`Erro ao contar leads da planilha: ${error.message}`);
  return count || 0;
}

async function fetchSheetLeads(corretor: CorretorMeta, since: string, until: string) {
  const start = `${since}T00:00:00.000-03:00`;
  const end = `${until}T23:59:59.999-03:00`;
  let corretorIds = corretor.scoped_corretor_ids?.length ? corretor.scoped_corretor_ids : [corretor.id];

  const corretoraNome = String(corretor.nome_empresa || '').trim();
  if (!corretor.scoped_corretor_ids?.length && corretoraNome) {
    let groupQuery = supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', corretoraNome);

    if (corretor.gestor_trafego_id) {
      groupQuery = groupQuery.eq('gestor_trafego_id', corretor.gestor_trafego_id);
    }

    const { data: groupCorretores, error: groupError } = await groupQuery;
    if (groupError) throw new Error(`Erro ao buscar corretores da concessionaria: ${groupError.message}`);
    const groupIds = (groupCorretores || []).map((item) => item.id).filter(Boolean);
    if (groupIds.length > 0) corretorIds = groupIds;
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, utm_content, data_entrada')
    .in('corretor_id', corretorIds)
    .gte('data_entrada', start)
    .lte('data_entrada', end);

  if (error) throw new Error(`Erro ao buscar leads CRM: ${error.message}`);
  return data || [];
}

function normalizeKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function countCreativeLeads(leads: any[], adName?: string | null) {
  const target = normalizeKey(adName);
  if (!target) return 0;
  return leads.filter((lead) => normalizeKey(lead.utm_content) === target).length;
}

async function fetchObjectMap(ids: string[], fields: string, accessToken: string, graphVersion: string) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const result = new Map<string, any>();

  for (let index = 0; index < uniqueIds.length; index += 50) {
    const chunk = uniqueIds.slice(index, index + 50);
    const url = new URL(`https://graph.facebook.com/${graphVersion}/`);
    url.searchParams.set('ids', chunk.join(','));
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url.toString(), { next: { revalidate: 600 } });
    const payload = await response.json();
    if (!response.ok || payload.error) continue;
    Object.entries(payload || {}).forEach(([id, value]) => result.set(id, value));
  }

  return result;
}

async function fetchActiveCreatives(corretor: CorretorMeta, since: string, until: string, accessToken: string, graphVersion: string) {
  const accountId = normalizeAccountId(String(corretor.meta_ad_account_id));
  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  insightsUrl.searchParams.set('fields', 'spend,ctr,cpc,cpm,frequency,inline_link_clicks,ad_id,ad_name');
  insightsUrl.searchParams.set('level', 'ad');
  insightsUrl.searchParams.set('limit', '100');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('access_token', accessToken);

  const [insightsResponse, leads] = await Promise.all([
    fetch(insightsUrl.toString(), { next: { revalidate: 600 } }),
    fetchSheetLeads(corretor, since, until),
  ]);
  const insightsPayload = await insightsResponse.json();
  if (!insightsResponse.ok || insightsPayload.error) throw new Error(describeMetaError(insightsPayload.error, accountId));

  const rows = insightsPayload.data || [];
  const adDetails = await fetchObjectMap(
    rows.map((row: any) => row.ad_id),
    'id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,title,body,object_story_spec}',
    accessToken,
    graphVersion
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
    .slice(0, 3);
}

function localPortfolioReview(accounts: any[], activeCreatives: any[]) {
  const critical = accounts.filter((account) => account.alerta_cpl_alto || account.error).length;
  const crmPending = accounts.filter((account) => account.dados_crm_pendentes).length;
  const attention = accounts.filter((account) => account.alerta_cpl_atencao || account.alerta_metricas_secundarias).length;
  const best = accounts
    .filter((account) => Number(account.leads || 0) > 0 && Number(account.cpl || 999) < TRAFFIC_RULES.cplAttention)
    .sort((a, b) => Number(a.cpl || 999) - Number(b.cpl || 999))[0];
  const topCreative = activeCreatives
    .filter((creative) => Number(creative.leads || 0) > 0)
    .sort((a, b) => Number(b.leads || 0) - Number(a.leads || 0))[0];

  return [
    `Resumo: ${critical} conta(s) critica(s), ${attention} em atencao e ${crmPending} com CRM pendente.`,
    best ? `Melhor conta no momento: ${best.concessionaria_nome || best.corretor_nome}, com CPL CRM de ${Number(best.cpl || 0).toLocaleString('pt-BR', { style: 'currency', currency: best.currency || 'BRL' })}.` : 'Nenhuma conta saudavel com leads CRM suficientes para ranquear como melhor.',
    topCreative ? `Criativo com mais leads CRM: ${topCreative.ad_name}, em ${topCreative.concessionaria_nome}, com ${topCreative.leads} lead(s).` : 'Ainda nao ha criativo ativo com lead CRM atribuido por UTM de anuncio.',
    'Regra de seguranca: quando ha investimento e zero lead CRM, revisar webhook/UTM antes de julgar CPL ou aprovar qualquer acao.',
  ].join('\n');
}

async function generatePortfolioAiReview(accounts: any[], activeCreatives: any[], since: string, until: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return localPortfolioReview(accounts, activeCreatives);

  const payload = {
    periodo: { since, until },
    regras: TRAFFIC_RULES,
    contas: accounts.map((account) => ({
      concessionaria: account.concessionaria_nome || account.corretor_nome,
      investimento: account.spend,
      leads_crm: account.leads,
      cpl_crm: account.cpl,
      cpc: account.cpc,
      ctr: account.ctr,
      cpm: account.cpm,
      frequencia: account.frequency,
      status: account.error ? account.error : account.dados_crm_pendentes ? 'CRM pendente' : account.alerta_cpl_alto ? 'CPL critico' : account.alerta_cpl_atencao ? 'Atencao' : 'Saudavel',
    })),
    criativos_ativos: activeCreatives.map((creative) => ({
      concessionaria: creative.concessionaria_nome,
      anuncio: creative.ad_name,
      investimento: creative.spend,
      leads_crm: creative.leads,
      cpl_crm: creative.cpl,
      status: creative.status,
    })),
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.ORION_TRAFFIC_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 520,
      messages: [
        {
          role: 'system',
          content: `Voce e uma IA de gestao de trafego para corretoras de planos de saude. Regras fixas:
- Leads oficiais sempre sao os leads CRM, nunca leads reportados pela Meta.
- CPL critico quando CPL CRM chegar a R$ 28,00 ou mais.
- CPL acima de R$ 20,00 exige avaliar CPC, CTR, CPM, visualizacao de pagina e frequencia.
- CPC maximo R$ 6,00.
- CTR minimo 1%.
- Se houver investimento e zero lead CRM, classifique como CRM pendente e recomende revisar webhook/UTM antes de otimizar.
Responda em portugues do Brasil, curto, em bullets, sem inventar dados.`
        },
        { role: 'user', content: JSON.stringify(payload).slice(0, 16000) },
      ],
    }),
  });

  if (!response.ok) return localPortfolioReview(accounts, activeCreatives);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || localPortfolioReview(accounts, activeCreatives);
}

async function fetchAccountMetrics(corretor: CorretorMeta, since: string, until: string, accessToken: string, graphVersion: string) {
  const accountId = normalizeAccountId(String(corretor.meta_ad_account_id));
  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  insightsUrl.searchParams.set('fields', 'spend,ctr,cpc,cpm,frequency,clicks,inline_link_clicks,cost_per_inline_link_click,actions,cost_per_action_type');
  insightsUrl.searchParams.set('level', 'account');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('access_token', accessToken);

  const accountUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}`);
  accountUrl.searchParams.set('fields', 'balance,currency,amount_spent,funding_source_details');
  accountUrl.searchParams.set('access_token', accessToken);

  const [insightsResponse, accountResponse, sheetLeads] = await Promise.all([
    fetch(insightsUrl.toString(), { next: { revalidate: 900 } }),
    fetch(accountUrl.toString(), { next: { revalidate: 900 } }),
    fetchSheetLeadCount(corretor, since, until),
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
  const leads = sheetLeads;
  const cpl = leads > 0 ? spend / leads : null;
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
    leads,
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
      alerta_saldo_baixo: !isCard && effectiveBalance !== null && effectiveBalance < TRAFFIC_RULES.lowBalance,
      dados_crm_pendentes: spend > 0 && leads === 0,
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

    const query = supabaseAdmin
      .from('corretores')
      .select('id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name, time_operacional')
      .order('nome', { ascending: true });

    if (scopedGestorProfile.tipo_usuario === 'gestor_trafego') {
      if (corretorId) {
        query.eq('id', corretorId);
      } else {
        query.not('nome_empresa', 'is', null);
      }
    } else if (['corretor', 'corretor_admin', 'corretor_membro'].includes(guard.profile.tipo_usuario)) {
      if (!guard.profile.corretor_id) {
        return NextResponse.json({ success: true, accounts: [] });
      }
      query.eq('id', guard.profile.corretor_id);
    } else if (guard.profile.tipo_usuario === 'admin') {
      if (corretorId) {
        query.eq('id', corretorId);
      } else {
        query.not('meta_ad_account_id', 'is', null);
      }
    }

    const { data: corretores, error } = await query;
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

    const creativeSettled = await Promise.allSettled(
      filtered.map((corretor) => fetchActiveCreatives(corretor, since, until, accessToken, graphVersion))
    );
    const activeCreatives = creativeSettled
      .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      .sort((a: any, b: any) => Number(b.spend || 0) - Number(a.spend || 0))
      .slice(0, 20);
    const portfolioAiReview = shouldAnalyze
      ? await generatePortfolioAiReview(accounts, activeCreatives, since, until)
      : '';

    return NextResponse.json({
      success: true,
      data_inicio: since,
      data_fim: until,
      refreshed_at: new Date().toISOString(),
      threshold_cpl: TRAFFIC_RULES.cplCritical,
      rules: TRAFFIC_RULES,
      accounts,
      active_creatives: activeCreatives,
      portfolio_ai_review: portfolioAiReview,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar avisos Meta.' }, { status: 500 });
  }
}
