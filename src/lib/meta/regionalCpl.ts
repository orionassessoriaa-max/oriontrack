import 'server-only';

import { metaCachedFetch } from './cachedFetch';

export type RegionalCplAccount = {
  id: string;
  name: string;
};

type MetaAction = { action_type?: string; value?: string };
type MetaRegionInsight = {
  ad_id?: string;
  ad_name?: string;
  region?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaAction[];
};

type MetaCreativeDetail = {
  id?: string;
  status?: string;
  effective_status?: string;
  creative?: {
    image_url?: string;
    thumbnail_url?: string;
    title?: string;
    body?: string;
    object_story_spec?: {
      link_data?: { name?: string; message?: string };
      video_data?: { title?: string; message?: string };
    };
    asset_feed_spec?: {
      images?: Array<{ url?: string }>;
      videos?: Array<{ thumbnail_url?: string }>;
      titles?: Array<{ text?: string }>;
      bodies?: Array<{ text?: string }>;
    };
  };
};

type CreativeAggregate = {
  id: string;
  accountId: string;
  accountName: string;
  adId: string;
  name: string;
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
};

type RegionAggregate = {
  key: string;
  name: string;
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  clients: Map<string, { id: string; name: string; spend: number; leads: number }>;
  creatives: Map<string, CreativeAggregate>;
};

const LEAD_ACTION_PRIORITY = [
  'onsite_conversion.lead_grouped',
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.messaging_first_reply',
  'onsite_conversion.total_messaging_connection',
] as const;

const REGION_NAMES: Record<string, string> = {
  Acre: 'Acre',
  Alagoas: 'Alagoas',
  Amapa: 'Amapá',
  Amazonas: 'Amazonas',
  Bahia: 'Bahia',
  Ceara: 'Ceará',
  'Federal District': 'Distrito Federal',
  'Espirito Santo': 'Espírito Santo',
  Goias: 'Goiás',
  Maranhao: 'Maranhão',
  'Mato Grosso': 'Mato Grosso',
  'Mato Grosso do Sul': 'Mato Grosso do Sul',
  'Minas Gerais': 'Minas Gerais',
  Para: 'Pará',
  Paraiba: 'Paraíba',
  Parana: 'Paraná',
  Pernambuco: 'Pernambuco',
  Piaui: 'Piauí',
  'Rio de Janeiro (state)': 'Rio de Janeiro',
  'Rio Grande do Norte': 'Rio Grande do Norte',
  'Rio Grande do Sul': 'Rio Grande do Sul',
  Rondonia: 'Rondônia',
  Roraima: 'Roraima',
  'Santa Catarina': 'Santa Catarina',
  'Sao Paulo (state)': 'São Paulo',
  Sergipe: 'Sergipe',
  Tocantins: 'Tocantins',
};

function normalized(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function regionName(value: unknown) {
  const raw = String(value || '').trim();
  const key = normalized(raw);
  return REGION_NAMES[key] || raw.replace(/ \(state\)$/i, '') || 'Região não informada';
}

function leadCount(actions?: MetaAction[]) {
  const values = new Map((actions || []).map((action) => [String(action.action_type || ''), numberValue(action.value)]));
  for (const actionType of LEAD_ACTION_PRIORITY) {
    const value = values.get(actionType);
    if (value !== undefined) return value;
  }
  return 0;
}

function safeRangeDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

function previousRange(since: string, until: string) {
  const start = new Date(`${since}T12:00:00Z`);
  const end = new Date(`${until}T12:00:00Z`);
  const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - duration + 1);
  return {
    since: previousStart.toISOString().slice(0, 10),
    until: previousEnd.toISOString().slice(0, 10),
  };
}

async function readInsights(accountId: string, since: string, until: string, accessToken: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  url.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,clicks,actions');
  url.searchParams.set('level', 'ad');
  url.searchParams.set('breakdowns', 'region');
  url.searchParams.set('limit', '500');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('access_token', accessToken);

  const rows: MetaRegionInsight[] = [];
  let nextUrl: string | null = url.toString();
  for (let page = 0; nextUrl && page < 20; page += 1) {
    const response = await metaCachedFetch(nextUrl, {
      ttlSeconds: 900,
      resourceKind: 'regional-cpl-insights',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error?.message || 'A Meta não respondeu.');
    rows.push(...(payload.data || []));
    nextUrl = payload.paging?.next || null;
  }
  return rows;
}

async function readCreativeDetails(accountId: string, ids: string[], accessToken: string) {
  const details = new Map<string, MetaCreativeDetail>();
  if (!ids.length) return details;
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  for (let index = 0; index < ids.length; index += 50) {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/ads`);
    url.searchParams.set('fields', 'id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,title,body,object_story_spec,asset_feed_spec}');
    url.searchParams.set('filtering', JSON.stringify([{ field: 'id', operator: 'IN', value: ids.slice(index, index + 50) }]));
    url.searchParams.set('limit', '50');
    url.searchParams.set('access_token', accessToken);
    const response = await metaCachedFetch(url.toString(), {
      ttlSeconds: 3600,
      resourceKind: 'regional-cpl-creative-details',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) continue;
    for (const item of payload.data || []) {
      if (item?.id) details.set(String(item.id), item);
    }
  }
  return details;
}

function addRows(target: Map<string, RegionAggregate>, account: RegionalCplAccount, rows: MetaRegionInsight[]) {
  for (const row of rows) {
    const name = regionName(row.region);
    const key = normalized(name).toLocaleLowerCase('pt-BR') || 'sem-regiao';
    const spend = numberValue(row.spend);
    const leads = leadCount(row.actions);
    const impressions = numberValue(row.impressions);
    const clicks = numberValue(row.clicks);
    const region = target.get(key) || {
      key,
      name,
      spend: 0,
      leads: 0,
      impressions: 0,
      clicks: 0,
      clients: new Map(),
      creatives: new Map(),
    };
    region.spend += spend;
    region.leads += leads;
    region.impressions += impressions;
    region.clicks += clicks;

    const client = region.clients.get(account.id) || { id: account.id, name: account.name, spend: 0, leads: 0 };
    client.spend += spend;
    client.leads += leads;
    region.clients.set(account.id, client);

    const adId = String(row.ad_id || '').trim();
    if (adId) {
      const creativeKey = `${account.id}:${adId}`;
      const creative = region.creatives.get(creativeKey) || {
        id: creativeKey,
        accountId: account.id,
        accountName: account.name,
        adId,
        name: String(row.ad_name || 'Anúncio sem nome'),
        spend: 0,
        leads: 0,
        impressions: 0,
        clicks: 0,
      };
      creative.spend += spend;
      creative.leads += leads;
      creative.impressions += impressions;
      creative.clicks += clicks;
      region.creatives.set(creativeKey, creative);
    }
    target.set(key, region);
  }
}

function creativePresentation(creative: CreativeAggregate, details: Map<string, Map<string, MetaCreativeDetail>>) {
  const detail = details.get(creative.accountId)?.get(creative.adId);
  const metaCreative = detail?.creative || {};
  const linkData = metaCreative.object_story_spec?.link_data || {};
  const videoData = metaCreative.object_story_spec?.video_data || {};
  const assetFeed = metaCreative.asset_feed_spec || {};
  const image = metaCreative.image_url
    || (assetFeed.images || []).find((item) => item?.url)?.url
    || (assetFeed.videos || []).find((item) => item?.thumbnail_url)?.thumbnail_url
    || metaCreative.thumbnail_url
    || null;
  return {
    id: creative.id,
    ad_id: creative.adId,
    name: creative.name,
    client_name: creative.accountName,
    spend: creative.spend,
    leads: creative.leads,
    cpl: creative.leads > 0 ? creative.spend / creative.leads : null,
    impressions: creative.impressions,
    clicks: creative.clicks,
    ctr: creative.impressions > 0 ? (creative.clicks / creative.impressions) * 100 : 0,
    image_url: image,
    title: metaCreative.title || linkData.name || videoData.title || (assetFeed.titles || []).find((item) => item?.text)?.text || null,
    primary_text: metaCreative.body || linkData.message || videoData.message || (assetFeed.bodies || []).find((item) => item?.text)?.text || null,
    status: String(detail?.effective_status || detail?.status || 'UNKNOWN').toUpperCase(),
  };
}

async function settleAccounts<T>(accounts: RegionalCplAccount[], worker: (account: RegionalCplAccount) => Promise<T>) {
  const results: Array<{ account: RegionalCplAccount; value?: T; error?: string }> = [];
  for (let index = 0; index < accounts.length; index += 4) {
    const batch = accounts.slice(index, index + 4);
    const settled = await Promise.allSettled(batch.map(worker));
    settled.forEach((result, resultIndex) => {
      const account = batch[resultIndex];
      results.push(result.status === 'fulfilled'
        ? { account, value: result.value }
        : { account, error: result.reason instanceof Error ? result.reason.message : 'Falha ao consultar a conta.' });
    });
  }
  return results;
}

export async function buildRegionalCplPayload(input: {
  accounts: RegionalCplAccount[];
  since: string;
  until: string;
}) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) throw new Error('Integração Meta indisponível.');
  const since = safeRangeDate(input.since);
  const until = safeRangeDate(input.until);
  const previous = previousRange(since, until);
  const currentRegions = new Map<string, RegionAggregate>();
  const previousRegions = new Map<string, RegionAggregate>();

  const accountResults = await settleAccounts(input.accounts, async (account) => {
    const [current, before] = await Promise.all([
      readInsights(account.id, since, until, accessToken),
      readInsights(account.id, previous.since, previous.until, accessToken),
    ]);
    addRows(currentRegions, account, current);
    addRows(previousRegions, account, before);
    return { current };
  });

  const fulfilled = accountResults.filter((result) => result.value);
  const winningIds = new Map<string, Set<string>>();
  for (const region of currentRegions.values()) {
    const withLeads = Array.from(region.creatives.values()).filter((creative) => creative.leads > 0);
    const candidates = withLeads.some((creative) => creative.leads >= 3)
      ? withLeads.filter((creative) => creative.leads >= 3)
      : withLeads;
    candidates
      .sort((a, b) => (a.spend / a.leads) - (b.spend / b.leads) || b.leads - a.leads)
      .slice(0, 3)
      .forEach((creative) => {
        const ids = winningIds.get(creative.accountId) || new Set<string>();
        ids.add(creative.adId);
        winningIds.set(creative.accountId, ids);
      });
  }

  const detailResults = await settleAccounts(
    input.accounts.filter((account) => winningIds.has(account.id)),
    (account) => readCreativeDetails(account.id, Array.from(winningIds.get(account.id) || []), accessToken),
  );
  const details = new Map<string, Map<string, MetaCreativeDetail>>();
  detailResults.forEach((result) => {
    if (result.value) details.set(result.account.id, result.value);
  });

  const regions = Array.from(currentRegions.values()).map((region) => {
    const cpl = region.leads > 0 ? region.spend / region.leads : null;
    const before = previousRegions.get(region.key);
    const previousCpl = before && before.leads > 0 ? before.spend / before.leads : null;
    const variation = cpl !== null && previousCpl !== null && previousCpl > 0
      ? ((cpl - previousCpl) / previousCpl) * 100
      : null;
    const topCreatives = Array.from(region.creatives.values())
      .filter((creative) => creative.leads > 0)
      .sort((a, b) => {
        const aQualified = a.leads >= 3;
        const bQualified = b.leads >= 3;
        if (aQualified !== bQualified) return bQualified ? 1 : -1;
        return (a.spend / a.leads) - (b.spend / b.leads) || b.leads - a.leads;
      })
      .slice(0, 3)
      .map((creative) => creativePresentation(creative, details));
    const clients = Array.from(region.clients.values())
      .sort((a, b) => b.leads - a.leads || b.spend - a.spend)
      .map((client) => ({ ...client, cpl: client.leads > 0 ? client.spend / client.leads : null }));
    return {
      id: region.key,
      name: region.name,
      spend: region.spend,
      leads: region.leads,
      cpl,
      previous_cpl: previousCpl,
      variation_percent: variation,
      impressions: region.impressions,
      clicks: region.clicks,
      ctr: region.impressions > 0 ? (region.clicks / region.impressions) * 100 : 0,
      client_count: clients.length,
      clients,
      best_creative: topCreatives[0] || null,
      top_creatives: topCreatives,
    };
  }).filter((region) => region.spend > 0).sort((a, b) => b.leads - a.leads || b.spend - a.spend);

  const summary = regions.reduce((total, region) => ({
    spend: total.spend + region.spend,
    leads: total.leads + region.leads,
    impressions: total.impressions + region.impressions,
    clicks: total.clicks + region.clicks,
  }), { spend: 0, leads: 0, impressions: 0, clicks: 0 });

  return {
    period: { since, until, previous_since: previous.since, previous_until: previous.until },
    summary: {
      ...summary,
      cpl: summary.leads > 0 ? summary.spend / summary.leads : null,
      ctr: summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0,
      regions: regions.length,
      accounts: fulfilled.length,
    },
    regions,
    errors: accountResults.filter((result) => result.error).map((result) => ({
      account: result.account.name,
      message: result.error,
    })),
    refreshed_at: new Date().toISOString(),
    criteria: {
      source: 'Meta Ads',
      geography: 'Região de entrega informada pela Meta',
      lead_actions: [...LEAD_ACTION_PRIORITY],
      creative_minimum_leads: 3,
    },
  };
}
