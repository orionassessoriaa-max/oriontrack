import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { creditSummary } from '@/lib/creatives/orionCred';

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const requestedId = String(url.searchParams.get('gestor_id') || '').trim();
  if (guard.profile.tipo_usuario === 'admin' && !requestedId) {
    const { data, error } = await supabaseAdmin
      .from('orion_cred_accounts')
      .select('gestor_id, limite_creditos, creditos_usados, creditos_reservados, ciclo_inicio, ciclo_fim');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ accounts: (data || []).map((account) => ({ gestor_id: account.gestor_id, ...creditSummary(account) })) });
  }
  const gestorId = guard.profile.tipo_usuario === 'admin' && requestedId ? requestedId : guard.profile.id;

  const { data, error } = await supabaseAdmin
    .from('orion_cred_accounts')
    .select('gestor_id, limite_creditos, creditos_usados, creditos_reservados, ciclo_inicio, ciclo_fim')
    .eq('gestor_id', gestorId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ gestor_id: gestorId, ...creditSummary(data) });
}

export async function PATCH(request: Request) {
  const guard = await requireApiUser(request, ['admin']);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'orion-cred:add', { limit: 30, windowMs: 10 * 60_000, key: guard.profile.id });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const gestorId = String(body.gestor_id || '').trim();
  const quantity = Math.trunc(Number(body.adicionar_creditos));
  if (!gestorId || !Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
    return NextResponse.json({ error: 'Informe o gestor e de 1 a 500 creditos.' }, { status: 400 });
  }
  const { data: gestor } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', gestorId)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();
  if (!gestor) return NextResponse.json({ error: 'Gestor de trafego nao encontrado.' }, { status: 404 });

  const { data, error } = await supabaseAdmin.rpc('orion_cred_adicionar', {
    p_gestor_id: gestorId,
    p_quantidade: quantity,
    p_admin_id: guard.profile.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, gestor_id: gestorId, ...creditSummary(data) });
}
