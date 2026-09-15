import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const guard = await requireApiUser(request);
  if ('error' in guard) return guard.error;

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', guard.profile.id);

  // O deploy pode chegar antes da migration. Nesse intervalo, nao bloqueamos o CRM.
  if (error?.code === '42703' || /last_active_at/i.test(String(error?.message || ''))) {
    return NextResponse.json({ ok: true, configured: false });
  }

  if (error) {
    return NextResponse.json({ error: 'Nao foi possivel atualizar a presenca.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, configured: true });
}
