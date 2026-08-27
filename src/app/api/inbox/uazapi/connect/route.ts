import { after, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiProfile, rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureUazapiWebhook, ensureUazapiInstance, ensureUazapiWebhookConfigured, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';

const WHATSAPP_TARGET_ROLES = ['corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;
const CAN_VIEW_AS_ROLES = ['admin', 'gestor_trafego', 'account_manager'] as const;

type WhatsappTargetProfile = ApiProfile & {
  nome_empresa?: string | null;
  equipe_orion?: 'apollo' | 'kripto_hunters' | null;
};

type UazapiConnectionSnapshot = {
  state: 'open' | 'connecting' | 'close';
  qrcode: string | null;
  disconnectReason: string;
};

function canViewWhatsappTarget(actor: ApiProfile, target: WhatsappTargetProfile) {
  if (actor.id === target.id) return true;
  if (actor.tipo_usuario === 'admin') return true;
  if (!CAN_VIEW_AS_ROLES.includes(actor.tipo_usuario as any)) return false;
  if (!actor.corretor_id || !target.corretor_id) return false;
  if (actor.corretor_id === target.corretor_id) return true;
  return false;
}

async function resolveWhatsappTargetProfile(request: Request, actor: ApiProfile) {
  const viewingProfileId = request.headers.get('x-orion-view-profile-id');
  if (!viewingProfileId || viewingProfileId === actor.id) {
    return actor as WhatsappTargetProfile;
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, email_real, nome, tipo_usuario, corretor_id, telefone, status, is_admin_master, equipe_orion, nome_empresa')
    .eq('id', viewingProfileId)
    .in('tipo_usuario', WHATSAPP_TARGET_ROLES as unknown as string[])
    .maybeSingle();

  if (error) throw error;
  if (!data || !canViewWhatsappTarget(actor, data as WhatsappTargetProfile)) {
    throw new Error('Voce nao tem permissao para gerenciar o WhatsApp deste perfil.');
  }

  return data as WhatsappTargetProfile;
}

function targetPayload(profile: WhatsappTargetProfile) {
  return {
    id: profile.id,
    nome: profile.nome,
    email: profile.email_real || profile.email,
    tipo_usuario: profile.tipo_usuario,
  };
}

function normalizeUazapiState(value?: unknown, connectedField?: boolean) {
  const raw = String(value || '').toLowerCase();
  if (
    raw.includes('disconnect') ||
    raw.includes('disconnected') ||
    raw.includes('close') ||
    raw.includes('logout') ||
    raw.includes('loggedout')
  ) return 'close';
  if (raw.includes('connecting') || raw.includes('qr') || raw.includes('pairing') || raw.includes('hibernat')) return 'connecting';
  if (['open', 'connected', 'connectado', 'conectado', 'true', 'loggedin'].includes(raw)) return 'open';
  if (connectedField === true) return 'open';
  return 'close';
}

function readUazapiStatus(payload: any) {
  return (
    payload?.instance?.status ||
    payload?.status?.status ||
    (typeof payload?.status === 'string' ? payload.status : '') ||
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
    payload?.status?.loggedIn === true
  );
}

function readUazapiDisconnectReason(payload: any) {
  return String(
    payload?.instance?.lastDisconnectReason ||
    payload?.lastDisconnectReason ||
    payload?.data?.instance?.lastDisconnectReason ||
    payload?.data?.lastDisconnectReason ||
    ''
  );
}

function isTransientUazapiDisconnect(reason: string) {
  const normalized = reason.toLowerCase();
  if (!normalized || normalized.includes('qr code timeout')) return false;
  return (
    normalized.includes('health_reconnect_timeout') ||
    normalized.includes('network error') ||
    normalized.includes('connection closed') ||
    normalized.includes('stream errored') ||
    normalized.includes('server not available') ||
    normalized.includes('temporarily unavailable')
  );
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
    instance?.instance ||
    instance?.session ||
    instance?.sessionkey ||
    ''
  );
}

async function fetchUazapiInstanceStateFromList(instance: string): Promise<UazapiConnectionSnapshot> {
  const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
  const matches = asArray(payload).filter((item) => readInstanceName(item) === instance);
  const found = matches.find((item) => normalizeUazapiState(
    item?.status || item?.state || item?.connectionStatus || item?.sessionStatus,
    item?.connected === true || item?.isConnected === true || item?.loggedIn === true
  ) === 'open') || matches[0];
  if (!found) return { state: 'close', qrcode: null, disconnectReason: '' };
  const qrcode = extractUazapiQrCode(found);
  const normalizedState = normalizeUazapiState(
    found?.status || found?.state || found?.connectionStatus || found?.sessionStatus,
    found?.connected === true || found?.isConnected === true || found?.loggedIn === true
  );
  return {
    state: qrcode && normalizedState === 'close' ? 'connecting' : normalizedState,
    qrcode,
    disconnectReason: readUazapiDisconnectReason(found),
  };
}

function isNonReconnectableSession(value: unknown) {
  const message = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : JSON.stringify(value || {});
  const normalized = message.toLowerCase();
  return normalized.includes('session is not reconnectable') || normalized.includes('not reconnectable');
}

async function connectUazapiInstance(instance: string) {
  return uazapiFetch('/instance/connect', {
    method: 'POST',
    body: JSON.stringify({}),
  }, { instanceName: instance });
}

async function resetUazapiInstanceRuntime(instance: string) {
  return uazapiFetch('/instance/reset', {
    method: 'POST',
    body: JSON.stringify({}),
  }, { instanceName: instance });
}

async function recoverNonReconnectableUazapiInstance(instance: string) {
  // Endpoint oficial da uazapiGO v2.1: remove somente a instancia autenticada
  // pelo token dela. Depois recriamos o mesmo nome para gerar um QR limpo.
  await uazapiFetch('/instance', { method: 'DELETE' }, { instanceName: instance });
  await ensureUazapiInstance(instance);
  await configureUazapiWebhook(instance);
  return connectUazapiInstance(instance);
}

async function disconnectUazapiInstanceEverywhere(instance: string) {
  const body = JSON.stringify({
    instance,
    instanceName: instance,
    name: instance,
    session: instance,
    sessionkey: instance,
  });

  const attempts: Array<{
    label: string;
    path: string;
    init: RequestInit;
    options?: { useAdminAuth?: boolean; instanceName?: string };
  }> = [
    { label: 'logout-token-post', path: '/instance/logout', init: { method: 'POST' }, options: { instanceName: instance } },
    { label: 'logout-token-delete', path: '/instance/logout', init: { method: 'DELETE' }, options: { instanceName: instance } },
    { label: 'disconnect-token-post', path: '/instance/disconnect', init: { method: 'POST' }, options: { instanceName: instance } },
    { label: 'disconnect-token-delete', path: '/instance/disconnect', init: { method: 'DELETE' }, options: { instanceName: instance } },
    { label: 'delete-token-official', path: '/instance', init: { method: 'DELETE' }, options: { instanceName: instance } },
    { label: 'logout-admin-post-body', path: '/instance/logout', init: { method: 'POST', body }, options: { useAdminAuth: true } },
    { label: 'logout-admin-delete-body', path: '/instance/logout', init: { method: 'DELETE', body }, options: { useAdminAuth: true } },
    { label: 'disconnect-admin-post-body', path: '/instance/disconnect', init: { method: 'POST', body }, options: { useAdminAuth: true } },
    { label: 'delete-admin-delete-body', path: '/instance/delete', init: { method: 'DELETE', body }, options: { useAdminAuth: true } },
    { label: 'logout-admin-post-path', path: `/instance/logout/${instance}`, init: { method: 'POST' }, options: { useAdminAuth: true } },
    { label: 'logout-admin-delete-path', path: `/instance/logout/${instance}`, init: { method: 'DELETE' }, options: { useAdminAuth: true } },
    { label: 'disconnect-admin-post-path', path: `/instance/disconnect/${instance}`, init: { method: 'POST' }, options: { useAdminAuth: true } },
    { label: 'delete-admin-delete-path', path: `/instance/delete/${instance}`, init: { method: 'DELETE' }, options: { useAdminAuth: true } },
  ];

  const results: Array<{ label: string; ok: boolean; error?: string }> = [];
  for (const attempt of attempts) {
    try {
      await uazapiFetch(attempt.path, attempt.init, attempt.options || {});
      results.push({ label: attempt.label, ok: true });
    } catch (error: any) {
      results.push({ label: attempt.label, ok: false, error: error?.message || String(error) });
    }
  }

  return results;
}

function extractUazapiQrCode(payload: any): string | null {
  const candidates = [
    payload?.qrcode ||
    null,
    payload?.base64,
    payload?.instance?.qrcode ||
    null,
    payload?.instance?.base64,
    payload?.data?.qrcode ||
    null,
    payload?.data?.base64,
    payload?.data?.instance?.qrcode ||
    null,
    payload?.data?.instance?.base64,
    payload?.qrcode?.base64 ||
    null,
    payload?.qrcode?.code,
    payload?.instance?.qrcode?.base64,
    payload?.instance?.qrcode?.code,
    payload?.data?.qrcode?.base64,
    payload?.data?.qrcode?.code,
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0) || null;
}

async function fetchUazapiInstanceState(instance: string): Promise<UazapiConnectionSnapshot> {
  try {
    const payload = await uazapiFetch('/instance/status', { method: 'GET' }, { instanceName: instance });
    const statusStr = readUazapiStatus(payload);
    const isConnected = readUazapiConnected(payload);
    const qrcode = extractUazapiQrCode(payload);
    const normalizedState = normalizeUazapiState(statusStr, isConnected);
    const state = qrcode && normalizedState === 'close' ? 'connecting' : normalizedState;
    if (state !== 'close') return { state, qrcode, disconnectReason: readUazapiDisconnectReason(payload) };

    // Alguns retornos do UAZAPI podem vir incompletos no endpoint de status.
    // Antes de mostrar desconectado, confirme na lista geral de instancias.
    return await fetchUazapiInstanceStateFromList(instance);
  } catch (error) {
    console.warn('[GET /api/inbox/uazapi/connect] status check failed for %s. Trying instance/all fallback.', instance, error);
    try {
      return await fetchUazapiInstanceStateFromList(instance);
    } catch (fallbackError) {
      console.warn('[GET /api/inbox/uazapi/connect] instance/all fallback failed for %s. returning close.', instance, fallbackError);
      return { state: 'close', qrcode: null, disconnectReason: '' };
    }
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    if (!body.accepted_terms) {
      return NextResponse.json({ error: 'Confirme o aceite para conectar o WhatsApp.' }, { status: 400 });
    }

    const targetProfile = await resolveWhatsappTargetProfile(request, guard.profile);
    const limited = rateLimit(request, 'inbox:uazapi:connect', {
      limit: 12,
      windowMs: 10 * 60_000,
      key: targetProfile.id,
    });
    if (limited) return limited;

    const instance = uazapiInstanceName(targetProfile.id);

    await writeAuditLog(request, guard.profile, {
      action: 'whatsapp.terms.accept',
      entity_type: 'profile',
      entity_id: targetProfile.id,
      metadata: {
        target_profile_id: targetProfile.id,
        target_email: targetProfile.email_real || targetProfile.email,
        target_role: targetProfile.tipo_usuario,
        terms_version: body.terms_version || 'whatsapp-inbox-v1',
        acceptance_text: 'Usuario aceitou conectar o WhatsApp ao Orion Track e permitir exibicao das conversas dos leads para atendimento comercial.',
      },
    });

    const ensuredInstance = await ensureUazapiInstance(instance);
    console.log(`[POST /api/inbox/uazapi/connect] ${ensuredInstance.created ? 'Created' : 'Reusing'} instance ${instance}. Duplicates: ${ensuredInstance.duplicateCount}.`);

    await configureUazapiWebhook(instance);

    // Conectar e buscar QR code
    let recoveredSession = false;
    let resetTransientSession = false;
    let payload: unknown;
    const currentSnapshot = await fetchUazapiInstanceState(instance);
    if (currentSnapshot.state === 'open') {
      payload = { status: 'connected' };
    } else if (currentSnapshot.state === 'connecting' && currentSnapshot.qrcode) {
      // Reaproveita o QR ainda valido. Gerar outro a cada clique invalida o
      // codigo que o usuario ja esta tentando escanear.
      payload = { status: 'connecting', qrcode: currentSnapshot.qrcode };
    } else {
      try {
        if (currentSnapshot.state === 'close' && isTransientUazapiDisconnect(currentSnapshot.disconnectReason)) {
          payload = await resetUazapiInstanceRuntime(instance);
          resetTransientSession = true;
        } else {
          payload = await connectUazapiInstance(instance);
        }
        if (isNonReconnectableSession(payload)) {
          payload = await recoverNonReconnectableUazapiInstance(instance);
          recoveredSession = true;
        }
      } catch (error) {
        if (!isNonReconnectableSession(error)) throw error;
        payload = await recoverNonReconnectableUazapiInstance(instance);
        recoveredSession = true;
      }
    }

    const refreshedSnapshot = await fetchUazapiInstanceState(instance);
    const qrcode = extractUazapiQrCode(payload) || refreshedSnapshot.qrcode;
    const state = (qrcode || resetTransientSession) && refreshedSnapshot.state === 'close'
      ? 'connecting'
      : refreshedSnapshot.state;

    await writeAuditLog(request, guard.profile, {
      action: 'whatsapp.connect.request',
      entity_type: 'whatsapp_instance',
      entity_id: instance,
      metadata: {
        target_profile_id: targetProfile.id,
        target_role: targetProfile.tipo_usuario,
        recovered_non_reconnectable_session: recoveredSession,
        reset_transient_session: resetTransientSession,
      },
    });

    return NextResponse.json({
      success: true,
      instance,
      qrcode,
      state,
      connected: state === 'open',
      targetProfile: targetPayload(targetProfile),
      raw: qrcode ? undefined : payload,
    });
  } catch (error: any) {
    console.error('[POST /api/inbox/uazapi/connect] ERROR:', error);
    const rawMessage = String(error.message || '');
    const message = rawMessage.toLowerCase().includes('forbidden') || rawMessage.includes('403')
      ? 'A conexao com o WhatsApp foi recusada. Confirme o token global do UAZAPI no servidor e tente novamente.'
      : rawMessage || 'Nao consegui gerar o QR Code agora. A equipe Orion pode revisar a conexao do WhatsApp.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const targetProfile = await resolveWhatsappTargetProfile(request, guard.profile);
    const limited = rateLimit(request, 'inbox:uazapi:status', {
      limit: 30,
      windowMs: 1 * 60_000,
      key: targetProfile.id,
    });
    if (limited) return limited;

    const instance = uazapiInstanceName(targetProfile.id);

    try {
      const snapshot = await fetchUazapiInstanceState(instance);
      if (snapshot.state === 'open') {
        after(async () => {
          try {
            await ensureUazapiWebhookConfigured(instance);
          } catch (webhookError) {
            console.error('[GET /api/inbox/uazapi/connect] Failed refreshing webhook for %s:', instance, webhookError);
          }
        });
      }
      return NextResponse.json({
        success: true,
        instance,
        state: snapshot.state, // 'open', 'connecting', 'close'
        connected: snapshot.state === 'open',
        qrcode: snapshot.qrcode,
        disconnectReason: snapshot.state === 'close' ? snapshot.disconnectReason : '',
        statusSource: 'provider',
        targetProfile: targetPayload(targetProfile),
      }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
    } catch (error: any) {
      return NextResponse.json({
        success: true,
        instance,
        state: 'close',
        connected: false,
        targetProfile: targetPayload(targetProfile),
      });
    }
  } catch (error: any) {
    console.error('[GET /api/inbox/uazapi/connect] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao obter status da conexao' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const targetProfile = await resolveWhatsappTargetProfile(request, guard.profile);
    const limited = rateLimit(request, 'inbox:uazapi:disconnect', {
      limit: 12,
      windowMs: 10 * 60_000,
      key: targetProfile.id,
    });
    if (limited) return limited;

    const instance = uazapiInstanceName(targetProfile.id);
    const disconnectResults = await disconnectUazapiInstanceEverywhere(instance);
    const finalSnapshot = await fetchUazapiInstanceStateFromList(instance).catch((error) => {
      console.warn('[DELETE /api/inbox/uazapi/connect] Status check failed after disconnect for %s:', instance, error);
      return { state: 'unknown', qrcode: null, disconnectReason: '' };
    });

    /*
    // 1. Desconecta o WhatsApp da UAZAPI
    try {
      await uazapiFetch('/instance/logout', { method: 'POST' }, { instanceName: instance });
    } catch (e) {
      try {
        await uazapiFetch('/instance/logout', { method: 'DELETE' }, { instanceName: instance });
      } catch (e2) {
        console.warn(`[DELETE /api/inbox/uazapi/connect] Logout failed or already logged out for ${instance}:`, e2);
      }
    }

    // 2. Exclui a instância
    try {
      await uazapiFetch('/instance/delete', { method: 'DELETE' }, { useAdminAuth: true, instanceName: instance });
    } catch (e) {
      console.warn(`[DELETE /api/inbox/uazapi/connect] Delete failed or already deleted for ${instance}:`, e);
    }
    */

    await writeAuditLog(request, guard.profile, {
      action: 'whatsapp.disconnect',
      entity_type: 'whatsapp_instance',
      entity_id: instance,
      metadata: { 
        target_profile_id: targetProfile.id, 
        target_role: targetProfile.tipo_usuario,
        disconnected_by: guard.profile.id,
        disconnected_by_role: guard.profile.tipo_usuario,
        final_state: finalSnapshot.state,
        attempts: disconnectResults,
      },
    });

    return NextResponse.json({
      success: true,
      targetProfile: targetPayload(targetProfile),
      state: finalSnapshot.state,
      attempts: disconnectResults,
      message: 'WhatsApp desconectado com sucesso.'
    });
  } catch (error: any) {
    console.error('[DELETE /api/inbox/uazapi/connect] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao desconectar WhatsApp' }, { status: 500 });
  }
}
