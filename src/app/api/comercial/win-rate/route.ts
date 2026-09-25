import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { rateLimit } from '@/lib/api/security';
import { metaCachedFetch } from '@/lib/meta/cachedFetch';
import { supabaseAdmin } from '@/lib/supabase/admin';

const KRIPTO_META_ACCOUNT_ID = '1531044161152262';

type LeadRow = {
  id: string;
  status: string | null;
  data_entrada: string;
  reuniao_realizada_at: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

type MetaInsight = {
  ad_id?: string;
  ad_name?: string;
  impressions?: string;
  clicks?: string;
};

function normalize(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

async function readAllLeads(start: string | null, end: string) {
  const rows: LeadRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabaseAdmin
      .from('comercial_leads')
      .select('id,status,data_entrada,reuniao_realizada_at,utm_content,utm_term')
      .lte('data_entrada', `${end}T23:59:59-03:00`)
      .order('data_entrada', { ascending: true })
      .range(offset, offset + 999);
    if (start) query = query.gte('data_entrada', `${start}T00:00:00-03:00`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as LeadRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function readNegotiatedLeadIds(leadIds: string[]) {
  const negotiated = new Set<string>();
  // Lotes menores evitam estourar o limite da URL do PostgREST porque o
  // filtro IN envia cada UUID na propria query string.
  for (let index = 0; index < leadIds.length; index += 50) {
    const chunk = leadIds.slice(index, index + 50);
    const { data, error } = await supabaseAdmin
      .from('comercial_lead_interacoes')
      .select('lead_id,metadata')
      .eq('tipo', 'stage_changed')
      .in('lead_id', chunk);
    if (error) throw new Error(error.message);
    for (const event of data || []) {
      if (normalize(event.metadata?.to_status).includes('negociacao')) negotiated.add(String(event.lead_id));
    }
  }
  return negotiated;
}

async function readMetaCreatives(since: string, until: string, accessToken: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${KRIPTO_META_ACCOUNT_ID}/insights`);
  insightsUrl.searchParams.set('fields', 'ad_id,ad_name,impressions,clicks');
  insightsUrl.searchParams.set('level', 'ad');
  insightsUrl.searchParams.set('limit', '500');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('access_token', accessToken);

  const insights: MetaInsight[] = [];
  let nextUrl: string | null = insightsUrl.toString();
  for (let page = 0; nextUrl && page < 20; page += 1) {
    const response = await metaCachedFetch(nextUrl, {
      ttlSeconds: 900,
      resourceKind: 'commercial-win-rate-insights',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error?.message || 'A Meta nao respondeu.');
    insights.push(...(payload.data || []));
    nextUrl = payload.paging?.next || null;
  }

  const details = new Map<string, any>();
  const ids = Array.from(new Set(insights.map((row) => String(row.ad_id || '')).filter(Boolean)));
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    const detailsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${KRIPTO_META_ACCOUNT_ID}/ads`);
    detailsUrl.searchParams.set(
      'fields',
      'id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,title,body,object_story_spec,asset_feed_spec}',
    );
    // A consulta pela conta continua valida nas versoes em que o parametro
    // global "ids" foi removido e evita uma chamada separada por anuncio.
    detailsUrl.searchParams.set('filtering', JSON.stringify([
      { field: 'id', operator: 'IN', value: chunk },
    ]));
    detailsUrl.searchParams.set('limit', '50');
    detailsUrl.searchParams.set('access_token', accessToken);
    const response = await metaCachedFetch(detailsUrl.toString(), {
      ttlSeconds: 3600,
      resourceKind: 'commercial-win-rate-details',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) continue;
    for (const detail of payload.data || []) {
      if (detail?.id) details.set(String(detail.id), detail);
    }
  }

  return { insights, details };
}

export async function GET(request: Request) {
  try {
    const guard = await requireCommercialUser(request);
    if ('error' in guard) return guard.error;
    const limited = rateLimit(request, 'commercial:win-rate', {
      limit: 30,
      windowMs: 5 * 60_000,
      key: guard.profile.id,
    });
    if (limited) return limited;

    const url = new URL(request.url);
    const end = validDate(url.searchParams.get('ate'))
      ? String(url.searchParams.get('ate'))
      : new Date().toISOString().slice(0, 10);
    const start = validDate(url.searchParams.get('de')) ? String(url.searchParams.get('de')) : null;
    const leads = await readAllLeads(start, end);
    const negotiatedHistory = await readNegotiatedLeadIds(leads.map((lead) => lead.id));
    const accessToken = process.env.META_ACCESS_TOKEN;
    const firstLeadDate = leads[0]?.data_entrada?.slice(0, 10) || start || end;

    let meta: Awaited<ReturnType<typeof readMetaCreatives>> = { insights: [], details: new Map() };
    let metaError: string | null = null;
    if (accessToken) {
      try {
        meta = await readMetaCreatives(start || firstLeadDate, end, accessToken);
      } catch (error) {
        metaError = error instanceof Error ? error.message : 'Nao foi possivel consultar a Meta.';
      }
    } else {
      metaError = 'Integracao Meta indisponivel.';
    }

    const groups = new Map<string, {
      id: string;
      adIds: string[];
      name: string;
      impressions: number;
      clicks: number;
      detail: any;
      leads: LeadRow[];
    }>();
    const referenceToKey = new Map<string, string>();

    for (const insight of meta.insights) {
      const adId = String(insight.ad_id || '');
      const name = String(insight.ad_name || meta.details.get(adId)?.name || 'Anuncio sem nome');
      const key = normalize(name) || adId;
      const current = groups.get(key) || {
        id: key,
        adIds: [],
        name,
        impressions: 0,
        clicks: 0,
        detail: null,
        leads: [],
      };
      current.adIds.push(adId);
      current.impressions += numberValue(insight.impressions);
      current.clicks += numberValue(insight.clicks);
      const detail = meta.details.get(adId);
      if (!current.detail?.creative && detail?.creative) current.detail = detail;
      groups.set(key, current);
      referenceToKey.set(key, key);
      referenceToKey.set(normalize(adId), key);
    }

    let attributed = 0;
    for (const lead of leads) {
      const contentKey = normalize(lead.utm_content);
      const termKey = normalize(lead.utm_term);
      const matchedKey = referenceToKey.get(contentKey) || referenceToKey.get(termKey);
      if (matchedKey) {
        groups.get(matchedKey)?.leads.push(lead);
        attributed += 1;
        continue;
      }
      // Criativos antigos podem ter saido da entrega da Meta, mas a UTM ainda
      // identifica sua origem e nao deve apagar o resultado historico do CRM.
      if (contentKey) {
        const fallback = groups.get(contentKey) || {
          id: `utm:${contentKey}`,
          adIds: [],
          name: String(lead.utm_content),
          impressions: 0,
          clicks: 0,
          detail: null,
          leads: [],
        };
        fallback.leads.push(lead);
        groups.set(contentKey, fallback);
        attributed += 1;
      }
    }

    const hasNegotiated = (lead: LeadRow) => {
      const status = normalize(lead.status);
      return status.includes('negociacao') || status === 'negocio fechado' || negotiatedHistory.has(lead.id);
    };
    const isSale = (lead: LeadRow) => normalize(lead.status) === 'negocio fechado';
    const creatives = Array.from(groups.values())
      .filter((group) => group.leads.length > 0)
      .map((group) => {
        const detail = group.detail || {};
        const creative = detail.creative || {};
        const linkData = creative.object_story_spec?.link_data || {};
        const videoData = creative.object_story_spec?.video_data || {};
        const assetFeed = creative.asset_feed_spec || {};
        const meetings = group.leads.filter((lead) => Boolean(lead.reuniao_realizada_at)).length;
        const negotiations = group.leads.filter(hasNegotiated).length;
        const sales = group.leads.filter(isSale).length;
        return {
          id: group.id,
          ad_ids: group.adIds,
          ad_name: group.name,
          creative_name: creative.name || null,
          title: creative.title || linkData.name || videoData.title || assetFeed.titles?.[0]?.text || null,
          primary_text: creative.body || linkData.message || videoData.message || assetFeed.bodies?.[0]?.text || null,
          image_url: creative.image_url || creative.thumbnail_url || assetFeed.images?.[0]?.url || assetFeed.videos?.[0]?.thumbnail_url || null,
          status: String(detail.effective_status || detail.status || 'HISTORICO').toUpperCase(),
          impressions: group.impressions,
          clicks: group.clicks,
          leads: group.leads.length,
          meetings,
          negotiations,
          sales,
          meeting_rate: rate(meetings, group.leads.length),
          negotiation_rate: rate(negotiations, group.leads.length),
          sales_rate: rate(sales, group.leads.length),
        };
      })
      .sort((a, b) => b.sales - a.sales || b.negotiations - a.negotiations || b.meetings - a.meetings || b.leads - a.leads);

    const meetings = leads.filter((lead) => Boolean(lead.reuniao_realizada_at)).length;
    const negotiations = leads.filter(hasNegotiated).length;
    const sales = leads.filter(isSale).length;

    return NextResponse.json({
      scope: 'orion',
      period: { start: start || firstLeadDate, end, all_time: !start },
      summary: {
        leads: leads.length,
        attributed,
        attribution_rate: rate(attributed, leads.length),
        meetings,
        negotiations,
        sales,
        meeting_rate: rate(meetings, leads.length),
        negotiation_rate: rate(negotiations, leads.length),
        sales_rate: rate(sales, leads.length),
      },
      creatives,
      meta_error: metaError,
      refreshed_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao calcular o Win Rate da Orion.',
    }, { status: 500 });
  }
}
