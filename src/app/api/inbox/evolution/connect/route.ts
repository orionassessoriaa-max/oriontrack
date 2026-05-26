import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { configureEvolutionWebhook, evolutionFetch, evolutionInstanceName } from '@/lib/evolution';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'inbox:evolution:connect', { limit: 12, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_membro', 'account_manager']);
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
        .in('tipo_usuario', ['corretor', 'corretor_membro', 'account_manager'])
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
    const rawMessage = String(error.message || '');
    const message = rawMessage.toLowerCase().includes('forbidden') || rawMessage.includes('403')
      ? 'A conexao com o WhatsApp foi recusada. Confirme a chave da Evolution API no servidor e tente novamente.'
      : rawMessage || 'Nao consegui gerar o QR Code agora. A equipe Orion pode revisar a conexao do WhatsApp.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
