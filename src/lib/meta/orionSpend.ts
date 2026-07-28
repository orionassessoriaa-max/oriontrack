type MetaPage<T> = { data?: T[]; paging?: { next?: string } };

import { fetchWithTimeout } from './fetchWithTimeout';

function normalizeAccountId(value: string) {
  return value.replace(/^act_/, '');
}

function isOrionCampaign(name: unknown) {
  return /\borion\b/i.test(String(name || ''));
}

async function fetchAll<T>(url: URL, maxPages = 20): Promise<T[]> {
  const rows: T[] = [];
  let next = url.toString();

  for (let page = 0; page < maxPages && next; page += 1) {
    const response = await fetchWithTimeout(next, { next: { revalidate: 300 } });
    const payload = await response.json() as MetaPage<T> & { error?: any };
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || 'Falha ao consultar campanhas Orion na Meta.');
    }
    rows.push(...(payload.data || []));
    next = payload.paging?.next || '';
  }

  return rows;
}

export async function fetchOrionCumulativeSpend(
  accountId: string,
  until: string,
  accessToken: string,
  graphVersion: string
) {
  const normalizedId = normalizeAccountId(accountId);
  const campaignsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${normalizedId}/campaigns`);
  campaignsUrl.searchParams.set('fields', 'id,name,created_time');
  campaignsUrl.searchParams.set('limit', '500');
  campaignsUrl.searchParams.set('access_token', accessToken);

  const campaigns = (await fetchAll<{ id: string; name?: string; created_time?: string }>(campaignsUrl))
    .filter((campaign) => isOrionCampaign(campaign.name));

  if (campaigns.length === 0) return { spend: null, since: null };

  const dates = campaigns
    .map((campaign) => String(campaign.created_time || '').slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const since = dates[0] || until;

  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${normalizedId}/insights`);
  insightsUrl.searchParams.set('fields', 'spend,campaign_id,campaign_name');
  insightsUrl.searchParams.set('level', 'campaign');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('limit', '500');
  insightsUrl.searchParams.set('access_token', accessToken);

  const rows = await fetchAll<{ campaign_id?: string; campaign_name?: string; spend?: string }>(insightsUrl);
  const campaignIds = new Set(campaigns.map((campaign) => String(campaign.id)));
  const spend = rows.reduce((total, row) => {
    const belongsToOrion = (row.campaign_id && campaignIds.has(String(row.campaign_id))) || isOrionCampaign(row.campaign_name);
    return belongsToOrion ? total + Number(row.spend || 0) : total;
  }, 0);

  return { spend, since };
}
