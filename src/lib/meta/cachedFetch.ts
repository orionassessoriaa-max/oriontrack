import 'server-only';

import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchWithTimeout } from './fetchWithTimeout';

type MetaCachedFetchOptions = {
  ttlSeconds?: number;
  resourceKind?: string;
  priority?: 'normal' | 'critical';
  timeoutMs?: number;
  cacheOnly?: boolean;
};

type CachedRow = {
  payload: unknown;
  http_status: number;
  expires_at: string;
};

const GRAPH_HOSTS = new Set(['graph.facebook.com', 'graph-video.facebook.com']);
const READ_LIMIT_PERCENT = 90;
const inFlight = new Map<string, Promise<Response>>();

function sanitizeUrl(input: string) {
  const url = new URL(input);
  url.searchParams.delete('access_token');
  url.searchParams.sort();
  return url.toString();
}

function cacheKey(input: string) {
  return createHash('sha256').update(sanitizeUrl(input)).digest('hex');
}

function accountIdFromUrl(input: string) {
  const match = new URL(input).pathname.match(/\/act_([^/]+)/);
  return match?.[1] || null;
}

function parseUsageHeader(value: string | null) {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function findMaxUsage(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((max, item) => Math.max(max, findMaxUsage(item)), 0);
  if (!value || typeof value !== 'object') return 0;

  return Object.entries(value as Record<string, unknown>).reduce((max, [key, item]) => {
    if (['call_count', 'total_cputime', 'total_time'].includes(key)) {
      const amount = Number(item || 0);
      return Number.isFinite(amount) ? Math.max(max, amount) : max;
    }
    return Math.max(max, findMaxUsage(item));
  }, 0);
}

function jsonResponse(payload: unknown, status: number, source: 'cache' | 'stale' | 'meta') {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-orion-meta-source': source,
    },
  });
}

async function readCachedRow(key: string) {
  const { data, error } = await supabaseAdmin
    .from('meta_api_cache')
    .select('payload, http_status, expires_at')
    .eq('cache_key', key)
    .maybeSingle();

  // Permite publicar o codigo antes da migration sem derrubar a Meta.
  if (error) return null;
  return data as CachedRow | null;
}

async function currentUsagePercent() {
  const { data, error } = await supabaseAdmin
    .from('meta_api_usage')
    .select('max_usage_percent, updated_at')
    .eq('id', 'current')
    .maybeSingle();

  if (error || !data) return 0;
  const updatedAt = Date.parse(String(data.updated_at || ''));
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 60 * 60 * 1000) return 0;
  return Number(data.max_usage_percent || 0);
}

async function persistUsage(response: Response, endpoint: string, payload: unknown) {
  const appHeader = response.headers.get('x-app-usage');
  const businessHeader = response.headers.get('x-business-use-case-usage');
  const adAccountHeader = response.headers.get('x-ad-account-usage');
  // Algumas respostas auxiliares nao enviam telemetria. Nao sobrescrevemos
  // uma leitura valida recente com zero nesses casos.
  if (!appHeader && !businessHeader && !adAccountHeader) return;

  const appUsage = parseUsageHeader(appHeader);
  const businessUsage = parseUsageHeader(businessHeader);
  const adAccountUsage = parseUsageHeader(adAccountHeader);
  const maxUsage = Math.max(
    findMaxUsage(appUsage),
    findMaxUsage(businessUsage),
    findMaxUsage(adAccountUsage)
  );

  const errorPayload = payload && typeof payload === 'object' && 'error' in payload
    ? (payload as { error?: unknown }).error || null
    : null;

  await supabaseAdmin.from('meta_api_usage').upsert({
    id: 'current',
    app_usage: appUsage,
    business_usage: businessUsage,
    ad_account_usage: adAccountUsage,
    max_usage_percent: maxUsage,
    last_endpoint: endpoint,
    last_http_status: response.status,
    last_error: errorPayload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}

function metaErrorFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const error = (payload as { error?: unknown }).error;
  return error && typeof error === 'object' ? error as Record<string, unknown> : null;
}

function isMetaRateLimit(payload: unknown, status: number) {
  const code = Number(metaErrorFromPayload(payload)?.code || 0);
  return status === 429 || [4, 17, 32, 613].includes(code);
}

export async function metaCachedFetch(input: string, options: MetaCachedFetchOptions = {}) {
  const url = new URL(input);
  if (!GRAPH_HOSTS.has(url.hostname)) {
    throw new Error('metaCachedFetch aceita somente endpoints oficiais da Meta.');
  }

  const ttlSeconds = Math.max(60, options.ttlSeconds ?? 3600);
  const key = cacheKey(input);
  const endpoint = sanitizeUrl(input);
  const cached = await readCachedRow(key);
  const cacheIsFresh = cached && Date.parse(cached.expires_at) > Date.now();

  if (cacheIsFresh) return jsonResponse(cached.payload, cached.http_status, 'cache');

  if (options.cacheOnly) {
    if (cached) return jsonResponse(cached.payload, cached.http_status, 'stale');
    return jsonResponse({ data: [] }, 200, 'cache');
  }

  const usage = await currentUsagePercent();
  if (options.priority !== 'critical' && usage >= READ_LIMIT_PERCENT) {
    if (cached) return jsonResponse(cached.payload, cached.http_status, 'stale');
    return jsonResponse({
      error: {
        code: 429,
        message: 'Consulta Meta adiada para preservar a cota de criacao. Tente novamente em alguns minutos.',
      },
    }, 429, 'stale');
  }

  const pending = inFlight.get(key);
  if (pending) return (await pending).clone();

  const request = (async () => {
    const response = await fetchWithTimeout(input, { cache: 'no-store' }, options.timeoutMs ?? 20000);
    const payload = await response.json().catch(() => ({}));
    await persistUsage(response, endpoint, payload).catch(() => undefined);

    if (isMetaRateLimit(payload, response.status) && cached) {
      return jsonResponse(cached.payload, cached.http_status, 'stale');
    }

    if (response.ok && !metaErrorFromPayload(payload)) {
      const now = new Date();
      try {
        await supabaseAdmin.from('meta_api_cache').upsert({
          cache_key: key,
          endpoint,
          resource_kind: options.resourceKind || 'read',
          account_id: accountIdFromUrl(input),
          payload,
          http_status: response.status,
          expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
          updated_at: now.toISOString(),
        }, { onConflict: 'cache_key' });
      } catch {
        // Cache e protecao, nao dependencia: a consulta valida ainda e devolvida.
      }
    }

    return jsonResponse(payload, response.status, 'meta');
  })();

  inFlight.set(key, request);
  try {
    return (await request).clone();
  } finally {
    inFlight.delete(key);
  }
}

export async function getMetaUsageSnapshot() {
  const { data, error } = await supabaseAdmin
    .from('meta_api_usage')
    .select('max_usage_percent, app_usage, business_usage, ad_account_usage, last_endpoint, last_http_status, last_error, updated_at')
    .eq('id', 'current')
    .maybeSingle();

  return error ? null : data;
}
