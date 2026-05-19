import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'criativos';

function safeFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'criativo';
}

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
    .select('id, tipo_usuario, corretor_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return { error: NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 403 }) };
  }

  return { user, profile };
}

async function ensureBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (buckets?.some((bucket) => bucket.name === BUCKET)) return;

  await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 30 * 1024 * 1024,
  });
}

export async function POST(request: Request) {
  const guard = await requireUser(request);
  if ('error' in guard) return guard.error;

  if (!['admin', 'designer', 'account_manager'].includes(guard.profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Apenas admin, designer ou account manager podem subir criativos.' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const corretorId = String(formData.get('corretor_id') || '');
  const demandaId = String(formData.get('demanda_id') || '');
  const titulo = String(formData.get('titulo') || '').trim();
  const descricao = String(formData.get('descricao') || '').trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Envie um arquivo valido.' }, { status: 400 });
  }

  if (!corretorId || !titulo) {
    return NextResponse.json({ error: 'Informe corretor e titulo.' }, { status: 400 });
  }

  const { data: corretor } = await supabaseAdmin
    .from('corretores')
    .select('id')
    .eq('id', corretorId)
    .maybeSingle();

  if (!corretor) {
    return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
  }

  await ensureBucket();

  const arrayBuffer = await file.arrayBuffer();
  const path = `${corretorId}/${Date.now()}-${safeFileName(file.name)}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(arrayBuffer), {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrl } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

  const { data: asset, error: insertError } = await supabaseAdmin
    .from('criativo_assets')
    .insert([{
      demanda_id: demandaId || null,
      corretor_id: corretorId,
      titulo,
      descricao: descricao || null,
      arquivo_url: publicUrl.publicUrl,
      arquivo_path: path,
      status: 'em_aprovacao',
      enviado_por_profile_id: guard.profile.id,
    }])
    .select('*')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (demandaId) {
    await supabaseAdmin
      .from('criativo_demandas')
      .update({ status: 'entregue', updated_at: new Date().toISOString() })
      .eq('id', demandaId);
  }

  return NextResponse.json({ ok: true, asset });
}
