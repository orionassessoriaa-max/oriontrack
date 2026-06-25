import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureUazapiWebhook, uazapiFetch } from '@/lib/uazapi';

const MASTER_INSTANCE = 'apolo_master_sender';

function normalizeUazapiState(status?: string | null, connected?: boolean) {
  const value = String(status || '').toLowerCase();
  if (connected || ['open', 'connected', 'online'].includes(value)) return 'open';
  if (['connecting', 'qrcode', 'qr', 'pairing'].includes(value)) return 'connecting';
  return 'close';
}

function extractUazapiQrCode(payload: any): string | null {
  return (
    payload?.qrcode ||
    payload?.base64 ||
    payload?.data?.qrcode ||
    payload?.data?.base64 ||
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
      const statePayload = await uazapiFetch('/instance/status', { method: 'GET' }, { instanceName: MASTER_INSTANCE });
      const state = normalizeUazapiState(
        statePayload?.status || statePayload?.instance?.status,
        statePayload?.connected === true || statePayload?.instance?.connected === true
      );
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
