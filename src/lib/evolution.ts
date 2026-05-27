import { PUBLIC_APP_URL } from '@/lib/publicUrl';

function cleanBaseUrl(value?: string) {
  return String(value || '').replace(/\/+$/, '');
}

export function evolutionInstanceName(profileId: string) {
  const prefix = process.env.EVOLUTION_INSTANCE_PREFIX || 'orion';
  return `${prefix}_${profileId.replace(/-/g, '')}`;
}

export function profileIdFromEvolutionInstance(instance?: string | null) {
  const prefix = process.env.EVOLUTION_INSTANCE_PREFIX || 'orion';
  const raw = String(instance || '');
  const hex = raw.startsWith(`${prefix}_`) ? raw.slice(prefix.length + 1) : raw;
  if (!/^[a-f0-9]{32}$/i.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readInstanceToken(payload: any, instanceName: string): string | null {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [payload];
  const match = rows.find((row: any) => {
    const name = row?.instance?.instanceName || row?.instanceName || row?.name;
    return !name || name === instanceName;
  }) || payload;

  return String(
    match?.hash?.apikey ||
    match?.instance?.apikey ||
    match?.instance?.token ||
    match?.apikey ||
    match?.token ||
    ''
  ).trim() || null;
}

export async function evolutionFetch(path: string, init: RequestInit = {}, apiKeyOverride?: string | null) {
  const baseUrl = cleanBaseUrl(process.env.EVOLUTION_API_URL);
  const apiKey = apiKeyOverride || process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Conexao do WhatsApp ainda nao foi ativada no servidor.');
  }

  console.log(`[evolutionFetch] Requesting: ${baseUrl}${path}`);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[evolutionFetch ERROR] Path: ${path} | Status: ${response.status}`, {
      payload,
      headers: response.headers
    });
    const rawMessage = String(payload?.message || payload?.error || payload?.response?.message || '');
    const normalizedMessage = rawMessage.toLowerCase();

    if (response.status === 401 || response.status === 403 || normalizedMessage.includes('forbidden')) {
      throw new Error('A conexao com o WhatsApp foi recusada. Confirme a chave da Evolution API no servidor e tente novamente.');
    }

    throw new Error(rawMessage || 'Nao consegui falar com o WhatsApp agora.');
  }
  return payload;
}

export async function getEvolutionInstanceApiKey(instance: string, createPayload?: any) {
  const createdToken = readInstanceToken(createPayload, instance);
  if (createdToken) return createdToken;

  try {
    const fetched = await evolutionFetch(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    return readInstanceToken(fetched, instance) || process.env.EVOLUTION_API_KEY || null;
  } catch {
    return process.env.EVOLUTION_API_KEY || null;
  }
}

export async function configureEvolutionWebhook(instance: string, instanceApiKey?: string | null) {
  try {
    await evolutionFetch(`/webhook/set/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: `${PUBLIC_APP_URL}/api/inbox/evolution/webhook`,
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'CONNECTION_UPDATE'],
        },
      }),
    }, instanceApiKey);
  } catch {
    // Some Evolution installations use global webhook settings only.
    // The inbox still works for outbound messages and stored conversations.
  }
}

export function normalizePhone(value?: string | null) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits;
}
