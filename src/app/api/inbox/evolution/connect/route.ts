import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureEvolutionWebhook, evolutionFetch, evolutionInstanceName, extractEvolutionQrCode, getEvolutionInstanceApiKey } from '@/lib/evolution';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'inbox:evolution:connect', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    if (!body.accepted_terms) {
      return NextResponse.json({ error: 'Confirme o aceite para conectar o WhatsApp.' }, { status: 400 });
    }

    let targetProfile = guard.profile;
    const viewingProfileId = request.headers.get('x-orion-view-profile-id');
    if (guard.profile.tipo_usuario === 'admin' && viewingProfileId) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, status')
        .eq('id', viewingProfileId)
        .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro', 'account_manager'])
        .maybeSingle();
      if (data) targetProfile = { ...data, is_admin_master: false, equipe_orion: null } as typeof targetProfile;
    }

    const instance = evolutionInstanceName(targetProfile.id);

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
      createPayload = await evolutionFetch('/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName: instance,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
      });
    } catch (error: any) {
      const message = String(error.message || '').toLowerCase();
      const isAlreadyExists = error.message === 'Instance already exists' || message.includes('already') || message.includes('existe');
      if (isAlreadyExists) {
        console.log(`[POST /api/inbox/evolution/connect] Instance ${instance} already exists. Deleting it for self-healing...`);
        const instanceApiKey = await getEvolutionInstanceApiKey(instance).catch(() => null);
        try {
          await evolutionFetch(`/instance/logout/${instance}`, { method: 'DELETE' }, instanceApiKey);
        } catch (e) {
          console.warn(`[POST /api/inbox/evolution/connect] Logout failed during self-healing:`, e);
        }
        try {
          await evolutionFetch(`/instance/delete/${instance}`, { method: 'DELETE' }, instanceApiKey);
        } catch (e) {
          console.warn(`[POST /api/inbox/evolution/connect] Delete failed during self-healing:`, e);
        }
        
        // Retry creating instance
        console.log(`[POST /api/inbox/evolution/connect] Re-creating instance ${instance}...`);
        createPayload = await evolutionFetch('/instance/create', {
          method: 'POST',
          body: JSON.stringify({
            instanceName: instance,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        });
      } else {
        throw error;
      }
    }

    const instanceApiKey = await getEvolutionInstanceApiKey(instance, createPayload);

    await configureEvolutionWebhook(instance, instanceApiKey);

    const payload = await evolutionFetch(`/instance/connect/${instance}`, { method: 'GET' }, instanceApiKey);
    const qrcode = extractEvolutionQrCode(payload);

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
      raw: qrcode ? undefined : payload,
    });
  } catch (error: any) {
    console.error('[POST /api/inbox/evolution/connect] ERROR:', error);
    const rawMessage = String(error.message || '');
    const message = rawMessage.toLowerCase().includes('forbidden') || rawMessage.includes('403')
      ? 'A conexao com o WhatsApp foi recusada. Confirme a chave da Evolution API no servidor e tente novamente.'
      : rawMessage || 'Nao consegui gerar o QR Code agora. A equipe Orion pode revisar a conexao do WhatsApp.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'inbox:evolution:status', { limit: 30, windowMs: 1 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    let targetProfile = guard.profile;
    const viewingProfileId = request.headers.get('x-orion-view-profile-id');
    if (guard.profile.tipo_usuario === 'admin' && viewingProfileId) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, status')
        .eq('id', viewingProfileId)
        .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro', 'account_manager'])
        .maybeSingle();
      if (data) targetProfile = { ...data, is_admin_master: false, equipe_orion: null } as typeof targetProfile;
    }

    const instance = evolutionInstanceName(targetProfile.id);

    try {
      const statePayload = await evolutionFetch(`/instance/connectionState/${instance}`, { method: 'GET' });
      const state = statePayload?.instance?.state || statePayload?.state || 'close';
      return NextResponse.json({
        success: true,
        instance,
        state, // 'open', 'connecting', 'close'
        connected: state === 'open',
      });
    } catch (error: any) {
      return NextResponse.json({
        success: true,
        instance,
        state: 'close',
        connected: false,
      });
    }
  } catch (error: any) {
    console.error('[GET /api/inbox/evolution/connect] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao obter status da conexao' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const limited = rateLimit(request, 'inbox:evolution:disconnect', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    let targetProfile = guard.profile;
    const viewingProfileId = request.headers.get('x-orion-view-profile-id');
    if (guard.profile.tipo_usuario === 'admin' && viewingProfileId) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, status')
        .eq('id', viewingProfileId)
        .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro', 'account_manager'])
        .maybeSingle();
      if (data) targetProfile = { ...data, is_admin_master: false, equipe_orion: null } as typeof targetProfile;
    }

    const instance = evolutionInstanceName(targetProfile.id);
    const instanceApiKey = await getEvolutionInstanceApiKey(instance);

    // 1. Desconecta o WhatsApp da Evolution API
    try {
      await evolutionFetch(`/instance/logout/${instance}`, { method: 'DELETE' }, instanceApiKey);
    } catch (e) {
      console.warn(`[DELETE /api/inbox/evolution/connect] Logout failed or already logged out for ${instance}:`, e);
    }

    // 2. Exclui a instância
    try {
      await evolutionFetch(`/instance/delete/${instance}`, { method: 'DELETE' }, instanceApiKey);
    } catch (e) {
      console.warn(`[DELETE /api/inbox/evolution/connect] Delete failed or already deleted for ${instance}:`, e);
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
      message: 'WhatsApp desconectado com sucesso.'
    });
  } catch (error: any) {
    console.error('[DELETE /api/inbox/evolution/connect] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao desconectar WhatsApp' }, { status: 500 });
  }
}
