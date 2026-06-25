import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiProfile, rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureUazapiWebhook, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';

const WHATSAPP_TARGET_ROLES = ['corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;
const CAN_VIEW_AS_ROLES = ['admin', 'gestor_trafego', 'account_manager'] as const;

type WhatsappTargetProfile = ApiProfile & {
  nome_empresa?: string | null;
  equipe_orion?: 'apollo' | 'kripto_hunters' | null;
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
  if (connectedField === true) return 'open';
  const raw = String(value || '').toLowerCase();
  if (['open', 'connected', 'connectado', 'conectado', 'true'].includes(raw)) return 'open';
  if (raw.includes('connecting') || raw.includes('qr') || raw.includes('pairing')) return 'connecting';
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

async function fetchUazapiInstanceState(instance: string) {
  try {
    const payload = await uazapiFetch('/instance/status', { method: 'GET' }, { instanceName: instance });
    const statusStr = payload?.status || payload?.instance?.status || '';
    const isConnected = payload?.instance?.connected === true || payload?.connected === true;
    return normalizeUazapiState(statusStr, isConnected);
  } catch (error) {
    console.warn(`[GET /api/inbox/uazapi/connect] status check failed for ${instance}. returning close.`, error);
    return 'close';
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'inbox:uazapi:connect', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    if (!body.accepted_terms) {
      return NextResponse.json({ error: 'Confirme o aceite para conectar o WhatsApp.' }, { status: 400 });
    }

    const targetProfile = await resolveWhatsappTargetProfile(request, guard.profile);
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

    let createPayload: any = null;
    try {
      createPayload = await uazapiFetch('/instance/init', {
        method: 'POST',
        body: JSON.stringify({
          name: instance,
          instance: instance,
          instanceName: instance,
        }),
      }, { useAdminAuth: true });
    } catch (error: any) {
      const message = String(error.message || '').toLowerCase();
      const isAlreadyExists = error.message === 'Instance already exists' || message.includes('already') || message.includes('existe');
      if (isAlreadyExists) {
        console.log(`[POST /api/inbox/uazapi/connect] Instance ${instance} already exists. Deleting it for self-healing...`);
        try {
          await uazapiFetch('/instance/logout', { method: 'POST' }, { instanceName: instance });
        } catch (e) {
          try {
            await uazapiFetch('/instance/logout', { method: 'DELETE' }, { instanceName: instance });
          } catch (e2) {
            console.warn(`[POST /api/inbox/uazapi/connect] Logout failed during self-healing:`, e2);
          }
        }
        try {
          await uazapiFetch('/instance/delete', { method: 'DELETE' }, { useAdminAuth: true, instanceName: instance });
        } catch (e) {
          console.warn(`[POST /api/inbox/uazapi/connect] Delete failed during self-healing:`, e);
        }
        
        // Retry creating instance
        console.log(`[POST /api/inbox/uazapi/connect] Re-creating instance ${instance}...`);
        createPayload = await uazapiFetch('/instance/init', {
          method: 'POST',
          body: JSON.stringify({
            name: instance,
            instance: instance,
            instanceName: instance,
          }),
        }, { useAdminAuth: true });
      } else {
        throw error;
      }
    }

    await configureUazapiWebhook(instance);

    // Conectar e buscar QR code
    const payload = await uazapiFetch('/instance/connect', {
      method: 'POST',
      body: JSON.stringify({}),
    }, { instanceName: instance });

    const qrcode = extractUazapiQrCode(payload);

    await writeAuditLog(request, guard.profile, {
      action: 'whatsapp.connect.request',
      entity_type: 'whatsapp_instance',
      entity_id: instance,
      metadata: { target_profile_id: targetProfile.id, target_role: targetProfile.tipo_usuario },
    });

    return NextResponse.json({
      success: true,
      instance,
      qrcode,
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
    const limited = rateLimit(request, 'inbox:uazapi:status', { limit: 30, windowMs: 1 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const targetProfile = await resolveWhatsappTargetProfile(request, guard.profile);
    const instance = uazapiInstanceName(targetProfile.id);

    try {
      const state = await fetchUazapiInstanceState(instance);
      return NextResponse.json({
        success: true,
        instance,
        state, // 'open', 'connecting', 'close'
        connected: state === 'open',
        targetProfile: targetPayload(targetProfile),
      });
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
    const limited = rateLimit(request, 'inbox:uazapi:disconnect', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const targetProfile = await resolveWhatsappTargetProfile(request, guard.profile);
    const instance = uazapiInstanceName(targetProfile.id);

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

    await writeAuditLog(request, guard.profile, {
      action: 'whatsapp.disconnect',
      entity_type: 'whatsapp_instance',
      entity_id: instance,
      metadata: { 
        target_profile_id: targetProfile.id, 
        target_role: targetProfile.tipo_usuario,
        disconnected_by: guard.profile.id,
        disconnected_by_role: guard.profile.tipo_usuario
      },
    });

    return NextResponse.json({
      success: true,
      targetProfile: targetPayload(targetProfile),
      message: 'WhatsApp desconectado com sucesso.'
    });
  } catch (error: any) {
    console.error('[DELETE /api/inbox/uazapi/connect] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao desconectar WhatsApp' }, { status: 500 });
  }
}
