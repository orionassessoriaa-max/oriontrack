import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'trafego-draft-creatives';

function safeFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'criativo';
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
  if (authError || !user) return NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('tipo_usuario')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Envie um criativo valido.' }, { status: 400 });
  if (!/^image\/(jpeg|png|webp|gif)|^video\/(mp4|quicktime|webm)$/.test(file.type)) {
    return NextResponse.json({ error: 'Use uma imagem ou video compativel.' }, { status: 400 });
  }
  if (file.size > 30 * 1024 * 1024) return NextResponse.json({ error: 'O arquivo deve ter no maximo 30 MB.' }, { status: 400 });

  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (!buckets?.some((bucket) => bucket.name === BUCKET)) {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 30 * 1024 * 1024 });
  }

  const path = `${user.id}/${Date.now()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    file: { name: file.name, type: file.type, size: file.size, url: data.publicUrl },
  });
}
