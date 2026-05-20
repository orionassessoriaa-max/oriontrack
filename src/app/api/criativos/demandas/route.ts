import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'criativos';

async function requireUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, tipo_usuario')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return { error: NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 403 }) };
  }

  return { profile };
}

export async function DELETE(request: Request) {
  const guard = await requireUser(request);
  if ('error' in guard) return guard.error;

  if (!['admin', 'designer', 'account_manager'].includes(guard.profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Apenas admin, designer ou account manager podem remover demandas.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Informe a demanda.' }, { status: 400 });
  }

  const { data: demand } = await supabaseAdmin
    .from('criativo_demandas')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (!demand) {
    return NextResponse.json({ error: 'Demanda nao encontrada.' }, { status: 404 });
  }

  if (!['entregue', 'feito', 'aprovado', 'revisao'].includes(demand.status)) {
    return NextResponse.json({ error: 'So e possivel remover demandas ja entregues ao corretor.' }, { status: 400 });
  }

  const { data: assets } = await supabaseAdmin
    .from('criativo_assets')
    .select('id, arquivo_path')
    .eq('demanda_id', id);

  const paths = (assets || [])
    .map((asset) => asset.arquivo_path)
    .filter((path): path is string => Boolean(path));

  if (paths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(paths);
  }

  const assetIds = (assets || []).map((asset) => asset.id);
  if (assetIds.length > 0) {
    await supabaseAdmin.from('criativo_assets').delete().in('id', assetIds);
  }

  const { error } = await supabaseAdmin
    .from('criativo_demandas')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
