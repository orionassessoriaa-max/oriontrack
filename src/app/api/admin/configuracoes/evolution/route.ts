import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureEvolutionWebhook, evolutionFetch, extractEvolutionQrCode, getEvolutionInstanceApiKey } from '@/lib/evolution';

const MASTER_INSTANCE = 'apolo_master_sender';

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:config:evolution:status', { limit: 30, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    try {
      const statePayload = await evolutionFetch(`/instance/connectionState/${MASTER_INSTANCE}`, { method: 'GET' });
      const state = statePayload?.instance?.state || statePayload?.state || 'close';
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
      createPayload = await evolutionFetch('/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName: MASTER_INSTANCE,
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

    const instanceApiKey = await getEvolutionInstanceApiKey(MASTER_INSTANCE, createPayload);

    await configureEvolutionWebhook(MASTER_INSTANCE, instanceApiKey);

    const payload = await evolutionFetch(`/instance/connect/${MASTER_INSTANCE}`, { method: 'GET' }, instanceApiKey);
    const qrcode = extractEvolutionQrCode(payload);

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

    const instanceApiKey = await getEvolutionInstanceApiKey(MASTER_INSTANCE);

    try {
      await evolutionFetch(`/instance/logout/${MASTER_INSTANCE}`, { method: 'DELETE' }, instanceApiKey);
    } catch (e) {
      console.warn(`Logout failed or already logged out for ${MASTER_INSTANCE}:`, e);
    }

    try {
      await evolutionFetch(`/instance/delete/${MASTER_INSTANCE}`, { method: 'DELETE' }, instanceApiKey);
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
