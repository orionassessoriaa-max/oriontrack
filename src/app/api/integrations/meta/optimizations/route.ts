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
};

const TRAFFIC_RULES = {
  cplAttention: 20,
  cplCritical: 28,
  cpcMax: 6,
  ctrMin: 1,
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
    .select('id, nome, email, tipo_usuario, corretor_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['admin', 'gestor_trafego', 'corretor', 'corretor_admin', 'corretor_membro'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

function normalizeAccountId(accountId?: string | null) {
  return String(accountId || '').replace(/^act_/, '');
}

function parseDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function currentMonthRange() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    since: new Date(firstDay.getTime() - offset).toISOString().slice(0, 10),
    until: new Date(Date.now() - offset).toISOString().slice(0, 10),
  };
}

function getMetaCompatibleRange(since: string, until: string) {
  const fallback = currentMonthRange();
  const end = parseDate(until) || fallback.until;
  const validSince = parseDate(since) || fallback.since;
  return { since: validSince, until: end };
}

function normalizeKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function describeMetaError(error: any, accountId?: string | null) {
  const message = String(error?.message || '').trim();
  const code = String(error?.code || '').trim();
  const lower = message.toLowerCase();
  const accountText = accountId ? ` (${accountId})` : '';
  if (code === '190' || lower.includes('invalid oauth') || lower.includes('access token')) return 'Token Meta expirado ou invalido.';
  if (lower.includes('permission') || lower.includes('permissions') || lower.includes('permiss')) return `Token Meta sem permissao para ler a conta${accountText}.`;
  return message || 'Nao consegui consultar esta conta Meta agora.';
}

async function resolveBrokerageMetaAccount(corretor: CorretorMeta) {
  if (String(corretor.meta_ad_account_id || '').trim()) return corretor;
  const nomeEmpresa = String(corretor.nome_empresa || '').trim();
  if (!nomeEmpresa) return corretor;

  const { data } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name, time_operacional')
    .eq('nome_empresa', nomeEmpresa)
    .not('meta_ad_account_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ? { ...corretor, meta_ad_account_id: data.meta_ad_account_id, meta_ad_account_name: data.meta_ad_account_name } : corretor;
}

async function getAllowedAccounts(profile: any, requestedGestorId?: string | null) {
  let scopedProfile = profile;

  if (profile.tipo_usuario === 'admin' && requestedGestorId) {
    const { data: gestor } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, tipo_usuario, corretor_id')
      .eq('id', requestedGestorId)
      .eq('tipo_usuario', 'gestor_trafego')
      .maybeSingle();
    if (gestor) scopedProfile = gestor;
  }

  const query = supabaseAdmin
    .from('corretores')
    .select('id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name, time_operacional')
    .order('nome', { ascending: true });

  if (['corretor', 'corretor_admin', 'corretor_membro'].includes(profile.tipo_usuario)) {
    if (!profile.corretor_id) return [];
    query.eq('id', profile.corretor_id);
  } else if (scopedProfile.tipo_usuario === 'gestor_trafego') {
    query.not('nome_empresa', 'is', null);
  } else {
    query.not('meta_ad_account_id', 'is', null);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const scoped = scopedProfile.tipo_usuario === 'gestor_trafego'
    ? ((data || []) as CorretorMeta[]).filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, scopedProfile))
    : ((data || []) as CorretorMeta[]);

  const resolved = await Promise.all(scoped.map((corretor) => resolveBrokerageMetaAccount(corretor)));
  const unique = new Map<string, CorretorMeta>();
  resolved.forEach((corretor) => {
    const accountId = normalizeAccountId(corretor.meta_ad_account_id);
    if (!accountId) return;
    if (!unique.has(accountId)) unique.set(accountId, corretor);
  });
  return Array.from(unique.values());
}

async function fetchCrmLeads(corretor: CorretorMeta, since: string, until: string) {
  const start = `${since}T00:00:00.000-03:00`;
  const end = `${until}T23:59:59.999-03:00`;
  let corretorIds = [corretor.id];

  if (corretor.nome_empresa) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', corretor.nome_empresa);
    const ids = (data || []).map((item) => item.id).filter(Boolean);
    if (ids.length) corretorIds = ids;
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, utm_campaign, utm_term, utm_content, data_entrada')
    .in('corretor_id', corretorIds)
    .gte('data_entrada', start)
    .lte('data_entrada', end);

  if (error) throw new Error(`Erro ao buscar leads CRM: ${error.message}`);
  return data || [];
}

function countLeads(leads: any[], field: 'utm_campaign' | 'utm_term' | 'utm_content', name?: string | null) {
  const target = normalizeKey(name);
  if (!target) return 0;
  return leads.filter((lead) => normalizeKey(lead[field]) === target).length;
}

function metricRow(row: any, crmLeads: number, currency = 'BRL') {
  const spend = Number(row.spend || 0);
  return {
    spend,
    leads_crm: crmLeads,
    cpl_crm: crmLeads > 0 ? spend / crmLeads : null,
    cpc: Number(row.cpc || 0),
    cpm: Number(row.cpm || 0),
    ctr: Number(row.ctr || 0),
    frequency: Number(row.frequency || 0),
    link_clicks: Number(row.inline_link_clicks || row.clicks || 0),
    landing_page_views: Number((row.actions || []).find((item: any) => item.action_type === 'landing_page_view')?.value || 0),
    currency,
  };
}

async function fetchInsights(accountId: string, level: 'account' | 'campaign' | 'adset' | 'ad', since: string, until: string, token: string, graphVersion: string) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  const identityFields = level === 'campaign'
    ? ',campaign_id,campaign_name'
    : level === 'adset'
      ? ',campaign_id,campaign_name,adset_id,adset_name'
      : level === 'ad'
        ? ',campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name'
        : '';
  url.searchParams.set('fields', `spend,ctr,cpc,cpm,frequency,clicks,inline_link_clicks,actions${identityFields}`);
  url.searchParams.set('level', level);
  url.searchParams.set('limit', '500');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('access_token', token);

  const response = await fetch(url.toString(), { next: { revalidate: 300 } });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(describeMetaError(payload.error, accountId));
  return payload.data || [];
}

function buildTree(campaignRows: any[], adsetRows: any[], adRows: any[], leads: any[], currency: string) {
  const adsetsByCampaign = new Map<string, any[]>();
  adsetRows.forEach((row) => {
    const key = String(row.campaign_id || row.campaign_name || 'sem-campanha');
    adsetsByCampaign.set(key, [...(adsetsByCampaign.get(key) || []), row]);
  });

  const adsByAdset = new Map<string, any[]>();
  adRows.forEach((row) => {
    const key = String(row.adset_id || row.adset_name || 'sem-conjunto');
    adsByAdset.set(key, [...(adsByAdset.get(key) || []), row]);
  });

  return campaignRows.map((campaign) => {
    const campaignKey = String(campaign.campaign_id || campaign.campaign_name || 'sem-campanha');
    const campaignName = campaign.campaign_name || 'Campanha sem nome';
    const campaignLeads = countLeads(leads, 'utm_campaign', campaignName);

    return {
      id: campaignKey,
      name: campaignName,
      level: 'campaign',
      metrics: metricRow(campaign, campaignLeads, currency),
      adsets: (adsetsByCampaign.get(campaignKey) || []).map((adset) => {
        const adsetKey = String(adset.adset_id || adset.adset_name || 'sem-conjunto');
        const adsetName = adset.adset_name || 'Conjunto sem nome';
        const adsetLeads = countLeads(leads, 'utm_term', adsetName);
        return {
          id: adsetKey,
          name: adsetName,
          level: 'adset',
          metrics: metricRow(adset, adsetLeads, currency),
          ads: (adsByAdset.get(adsetKey) || []).map((ad) => {
            const adName = ad.ad_name || 'Anuncio sem nome';
            return {
              id: String(ad.ad_id || adName),
              name: adName,
              level: 'ad',
              metrics: metricRow(ad, countLeads(leads, 'utm_content', adName), currency),
            };
          }),
        };
      }),
    };
  });
}

function localRecommendation(total: any) {
  const cpl = Number(total.cpl_crm || 0);
  const cpc = Number(total.cpc || 0);
  const ctr = Number(total.ctr || 0);
  if (total.spend > 0 && total.leads_crm === 0) return 'Ha investimento sem leads no CRM. Antes de mudar campanha, revise formulario, UTM e webhook.';
  if (cpl >= TRAFFIC_RULES.cplCritical) return 'CPL critico. Revisao humana obrigatoria antes de pausar ou trocar criativo.';
  if (cpl >= TRAFFIC_RULES.cplAttention && (cpc > TRAFFIC_RULES.cpcMax || ctr < TRAFFIC_RULES.ctrMin)) return 'CPL em atencao com metrica secundaria ruim. Priorize criativo, publico e pagina.';
  if (cpl >= TRAFFIC_RULES.cplAttention) return 'CPL em atencao. Avalie funil e qualidade dos leads antes de alterar orcamento.';
  return 'Sem alerta critico pelas regras atuais. Continue acompanhando volume, CTR e CPC.';
}

async function generateAiRecommendation(payload: any) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return localRecommendation(payload.total);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.ORION_TRAFFIC_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 420,
      messages: [
        {
          role: 'system',
          content: `Voce e uma IA especialista em Meta Ads para corretoras de plano de saude. Analise com base nestas regras:
- Leads oficiais sempre sao os leads CRM, nunca os leads da Meta.
- CPL critico: pausar/revisar quando CPL CRM chegar a R$ 28,00 ou mais.
- Se CPL CRM estiver acima de R$ 20,00, avaliar metricas secundarias.
- CPC maximo R$ 6,00.
- CTR minimo 1%.
- Frequencia indica fadiga de publico/criativo.
Responda em portugues do Brasil, direto, com recomendacao operacional. Nao invente dados. Se faltar lead CRM, diga para revisar rastreamento antes de otimizar.`
        },
        { role: 'user', content: JSON.stringify(payload).slice(0, 14000) },
      ],
    }),
  });

  if (!response.ok) return localRecommendation(payload.total);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || localRecommendation(payload.total);
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:optimizations', { limit: 45, windowMs: 5 * 60_000 });
    if (limited) return limited;

    const guard = await requireTrafficAccess(request);
    if ('error' in guard) return guard.error;

    const token = process.env.META_ACCESS_TOKEN;
    if (!token) return NextResponse.json({ error: 'META_ACCESS_TOKEN nao configurado no servidor.' }, { status: 500 });

    const body = await request.json();
    const range = getMetaCompatibleRange(String(body.data_inicio || ''), String(body.data_fim || ''));
    const accounts = await getAllowedAccounts(guard.profile, body.gestor_id ? String(body.gestor_id) : null);
    const selectedId = normalizeAccountId(body.account_id || accounts[0]?.meta_ad_account_id);
    const selected = accounts.find((item) => normalizeAccountId(item.meta_ad_account_id) === selectedId) || accounts[0];
    if (!selected) return NextResponse.json({ success: true, accounts: [], selected: null });

    const accountId = normalizeAccountId(selected.meta_ad_account_id);
    const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
    const leads = await fetchCrmLeads(selected, range.since, range.until);
    const [accountRows, campaignRows, adsetRows, adRows] = await Promise.all([
      fetchInsights(accountId, 'account', range.since, range.until, token, graphVersion),
      fetchInsights(accountId, 'campaign', range.since, range.until, token, graphVersion),
      fetchInsights(accountId, 'adset', range.since, range.until, token, graphVersion),
      fetchInsights(accountId, 'ad', range.since, range.until, token, graphVersion),
    ]);

    const currency = 'BRL';
    const total = metricRow(accountRows[0] || {}, leads.length, currency);
    const tree = buildTree(campaignRows, adsetRows, adRows, leads, currency);
    const aiPayload = {
      concessionaria: selected.nome_empresa || selected.nome,
      conta_meta: selected.meta_ad_account_name || selected.meta_ad_account_id,
      periodo: range,
      regras: TRAFFIC_RULES,
      total,
      campanhas: tree.slice(0, 20),
    };
    const ai_recommendation = body.analyze ? await generateAiRecommendation(aiPayload) : '';

    return NextResponse.json({
      success: true,
      data_inicio: range.since,
      data_fim: range.until,
      accounts: accounts.map((account) => ({
        id: account.id,
        concessionaria: account.nome_empresa || account.nome,
        responsavel: account.nome,
        meta_ad_account_id: account.meta_ad_account_id,
        meta_ad_account_name: account.meta_ad_account_name,
      })),
      selected: {
        id: selected.id,
        concessionaria: selected.nome_empresa || selected.nome,
        responsavel: selected.nome,
        meta_ad_account_id: selected.meta_ad_account_id,
        meta_ad_account_name: selected.meta_ad_account_name,
      },
      total,
      tree,
      ai_recommendation,
      fallback_recommendation: localRecommendation(total),
      refreshed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar otimizacoes.' }, { status: 500 });
  }
}
