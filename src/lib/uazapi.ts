import { PUBLIC_APP_URL } from '@/lib/publicUrl';

function cleanBaseUrl(value?: string) {
  return String(value || '').replace(/\/+$/, '');
}

export function uazapiInstanceName(profileId: string) {
  const prefix = process.env.UAZAPI_INSTANCE_PREFIX || 'orion';
  return `${prefix}_${profileId.replace(/-/g, '')}`;
}

export function profileIdFromUazapiInstance(instance?: string | null) {
  const prefix = process.env.UAZAPI_INSTANCE_PREFIX || 'orion';
  const raw = String(instance || '');
  const hex = raw.startsWith(`${prefix}_`) ? raw.slice(prefix.length + 1) : raw;
  if (!/^[a-f0-9]{32}$/i.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
    headers['token'] = globalToken;
    if (options.instanceName) {
      headers['sessionkey'] = options.instanceName;
      headers['session'] = options.instanceName;
    }
  }

  const url = `${baseUrl}${path}`;
  console.log(`[uazapiFetch] Requesting: ${url} | Headers keys: ${Object.keys(headers).join(', ')}`);

  const response = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[uazapiFetch ERROR] Path: ${path} | Status: ${response.status}`, {
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

export async function configureUazapiWebhook(instanceName: string) {
  try {
    let webhookUrl = process.env.UAZAPI_WEBHOOK_URL;
    if (!webhookUrl) {
      const isInternalDocker = String(process.env.UAZAPI_URL).includes('uazapi');
      if (isInternalDocker) {
        webhookUrl = 'http://oriontrack_oriontrack:3000/api/inbox/uazapi/webhook';
      } else {
        webhookUrl = `${PUBLIC_APP_URL}/api/inbox/uazapi/webhook`;
      }
    }

    console.log(`[configureUazapiWebhook] Setting webhook for instance ${instanceName} to URL: ${webhookUrl}`);

    await uazapiFetch('/webhook', {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          events: ['messages', 'connection', 'status', 'qrcode']
        },
        url: webhookUrl,
        enabled: true,
        events: ['messages', 'connection', 'status', 'qrcode']
      })
    }, { instanceName });

  } catch (err: any) {
    console.error(`[configureUazapiWebhook ERROR] Failed to set webhook for ${instanceName}:`, err.message);
  }
}

export function normalizePhone(value?: string | null) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits;
}
