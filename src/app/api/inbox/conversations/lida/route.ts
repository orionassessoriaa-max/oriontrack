import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { UserRole } from '@/types';

const INBOX_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'gestor_trafego', 'account_manager'];

/**
 * Marca uma conversa como lida ate agora, para quem chamou.
 *
 * O contador de nao lidas do Inbox e derivado disto: mensagens recebidas com
 * created_at maior que o lido_ate desta pessoa. Nao existe "marcar como nao
 * lida" aqui de proposito — quem reabre a conversa zera, e mensagem nova volta
 * a contar sozinha.
 */
export async function POST(request: Request) {
  const guard = await requireApiUser(request, INBOX_ROLES as unknown as UserRole[]);
  if ('error' in guard) return guard.error;

  const body = await request.json().catch(() => ({}));
  const conversaId = String(body?.conversa_id || '').trim();
  if (!conversaId) {
    return NextResponse.json({ error: 'Informe a conversa.' }, { status: 400 });
  }

  const agora = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('inbox_conversa_leituras')
    .upsert(
      [{
        conversa_id: conversaId,
        profile_id: guard.profile.id,
        lido_ate: agora,
        updated_at: agora,
      }],
      { onConflict: 'conversa_id,profile_id' },
    );

  if (error) {
    // A migration ainda pode estar pendente em producao. Audit logs ja e uma
    // estrutura persistente, protegida e acessada pelo service role; manter um
    // unico marcador por pessoa/conversa entrega o mesmo comportamento sem
    // fazer o usuario depender do SQL Editor.
    console.warn('[Inbox lida] Tabela dedicada indisponivel, usando auditoria:', error.message);
    const { data: marcador, error: buscaError } = await supabaseAdmin
      .from('audit_logs')
      .select('id')
      .eq('actor_profile_id', guard.profile.id)
      .eq('action', 'inbox.conversation.read')
      .eq('entity_type', 'whatsapp_conversa')
      .eq('entity_id', conversaId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (buscaError) {
      console.error('[Inbox lida] Falha ao localizar marcador alternativo:', buscaError.message);
      return NextResponse.json({ success: false, reason: 'leitura_indisponivel' });
    }

    const markerPayload = {
      actor_profile_id: guard.profile.id,
      actor_email: guard.profile.email_real || guard.profile.email || null,
      actor_role: guard.profile.tipo_usuario,
      action: 'inbox.conversation.read',
      entity_type: 'whatsapp_conversa',
      entity_id: conversaId,
      metadata: { lido_ate: agora, storage: 'audit_fallback' },
      user_agent: request.headers.get('user-agent'),
      created_at: agora,
    };

    const fallback = marcador?.id
      ? await supabaseAdmin.from('audit_logs').update(markerPayload).eq('id', marcador.id)
      : await supabaseAdmin.from('audit_logs').insert(markerPayload);

    if (fallback.error) {
      console.error('[Inbox lida] Falha ao salvar marcador alternativo:', fallback.error.message);
      return NextResponse.json({ success: false, reason: 'leitura_indisponivel' });
    }

    return NextResponse.json({ success: true, storage: 'audit_fallback' });
  }

  return NextResponse.json({ success: true });
}
