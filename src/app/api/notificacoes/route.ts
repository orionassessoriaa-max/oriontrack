import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { resolveNotificationTargets, sendApoloWhatsApp } from '@/lib/apoloNotifications';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'notifications:create', { limit: 30, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const titulo = String(body.titulo || '').trim();
    const mensagem = String(body.mensagem || '').trim();
    const destinatarioTipo = String(body.destinatario_tipo || 'todos').trim();

    if (!titulo || !mensagem) {
      return NextResponse.json({ error: 'Informe titulo e mensagem.' }, { status: 400 });
    }

    const { data: notification, error } = await supabaseAdmin
      .from('notificacoes')
      .insert([{
        titulo,
        mensagem,
        destinatario_tipo: destinatarioTipo,
        remetente_profile_id: guard.profile.id,
        lida: false,
      }])
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const targets = await resolveNotificationTargets(destinatarioTipo, null);
    const whatsappResults = await sendApoloWhatsApp({
      type: 'notificacao',
      title: titulo,
      message: mensagem,
      profiles: targets,
    });

    await writeAuditLog(request, guard.profile, {
      action: 'notification.create',
      entity_type: 'notificacoes',
      entity_id: notification.id,
      metadata: { destinatario_tipo: destinatarioTipo, whatsapp_results: whatsappResults },
    });

    return NextResponse.json({ success: true, notification, whatsapp_results: whatsappResults });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao enviar notificacao.' }, { status: 500 });
  }
}
