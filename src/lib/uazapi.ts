import { PUBLIC_APP_URL } from '@/lib/publicUrl';

function cleanBaseUrl(value?: string) {
  return String(value || '').replace(/\/+$/, '');
}

function getRequestTimeoutMs() {
  const value = Number(process.env.UAZAPI_TIMEOUT_MS || 15000);
  return Number.isFinite(value) && value > 0 ? value : 15000;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getRequestTimeoutMs());

  try {
    return await fetch(url, {
      ...init,
      signal: init.signal || controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Tempo esgotado ao falar com o UAZAPI. Verifique se o servidor e o token estao ativos.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function asArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.instances)) return payload.instances;
  if (Array.isArray(payload?.response)) return payload.response;
  return [];
}

function readInstanceName(instance: any) {
  return String(
    instance?.name ||
    instance?.instanceName ||
    instance?.instance?.name ||
    instance?.instance?.instanceName ||
    instance?.instance ||
    instance?.session ||
    instance?.sessionkey ||
    ''
  );
}

function readInstancePhone(instance: any) {
  const raw = String(
    instance?.phone ||
    instance?.number ||
    instance?.owner ||
    instance?.ownerJid ||
    instance?.jid ||
    instance?.me?.id ||
    instance?.instance?.phone ||
    instance?.instance?.number ||
    instance?.instance?.owner ||
    ''
  );
  return raw.split('@')[0].replace(/\D/g, '');
}

function readInstanceToken(instance: any) {
  return String(
    instance?.token ||
    instance?.instanceToken ||
    instance?.apikey ||
    instance?.apiKey ||
    instance?.key ||
    instance?.credential?.token ||
    ''
  ).trim();
}

function isConnectedUazapiInstance(instance: any) {
  const state = String(
    instance?.status ||
    instance?.state ||
    instance?.connectionStatus ||
    instance?.instance?.status ||
    ''
  ).trim().toLowerCase();
  if (state.includes('disconnect') || state.includes('close') || state.includes('offline') || state.includes('logout')) return false;
  return instance?.connected === true
    || instance?.loggedIn === true
    || ['open', 'connected', 'online', 'loggedin'].includes(state);
}

export type UazapiInstanceConnection = {
  found: boolean;
  connected: boolean;
  state: string;
};

export type UazapiInstanceSummary = UazapiInstanceConnection & {
  name: string;
  phone: string;
};

export async function listUazapiInstanceConnections(): Promise<UazapiInstanceSummary[]> {
  const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
  const grouped = new Map<string, UazapiInstanceSummary>();

  for (const item of asArray(payload)) {
    const name = readInstanceName(item).trim();
    if (!name || name === '[object Object]') continue;
    const state = String(
      item?.status ||
      item?.state ||
      item?.connectionStatus ||
      item?.instance?.status ||
      'unknown'
    ).trim().toLowerCase();
    const summary = {
      name,
      phone: readInstancePhone(item),
      found: true,
      connected: isConnectedUazapiInstance(item),
      state,
    };
    const key = name.toLowerCase();
    const current = grouped.get(key);
    if (!current || (!current.connected && summary.connected)) grouped.set(key, summary);
  }

  return Array.from(grouped.values());
}

export async function getUazapiInstanceConnection(instanceName: string): Promise<UazapiInstanceConnection> {
  const normalizedName = String(instanceName || '').trim().toLowerCase();
  if (!normalizedName) return { found: false, connected: false, state: 'missing' };

  const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
  const matches = asArray(payload).filter(
    (item) => readInstanceName(item).trim().toLowerCase() === normalizedName
  );
  const selected = matches.find(isConnectedUazapiInstance) || matches[0];
  if (!selected) return { found: false, connected: false, state: 'missing' };

  const state = String(
    selected?.status ||
    selected?.state ||
    selected?.connectionStatus ||
    selected?.instance?.status ||
    'unknown'
  ).trim().toLowerCase();

  return {
    found: true,
    connected: isConnectedUazapiInstance(selected),
    state,
  };
}

type EnsureUazapiInstanceResult = {
  created: boolean;
  instance: any;
  duplicateCount: number;
};

// Evita duas criacoes simultaneas no mesmo processo quando o usuario clica
// mais de uma vez ou duas telas solicitam o QR ao mesmo tempo.
const ensureInstanceLocks = new Map<string, Promise<EnsureUazapiInstanceResult>>();

export function uazapiInstanceName(profileId: string) {
  const prefix = process.env.UAZAPI_INSTANCE_PREFIX || 'orion';
  return `${prefix}_${profileId.replace(/-/g, '')}`;
}

export function uazapiAiInstanceName(corretoraId: string) {
  const prefix = process.env.UAZAPI_INSTANCE_PREFIX || 'orion';
  return `${prefix}_ai_${String(corretoraId || '').replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
}

// A IA comercial usa o WhatsApp proprio da Orion, nunca a instancia de uma corretora.
// O fallback corresponde a instancia oficial provisionada no UAZAPI.
const ORION_COMMERCIAL_INSTANCE = 'orion_67cac910f41a4c11981ac70a49cef7e3';
const configuredCommercialInstance = String(process.env.COMMERCIAL_UAZAPI_INSTANCE || '').trim();
export const COMMERCIAL_MASTER_INSTANCE =
  configuredCommercialInstance && configuredCommercialInstance !== 'orion_commercial_sender'
    ? configuredCommercialInstance
    : ORION_COMMERCIAL_INSTANCE;

export function profileIdFromUazapiInstance(instance?: string | null) {
  const prefix = process.env.UAZAPI_INSTANCE_PREFIX || 'orion';
  const raw = String(instance || '');
  const hex = raw.startsWith(`${prefix}_`) ? raw.slice(prefix.length + 1) : raw;
  if (!/^[a-f0-9]{32}$/i.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getUazapiInstanceToken(baseUrl: string, globalToken: string, instanceName: string) {
  const response = await fetchWithTimeout(`${baseUrl}/instance/all`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      admintoken: globalToken,
    },
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || 'Nao consegui listar instancias do UAZAPI.');
  }

  const matchingInstances = asArray(payload).filter(
    (item) => readInstanceName(item).toLowerCase() === instanceName.toLowerCase()
  );
  // O provedor pode devolver registros antigos com o mesmo nome. Para o
  // Apolo, sempre usa primeiro a sessao que esta efetivamente conectada.
  const instance = matchingInstances.find(isConnectedUazapiInstance) || matchingInstances[0];
  const token = readInstanceToken(instance);
  if (!token) {
    throw new Error(`Instancia UAZAPI ${instanceName} ainda nao foi criada ou nao possui token.`);
  }

  return token;
}

export async function uazapiFetch(
  path: string,
  init: RequestInit = {},
  options: { useAdminAuth?: boolean; instanceName?: string } = {}
) {
  const baseUrl = cleanBaseUrl(process.env.UAZAPI_URL);
  const globalToken = process.env.UAZAPI_GLOBAL_TOKEN;

  if (!baseUrl || !globalToken) {
    throw new Error('Conexão do UAZAPI ainda não foi ativada no servidor.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };

  if (options.useAdminAuth) {
    headers['admintoken'] = globalToken;
  } else {
    if (options.instanceName) {
      headers['token'] = await getUazapiInstanceToken(baseUrl, globalToken, options.instanceName);
      headers['sessionkey'] = options.instanceName;
      headers['session'] = options.instanceName;
    } else {
      headers['token'] = globalToken;
    }
  }

  const url = `${baseUrl}${path}`;
  console.log(`[uazapiFetch] Requesting: ${url} | Headers keys: ${Object.keys(headers).join(', ')}`);

  const response = await fetchWithTimeout(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[uazapiFetch ERROR] Path: %s | Status: %s', path, response.status, {
      payload: JSON.stringify(payload, null, 2),
    });

    const payloadStr = JSON.stringify(payload).toLowerCase();
    if (
      payloadStr.includes('already') ||
      payloadStr.includes('já existe') ||
      payloadStr.includes('ja existe') ||
      (payloadStr.includes('exist') && !payloadStr.includes('not exist') && !payloadStr.includes('no exist') && !payloadStr.includes('não exist') && !payloadStr.includes('nao exist'))
    ) {
      throw new Error('Instance already exists');
    }

    const rawMessage = String(payload?.message || payload?.response?.message || payload?.error || '');
    const normalizedMessage = rawMessage.toLowerCase();

    if (response.status === 401 || response.status === 403 || normalizedMessage.includes('forbidden') || normalizedMessage.includes('unauthorized')) {
      throw new Error('A conexão com o UAZAPI foi recusada. Confirme o token global do UAZAPI no servidor e tente novamente.');
    }

    throw new Error(rawMessage || 'Não consegui falar com o UAZAPI agora.');
  }

  return payload;
}

async function createUazapiInstance(instanceName: string) {
  const body = JSON.stringify({
    name: instanceName,
    instance: instanceName,
    instanceName,
  });

  try {
    return await uazapiFetch('/instance/create', {
      method: 'POST',
      body,
    }, { useAdminAuth: true });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    const legacyFallback = message.includes('method not allowed') || message.includes('not found') || message.includes('404');
    if (!legacyFallback) throw error;
    return uazapiFetch('/instance/init', {
      method: 'POST',
      body,
    }, { useAdminAuth: true });
  }
}

export async function ensureUazapiInstance(instanceName: string): Promise<EnsureUazapiInstanceResult> {
  const normalizedName = String(instanceName || '').trim().toLowerCase();
  if (!normalizedName) throw new Error('Nome da instancia UAZAPI nao informado.');

  const running = ensureInstanceLocks.get(normalizedName);
  if (running) return running;

  const operation = (async () => {
    const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
    const matches = asArray(payload).filter(
      (item) => readInstanceName(item).trim().toLowerCase() === normalizedName
    );

    if (matches.length > 0) {
      const selected = matches.find(isConnectedUazapiInstance) || matches[0];
      return {
        created: false,
        instance: selected,
        duplicateCount: Math.max(0, matches.length - 1),
      };
    }

    const created = await createUazapiInstance(instanceName);
    return { created: true, instance: created, duplicateCount: 0 };
  })();

  ensureInstanceLocks.set(normalizedName, operation);
  try {
    return await operation;
  } finally {
    ensureInstanceLocks.delete(normalizedName);
  }
}

export async function configureUazapiWebhook(instanceName: string) {
  let webhookUrl = process.env.UAZAPI_WEBHOOK_URL;
  if (!webhookUrl) {
    const isInternalDocker = String(process.env.UAZAPI_URL).includes('uazapi_uazapi');
    if (isInternalDocker) {
      webhookUrl = 'http://oriontrack_oriontrack:3000/api/inbox/uazapi/webhook';
    } else {
      webhookUrl = `${PUBLIC_APP_URL}/api/inbox/uazapi/webhook`;
    }
  }

  console.log(`[configureUazapiWebhook] Setting webhook for instance ${instanceName} to URL: ${webhookUrl}`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await uazapiFetch('/webhook', {
        method: 'POST',
        body: JSON.stringify({
          url: webhookUrl,
          enabled: true,
          events: ['messages', 'messages_update', 'history', 'connection', 'call'],
          excludeMessages: [],
          addUrlEvents: false,
          addUrlTypesMessages: false,
        })
      }, { instanceName });
      return;
    } catch (error) {
      lastError = error;
      console.error('[configureUazapiWebhook] Attempt %s/3 failed for %s:', attempt, instanceName, error);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError || 'erro desconhecido');
  throw new Error(`Nao foi possivel configurar o recebimento de mensagens da instancia ${instanceName}: ${message}`);
}

const webhookConfigurationTimes = new Map<string, number>();

export async function ensureUazapiWebhookConfigured(instanceName: string, maxAgeMs = 15 * 60 * 1000) {
  const key = String(instanceName || '').trim().toLowerCase();
  if (!key) return;
  const configuredAt = webhookConfigurationTimes.get(key) || 0;
  if (Date.now() - configuredAt < maxAgeMs) return;

  await configureUazapiWebhook(instanceName);
  webhookConfigurationTimes.set(key, Date.now());
}

/**
 * Chave canonica de telefone brasileiro: DDI fora, DDD + 8 digitos finais.
 * Serve para casar o numero gravado no CRM com o JID que a UAZAPI entrega,
 * que nem sempre traz o nono digito.
 */
export function phoneMatchKey(value?: string | null) {
  const digits = normalizePhone(value);
  if (!digits) return '';
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length < 10) return local;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  const subscriber = rest.length === 9 && rest.startsWith('9') ? rest.slice(1) : rest;
  return `${ddd}${subscriber}`;
}

export function normalizePhone(value?: string | null) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits;
}
