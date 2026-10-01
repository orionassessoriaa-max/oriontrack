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

  const { error } = await supabaseAdmin
    .from('inbox_conversa_leituras')
    .upsert(
      [{
        conversa_id: conversaId,
        profile_id: guard.profile.id,
        lido_ate: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
      { onConflict: 'conversa_id,profile_id' },
    );

  if (error) {
    // Migracao pendente nao pode impedir o atendente de abrir a conversa.
    console.error('[Inbox lida] Falha ao marcar leitura:', error.message);
    return NextResponse.json({ success: false, reason: 'leitura_indisponivel' });
  }

  return NextResponse.json({ success: true });
}
