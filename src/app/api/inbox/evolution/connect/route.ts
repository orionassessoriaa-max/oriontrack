import { NextResponse } from 'next/server';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';

function cleanBaseUrl(value?: string) {
  return String(value || '').replace(/\/+$/, '');
}

function instanceName(profileId: string) {
  const prefix = process.env.EVOLUTION_INSTANCE_PREFIX || 'orion';
  return `${prefix}_${profileId.replace(/-/g, '').slice(0, 18)}`;
}

async function evolutionFetch(path: string, init: RequestInit = {}) {
  const baseUrl = cleanBaseUrl(process.env.EVOLUTION_API_URL);
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Evolution API nao configurada. Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor.');
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
    throw new Error(payload?.message || payload?.error || 'Erro na Evolution API.');
  }
  return payload;
}

export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const instance = instanceName(guard.profile.id);

    try {
      await evolutionFetch('/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName: instance,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
      });
    } catch (error: any) {
      const message = String(error.message || '').toLowerCase();
      if (!message.includes('already') && !message.includes('existe') && !message.includes('exist')) {
        throw error;
      }
    }

    const payload = await evolutionFetch(`/instance/connect/${instance}`, { method: 'GET' });
    const qrcode = payload?.base64 || payload?.qrcode?.base64 || payload?.qrcode || payload?.code || null;

    await writeAuditLog(request, guard.profile, {
      action: 'whatsapp.connect.request',
      entity_type: 'whatsapp_instance',
      entity_id: instance,
    });

    return NextResponse.json({
      success: true,
      instance,
      qrcode,
      raw: qrcode ? undefined : payload,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao conectar WhatsApp.' }, { status: 500 });
  }
}
