import { NextResponse } from 'next/server';
import { forbidden, rateLimit, requireApiUser } from '@/lib/api/security';
import { isMissingLeadOriginColumn, isOrionLead } from '@/lib/leadOrigin';
import { isLeadSale, normalizeLeadStatus } from '@/lib/leadStatus';
import { metaCachedFetch } from '@/lib/meta/cachedFetch';
import { supabaseAdmin } from '@/lib/supabase/admin';

type BrokerRow = {
  id: string;
  nome: string | null;
  nome_empresa: string | null;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  rastreio_desde?: string | null;
};

type AccountScope = BrokerRow & { brokerIds: string[] };

type LeadRow = {
  id: string;
  data_entrada?: string | null;
  origem?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  operadora?: string | null;
  observacoes?: string | null;
  status?: string | null;
  conta_como_venda?: boolean | null;
  valor_venda?: number | string | null;
  valor_negociacao?: number | string | null;
};

type MetaInsight = {
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
};

const INTERNAL_ROLES = ['admin', 'gestor_trafego', 'designer', 'account_manager'] as const;

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

function normalizeAccountId(value: unknown) {
  return String(value || '').replace(/^act_/, '').trim();
}

function validDate(value: unknown) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function localDate(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function resolveRange(url: string) {
  const params = new URL(url).searchParams;
  const fromIntegration = params.get('desde_integracao') === '1';
  const until = validDate(params.get('ate')) || localDate(new Date());
  const fallbackSince = new Date(`${until}T12:00:00`);
  fallbackSince.setDate(fallbackSince.getDate() - 29);
  const minimum = new Date(`${until}T12:00:00`);
  minimum.setMonth(minimum.getMonth() - 36);
  const requestedSince = validDate(params.get('de')) || localDate(fallbackSince);
  return {
    since: fromIntegration ? localDate(minimum) : requestedSince < localDate(minimum) ? localDate(minimum) : requestedSince,
    until,
    fromIntegration,
  };
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/[^0-9,-]/g, '').replace(/\./g, '').replace(',', '.')
    : raw.replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function leadRevenue(lead: LeadRow) {
  if (!isLeadSale(lead)) return 0;
  return numberValue(lead.valor_venda) || numberValue(lead.valor_negociacao);
}

function leadStage(lead: LeadRow) {
  const status = normalizeLeadStatus(lead.status);
  const sale = isLeadSale(lead);
  return {
    sale,
    negotiation: sale || status === 'Em negociação',
    quote: sale || status === 'Em negociação' || status === 'Cotação enviada',
  };
}

async function readAllLeads(account: AccountScope, since: string, until: string) {
  const rows: LeadRow[] = [];
  const start = `${since}T00:00:00.000-03:00`;
  const end = `${until}T23:59:59.999-03:00`;

  for (let page = 0; page < 20; page += 1) {
    const from = page * 1000;
    const primary = await supabaseAdmin
      .from('leads')
      .select('id,data_entrada,origem,utm_source,utm_medium,utm_campaign,utm_content,utm_term,operadora,observacoes,status,conta_como_venda,valor_venda,valor_negociacao')
      .in('corretor_id', account.brokerIds)
      .gte('data_entrada', start)
      .lte('data_entrada', end)
      .range(from, from + 999);
    let data = primary.data as LeadRow[] | null;
    let error = primary.error;
    if (error && isMissingLeadOriginColumn(error)) {
      const retry = await supabaseAdmin
        .from('leads')
        .select('id,data_entrada,utm_source,utm_medium,utm_campaign,utm_content,utm_term,operadora,observacoes,status,conta_como_venda,valor_venda,valor_negociacao')
        .in('corretor_id', account.brokerIds)
        .gte('data_entrada', start)
        .lte('data_entrada', end)
        .range(from, from + 999);
      data = retry.data as LeadRow[] | null;
      error = retry.error;
    }
    if (error) throw new Error(`CRM: ${error.message}`);
    const pageRows = (data || []) as LeadRow[];
    rows.push(...pageRows.filter(isOrionLead));
    if (pageRows.length < 1000) break;
  }

  return rows;
}

async function readMetaInsights(accountId: string, since: string, until: string, accessToken: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  url.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,clicks,ctr');
  url.searchParams.set('level', 'ad');
  url.searchParams.set('limit', '500');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('access_token', accessToken);

  const rows: MetaInsight[] = [];
  let nextUrl: string | null = url.toString();
  for (let page = 0; nextUrl && page < 10; page += 1) {
    const response = await metaCachedFetch(nextUrl, {
      ttlSeconds: 900,
      resourceKind: 'apollo-creative-performance',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error?.message || 'A Meta nao respondeu.');
    rows.push(...(payload.data || []));
    nextUrl = payload.paging?.next || null;
  }

  const ids = Array.from(new Set(rows.map((row) => String(row.ad_id || '')).filter(Boolean)));
  const details = new Map<string, any>();
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    const detailsUrl = new URL(`https://graph.facebook.com/${graphVersion}/`);
    detailsUrl.searchParams.set('ids', chunk.join(','));
    detailsUrl.searchParams.set(
      'fields',
      'id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,title,body,object_story_spec}'
    );
    detailsUrl.searchParams.set('access_token', accessToken);
    const response = await metaCachedFetch(detailsUrl.toString(), {
      ttlSeconds: 3600,
      resourceKind: 'apollo-creative-details',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) continue;
    Object.entries(payload).forEach(([id, detail]) => details.set(id, detail));
  }

  return { rows, details };
}

async function settleInBatches<T, R>(items: T[], worker: (item: T) => Promise<R>, size = 6) {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.allSettled(items.slice(index, index + size).map(worker)));
  }
  return results;
}

async function loadAccounts() {
  let query = await supabaseAdmin
    .from('corretores')
    .select('id,nome,nome_empresa,meta_ad_account_id,meta_ad_account_name,rastreio_desde')
    .not('meta_ad_account_id', 'is', null)
    .order('nome_empresa');

  if (query.error && String(query.error.message || '').includes('rastreio_desde')) {
    query = await supabaseAdmin
      .from('corretores')
      .select('id,nome,nome_empresa,meta_ad_account_id,meta_ad_account_name')
      .not('meta_ad_account_id', 'is', null)
      .order('nome_empresa') as typeof query;
  }
  if (query.error) throw new Error(query.error.message);

  const all = (query.data || []) as BrokerRow[];
  const byAccount = new Map<string, AccountScope>();
  for (const row of all) {
    const accountId = normalizeAccountId(row.meta_ad_account_id);
    if (!accountId || byAccount.has(accountId)) continue;
    const companyKey = normalizeText(row.nome_empresa || row.nome);
    const brokerIds = all
      .filter((candidate) => normalizeText(candidate.nome_empresa || candidate.nome) === companyKey)
      .map((candidate) => candidate.id);
    byAccount.set(accountId, { ...row, meta_ad_account_id: accountId, brokerIds });
  }
  return Array.from(byAccount.values());
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, INTERNAL_ROLES as any);
    if ('error' in guard) return guard.error;
    if (guard.profile.equipe_orion && guard.profile.equipe_orion !== 'apollo' && guard.profile.tipo_usuario !== 'admin') {
      return forbidden('Pagina exclusiva do Time Apollo.');
    }
    const limited = rateLimit(request, 'apollo:creative-performance', {
      limit: 30,
      windowMs: 5 * 60_000,
      key: guard.profile.id,
    });
    if (limited) return limited;

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) return NextResponse.json({ error: 'Integracao Meta indisponivel.' }, { status: 503 });

    const { since, until, fromIntegration } = resolveRange(request.url);
    const accounts = await loadAccounts();
    const results = await settleInBatches(accounts, async (account) => {
      const accountId = normalizeAccountId(account.meta_ad_account_id);
      let effectiveSince = since;
      let leads: LeadRow[];
      if (fromIntegration) {
        const broadLeads = await readAllLeads(account, since, until);
        const trackingSince = validDate(String(account.rastreio_desde || '').slice(0, 10));
        const firstLeadAt = broadLeads
          .map((lead) => validDate(String(lead.data_entrada || '').slice(0, 10)))
          .filter(Boolean)
          .sort()[0] || '';
        effectiveSince = trackingSince || firstLeadAt || since;
        leads = broadLeads.filter((lead) => String(lead.data_entrada || '').slice(0, 10) >= effectiveSince);
      } else {
        leads = await readAllLeads(account, since, until);
      }
      const meta = await readMetaInsights(accountId, effectiveSince, until, accessToken);

      const groupedAds = new Map<string, {
        ids: string[];
        name: string;
        spend: number;
        impressions: number;
        clicks: number;
        ctrWeighted: number;
        detail: any;
      }>();

      for (const row of meta.rows) {
        const id = String(row.ad_id || '');
        const detail = meta.details.get(id);
        const name = String(row.ad_name || detail?.name || 'Anuncio sem nome');
        const key = normalizeText(name) || id;
        const current = groupedAds.get(key) || {
          ids: [], name, spend: 0, impressions: 0, clicks: 0, ctrWeighted: 0, detail,
        };
        const impressions = numberValue(row.impressions);
        current.ids.push(id);
        current.spend += numberValue(row.spend);
        current.impressions += impressions;
        current.clicks += numberValue(row.clicks);
        current.ctrWeighted += numberValue(row.ctr) * impressions;
        if (!current.detail && detail) current.detail = detail;
        groupedAds.set(key, current);
      }

      const groupByReference = new Map<string, string>();
      groupedAds.forEach((ad, key) => {
        groupByReference.set(key, key);
        ad.ids.forEach((id) => groupByReference.set(normalizeText(id), key));
      });

      const leadsByAd = new Map<string, LeadRow[]>();
      let attributedLeads = 0;
      for (const lead of leads) {
        const contentKey = normalizeText(lead.utm_content);
        const termKey = normalizeText(lead.utm_term);
        const adKey = groupByReference.get(contentKey) || groupByReference.get(termKey);
        if (!adKey) continue;
        leadsByAd.set(adKey, [...(leadsByAd.get(adKey) || []), lead]);
        attributedLeads += 1;
      }

      const creatives = Array.from(groupedAds.entries()).map(([key, ad]) => {
        const attributed = leadsByAd.get(key) || [];
        const sales = attributed.filter((lead) => leadStage(lead).sale).length;
        const negotiations = attributed.filter((lead) => leadStage(lead).negotiation).length;
        const quotes = attributed.filter((lead) => leadStage(lead).quote).length;
        const revenue = attributed.reduce((total, lead) => total + leadRevenue(lead), 0);
        const creative = ad.detail?.creative || {};
        const linkData = creative.object_story_spec?.link_data || {};
        const videoData = creative.object_story_spec?.video_data || {};
        return {
          id: `${accountId}:${key}`,
          ad_ids: ad.ids,
          ad_name: ad.name,
          creative_name: creative.name || null,
          creative_id: creative.id ? String(creative.id) : null,
          title: creative.title || linkData.name || videoData.title || null,
          primary_text: creative.body || linkData.message || videoData.message || null,
          description: linkData.description || videoData.link_description || null,
          destination_url: linkData.link || videoData.call_to_action?.value?.link || null,
          call_to_action: linkData.call_to_action?.type || videoData.call_to_action?.type || null,
          image_url: creative.image_url || creative.thumbnail_url || null,
          client_id: accountId,
          client_name: account.nome_empresa || account.meta_ad_account_name || account.nome || 'Sem nome',
          account_name: account.meta_ad_account_name || null,
          status: String(ad.detail?.effective_status || ad.detail?.status || 'UNKNOWN').toUpperCase(),
          spend: ad.spend,
          impressions: ad.impressions,
          clicks: ad.clicks,
          ctr: ad.impressions > 0 ? ad.ctrWeighted / ad.impressions : 0,
          leads: attributed.length,
          quotes,
          negotiations,
          sales,
          revenue,
          cpl: attributed.length > 0 ? ad.spend / attributed.length : null,
          cost_per_sale: sales > 0 ? ad.spend / sales : null,
          win_rate: attributed.length > 0 ? (sales / attributed.length) * 100 : 0,
          quote_rate: attributed.length > 0 ? (quotes / attributed.length) * 100 : 0,
          negotiation_rate: attributed.length > 0 ? (negotiations / attributed.length) * 100 : 0,
          roas: ad.spend > 0 ? revenue / ad.spend : null,
          sample: attributed.length >= 20 ? 'confiavel' : attributed.length >= 10 ? 'moderada' : 'baixa',
        };
      });

      return {
        account: {
          id: accountId,
          name: account.nome_empresa || account.meta_ad_account_name || account.nome || 'Sem nome',
        },
        leadsTotal: leads.length,
        attributedLeads,
        creatives,
      };
    });

    const fulfilled = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const errors = results.flatMap((result, index) => result.status === 'rejected' ? [{
      client: accounts[index]?.nome_empresa || accounts[index]?.nome || 'Conta Meta',
      message: result.reason instanceof Error ? result.reason.message : 'Falha ao carregar a conta.',
    }] : []);
    const creatives = fulfilled
      .flatMap((result) => result.creatives)
      .sort((a, b) => b.sales - a.sales || b.leads - a.leads || b.spend - a.spend);
    const totalLeads = fulfilled.reduce((sum, result) => sum + result.leadsTotal, 0);
    const attributedLeads = fulfilled.reduce((sum, result) => sum + result.attributedLeads, 0);
    const summary = creatives.reduce((acc, creative) => ({
      spend: acc.spend + creative.spend,
      leads: acc.leads + creative.leads,
      quotes: acc.quotes + creative.quotes,
      negotiations: acc.negotiations + creative.negotiations,
      sales: acc.sales + creative.sales,
      revenue: acc.revenue + creative.revenue,
    }), { spend: 0, leads: 0, quotes: 0, negotiations: 0, sales: 0, revenue: 0 });

    return NextResponse.json({
      success: true,
      data_inicio: since,
      data_fim: until,
      desde_integracao: fromIntegration,
      refreshed_at: new Date().toISOString(),
      clients: fulfilled.map((result) => ({
        ...result.account,
        leads_total: result.leadsTotal,
        attributed_leads: result.attributedLeads,
      })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      creatives,
      summary: {
        ...summary,
        win_rate: summary.leads > 0 ? (summary.sales / summary.leads) * 100 : 0,
        roas: summary.spend > 0 ? summary.revenue / summary.spend : null,
        cost_per_sale: summary.sales > 0 ? summary.spend / summary.sales : null,
        total_crm_leads: totalLeads,
        attributed_leads: attributedLeads,
        attribution_rate: totalLeads > 0 ? (attributedLeads / totalLeads) * 100 : 0,
      },
      errors,
      criteria: {
        minimum_sample: 10,
        attribution: 'Nome ou ID do anuncio registrado na UTM do lead.',
        sale: 'Etapa marcada como venda no CRM.',
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[apollo_creative_performance] GET error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao calcular performance dos criativos.',
    }, { status: 500 });
  }
}
