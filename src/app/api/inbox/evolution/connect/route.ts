import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureEvolutionWebhook, evolutionFetch, evolutionInstanceName } from '@/lib/evolution';

export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_membro', 'account_manager']);
    if ('error' in guard) return guard.error;

    let targetProfile = guard.profile;
    const viewingProfileId = request.headers.get('x-orion-view-profile-id');
    if (guard.profile.tipo_usuario === 'admin' && viewingProfileId) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, status')
        .eq('id', viewingProfileId)
        .in('tipo_usuario', ['corretor', 'corretor_membro', 'account_manager'])
        .maybeSingle();
      if (data) targetProfile = { ...data, is_admin_master: false, equipe_orion: null } as typeof targetProfile;
    }

    const instance = evolutionInstanceName(targetProfile.id);

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

    await configureEvolutionWebhook(instance);

    const payload = await evolutionFetch(`/instance/connect/${instance}`, { method: 'GET' });
    const qrcode = payload?.base64 || payload?.qrcode?.base64 || payload?.qrcode || payload?.code || null;

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
    const message = error.message || 'Nao consegui gerar o QR Code agora. A equipe Orion pode revisar a conexao do WhatsApp.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
