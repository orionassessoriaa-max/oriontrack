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

export function extractEvolutionQrCode(payload: any): string | null {
  const candidates = [
    payload?.base64,
    payload?.data?.base64,
    payload?.qrcode?.base64,
    payload?.data?.qrcode?.base64,
    payload?.qrcode?.code,
    payload?.data?.qrcode?.code,
    payload?.qrcode,
    payload?.data?.qrcode,
    payload?.code,
    payload?.data?.code,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
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
      payload: JSON.stringify(payload, null, 2),
      headers: response.headers
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
    let webhookUrl = process.env.EVOLUTION_WEBHOOK_URL;
    if (!webhookUrl) {
      const isInternalDocker = String(process.env.EVOLUTION_API_URL).includes('evolution_evolution_api');
      if (isInternalDocker) {
        webhookUrl = 'http://oriontrack_oriontrack:3000/api/inbox/evolution/webhook';
      } else {
        webhookUrl = `${PUBLIC_APP_URL}/api/inbox/evolution/webhook`;
      }
    }

    console.log(`[configureEvolutionWebhook] Setting webhook for instance ${instance} to URL: ${webhookUrl}`);

    await evolutionFetch(`/webhook/set/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'CONNECTION_UPDATE'],
        },
      }),
    }, instanceApiKey);
  } catch (err: any) {
    console.error(`[configureEvolutionWebhook ERROR] Failed to set webhook for ${instance}:`, err.message);
  }
}

export function normalizePhone(value?: string | null) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits;
}
