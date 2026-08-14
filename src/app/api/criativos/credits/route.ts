import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { creditSummary, globalCreditSummary } from '@/lib/creatives/orionCred';

const ACCOUNT_COLUMNS = 'gestor_id, limite_creditos, creditos_usados, creditos_reservados, ciclo_inicio, ciclo_fim';
const GLOBAL_COLUMNS = 'orcamento_criativos_usd, limite_diario_usd, custo_estimado_imagem_usd, gasto_usd, reservado_usd, ciclo_inicio, ciclo_fim';

async function globalSummary() {
  const { data, error } = await supabaseAdmin
    .from('orion_cred_global_config')
    .select(GLOBAL_COLUMNS)
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return globalCreditSummary(data);
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const requestedId = String(url.searchParams.get('gestor_id') || '').trim();
  const includeLedger = url.searchParams.get('include_ledger') === '1';

  try {
    const global = await globalSummary();
    if (guard.profile.tipo_usuario === 'admin' && !requestedId) {
      const { data, error } = await supabaseAdmin.from('orion_cred_accounts').select(ACCOUNT_COLUMNS);
      if (error) throw error;
      return NextResponse.json({
        global,
        accounts: (data || []).map((account) => ({ gestor_id: account.gestor_id, ...creditSummary(account) })),
      });
    }

    const gestorId = guard.profile.tipo_usuario === 'admin' && requestedId ? requestedId : guard.profile.id;
    const [{ data: account, error: accountError }, ledgerResult] = await Promise.all([
      supabaseAdmin.from('orion_cred_accounts').select(ACCOUNT_COLUMNS).eq('gestor_id', gestorId).maybeSingle(),
      includeLedger
        ? supabaseAdmin
          .from('orion_cred_ledger')
          .select('id, tipo, quantidade, referencia, corretor_id, concessionaria, operadora, regiao, prompt, resultado, asset_id, custo_estimado_usd, criado_em:created_at')
          .eq('gestor_id', gestorId)
          .order('created_at', { ascending: false })
          .limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (accountError) throw accountError;
    if (ledgerResult.error) throw ledgerResult.error;
    return NextResponse.json({ gestor_id: gestorId, ...creditSummary(account), global, ledger: ledgerResult.data || [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao consultar o Orion Cred.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = await requireApiUser(request, ['admin']);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'orion-cred:adjust', { limit: 30, windowMs: 10 * 60_000, key: guard.profile.id });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const operation = String(body.operation || 'add').trim();
  const gestorId = String(body.gestor_id || '').trim();
  const targetGestorId = String(body.target_gestor_id || '').trim();
  const quantity = Math.trunc(Number(body.quantidade ?? body.adicionar_creditos));
  if (!gestorId || !Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
    return NextResponse.json({ error: 'Informe o gestor e uma quantidade de 1 a 500 creditos.' }, { status: 400 });
  }

  const ids = operation === 'transfer' ? [gestorId, targetGestorId] : [gestorId];
  if (ids.some((id) => !id)) return NextResponse.json({ error: 'Informe o gestor de destino da transferencia.' }, { status: 400 });
  const { data: gestores, error: gestoresError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .in('id', ids)
    .eq('tipo_usuario', 'gestor_trafego');
  if (gestoresError) return NextResponse.json({ error: gestoresError.message }, { status: 500 });
  if ((gestores || []).length !== new Set(ids).size) {
    return NextResponse.json({ error: 'Gestor de trafego nao encontrado.' }, { status: 404 });
  }

  const rpc = operation === 'transfer' ? 'orion_cred_transferir' : 'orion_cred_ajustar';
  const args = operation === 'transfer'
    ? { p_origem_id: gestorId, p_destino_id: targetGestorId, p_quantidade: quantity, p_admin_id: guard.profile.id }
    : { p_gestor_id: gestorId, p_quantidade: operation === 'remove' ? -quantity : quantity, p_admin_id: guard.profile.id };
  const { data, error } = await supabaseAdmin.rpc(rpc, args);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, operation, data, global: await globalSummary() });
}
