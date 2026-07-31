import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureUazapiWebhook, uazapiFetch } from '@/lib/uazapi';

const MASTER_INSTANCE = 'apolo_master_sender';

function normalizeUazapiState(status?: string | null, connected?: boolean) {
  const value = String(status || '').toLowerCase();
  if (
    !value ||
    value.includes('disconnect') ||
    value.includes('disconnected') ||
    value.includes('close') ||
    value.includes('logout') ||
    value.includes('loggedout')
  ) return 'close';
  if (connected || ['open', 'connected', 'online', 'loggedin'].includes(value)) return 'open';
  if (['connecting', 'qrcode', 'qr', 'pairing'].includes(value)) return 'connecting';
  return 'close';
}

function readUazapiStatus(payload: any) {
  return (
    payload?.instance?.status ||
    payload?.status?.status ||
    payload?.state ||
    ''
  );
}

function readUazapiConnected(payload: any) {
  return (
    payload?.connected === true ||
    payload?.loggedIn === true ||
    payload?.instance?.connected === true ||
    payload?.instance?.loggedIn === true ||
    payload?.status?.connected === true ||
    payload?.status?.loggedIn === true ||
    Boolean(payload?.jid || payload?.status?.jid || payload?.instance?.jid || payload?.instance?.owner)
  );
}

function asInstances(payload: any): any[] {
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
    instance?.instance ||
    instance?.session ||
    instance?.sessionkey ||
    ''
  );
}

async function fetchMasterState() {
  try {
    const statePayload = await uazapiFetch('/instance/status', { method: 'GET' }, { instanceName: MASTER_INSTANCE });
    const state = normalizeUazapiState(
      readUazapiStatus(statePayload),
      readUazapiConnected(statePayload)
    );
    if (state === 'open' || state === 'connecting') return state;
  } catch (error) {
    console.warn('[Apolo master] Consulta direta falhou; confirmando na lista de instancias.', error);
  }

  const listPayload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
  const master = asInstances(listPayload).find(
    (instance) => readInstanceName(instance).toLowerCase() === MASTER_INSTANCE.toLowerCase()
  );
  if (!master) return 'close';
  return normalizeUazapiState(
    readUazapiStatus(master) || master?.status || master?.state,
    readUazapiConnected(master) || master?.connected === true
  );
}

function extractUazapiQrCode(payload: any): string | null {
  return (
    payload?.qrcode ||
    payload?.base64 ||
    payload?.instance?.qrcode ||
    payload?.instance?.base64 ||
    payload?.data?.qrcode ||
    payload?.data?.base64 ||
    payload?.data?.instance?.qrcode ||
    payload?.data?.instance?.base64 ||
    payload?.qrcode?.base64 ||
    payload?.qrcode?.code ||
    null
  );
}

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:config:evolution:status', { limit: 30, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    try {
      const state = await fetchMasterState();
      return NextResponse.json({
        success: true,
        instance: MASTER_INSTANCE,
        state, // 'open', 'connecting', 'close'
        connected: state === 'open',
      });
    } catch (error: any) {
      return NextResponse.json({
        success: true,
        instance: MASTER_INSTANCE,
        state: 'close',
        connected: false,
      });
    }
  } catch (error: any) {
    console.error('[GET /api/admin/configuracoes/evolution] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao obter status da conexao mestre' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:config:evolution:connect', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    if (!body.accepted_terms) {
      return NextResponse.json({ error: 'Confirme o aceite para conectar a Chave Mestra.' }, { status: 400 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'admin.whatsapp.master.terms.accept',
      entity_type: 'profile',
      entity_id: guard.profile.id,
      metadata: {
        terms_version: body.terms_version || 'whatsapp-master-v1',
        acceptance_text: 'Administrador aceitou conectar a Chave Mestra do Apolo ao sistema.',
      },
    });

    let createPayload: any = null;
    try {
      createPayload = await uazapiFetch('/instance/init', {
        method: 'POST',
        body: JSON.stringify({
          name: MASTER_INSTANCE,
          instance: MASTER_INSTANCE,
          instanceName: MASTER_INSTANCE,
        }),
      }, { useAdminAuth: true });
    } catch (error: any) {
      const message = String(error.message || '').toLowerCase();
      if (!message.includes('already') && !message.includes('existe') && !message.includes('exist')) {
        throw error;
      }
    }

    await configureUazapiWebhook(MASTER_INSTANCE);

    const payload = await uazapiFetch('/instance/connect', {
      method: 'POST',
      body: JSON.stringify({}),
    }, { instanceName: MASTER_INSTANCE });
    const qrcode = extractUazapiQrCode(payload);

    await writeAuditLog(request, guard.profile, {
      action: 'admin.whatsapp.master.connect.request',
      entity_type: 'whatsapp_instance',
      entity_id: MASTER_INSTANCE,
    });

    return NextResponse.json({
      success: true,
      instance: MASTER_INSTANCE,
      qrcode,
      raw: qrcode ? undefined : payload,
    });
  } catch (error: any) {
    console.error('[POST /api/admin/configuracoes/evolution] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao iniciar conexao da Chave Mestra' }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:config:evolution:disconnect', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    try {
      await uazapiFetch('/instance/logout', { method: 'POST' }, { instanceName: MASTER_INSTANCE });
    } catch (e) {
      try {
        await uazapiFetch('/instance/logout', { method: 'DELETE' }, { instanceName: MASTER_INSTANCE });
      } catch (fallbackError) {
        console.warn(`Logout failed or already logged out for ${MASTER_INSTANCE}:`, fallbackError);
      }
    }

    try {
      await uazapiFetch('/instance/delete', { method: 'DELETE' }, { useAdminAuth: true, instanceName: MASTER_INSTANCE });
    } catch (e) {
      console.warn(`Delete failed or already deleted for ${MASTER_INSTANCE}:`, e);
    }

    await writeAuditLog(request, guard.profile, {
      action: 'admin.whatsapp.master.disconnect',
      entity_type: 'whatsapp_instance',
      entity_id: MASTER_INSTANCE,
    });

    return NextResponse.json({
      success: true,
      message: 'WhatsApp da Chave Mestra desconectado com sucesso.'
    });
  } catch (error: any) {
    console.error('[DELETE /api/admin/configuracoes/evolution] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao desconectar Chave Mestra' }, { status: 500 });
  }
}
