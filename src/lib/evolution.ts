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

export async function evolutionFetch(path: string, init: RequestInit = {}) {
  const baseUrl = cleanBaseUrl(process.env.EVOLUTION_API_URL);
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Conexao do WhatsApp ainda nao foi ativada no servidor.');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || 'Nao consegui falar com o WhatsApp agora.');
  }
  return payload;
}

export async function configureEvolutionWebhook(instance: string) {
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
    });
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
