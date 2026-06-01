import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { evolutionFetch, getEvolutionInstanceApiKey, normalizePhone } from '@/lib/evolution';

const MASTER_INSTANCE = 'apolo_master_sender';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:config:evolution:test', { limit: 10, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const phoneParam = String(body.telefone || '').trim();
    const text = String(body.mensagem || '').trim();

    if (!phoneParam || !text) {
      return NextResponse.json({ error: 'Informe o telefone e a mensagem de teste.' }, { status: 400 });
    }

    const phone = normalizePhone(phoneParam);
    if (!phone) {
      return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 });
    }

    const instanceApiKey = await getEvolutionInstanceApiKey(MASTER_INSTANCE);

    const payload = await evolutionFetch(`/message/sendText/${MASTER_INSTANCE}`, {
      method: 'POST',
      body: JSON.stringify({
        number: phone,
        text: text,
      }),
    }, instanceApiKey);

    await writeAuditLog(request, guard.profile, {
      action: 'admin.whatsapp.master.test',
      entity_type: 'whatsapp_instance',
      entity_id: MASTER_INSTANCE,
      metadata: { recipient: phone },
    });

    return NextResponse.json({
      success: true,
      message: 'Mensagem de teste enviada com sucesso!',
      payload,
    });
  } catch (error: any) {
    console.error('[POST /api/admin/configuracoes/evolution/test] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao enviar mensagem de teste pela Chave Mestra' }, { status: 500 });
  }
}
