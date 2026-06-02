import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'lead-arquivos';

function safeFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'arquivo';
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
    public: false,
    fileSizeLimit: 15 * 1024 * 1024,
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if ('error' in guard) return guard.error;

  const { id: leadId } = await context.params;

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, responsavel_profile_id')
    .eq('id', leadId)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });
  }

  if ((guard.profile.tipo_usuario === 'corretor' || guard.profile.tipo_usuario === 'corretor_admin') && lead.corretor_id !== guard.profile.corretor_id) {
    return NextResponse.json({ error: 'Acesso negado para este lead.' }, { status: 403 });
  }

  if (guard.profile.tipo_usuario === 'corretor_membro' && lead.responsavel_profile_id !== guard.profile.id) {
    return NextResponse.json({ error: 'Acesso negado para este lead.' }, { status: 403 });
  }

  if (!['admin', 'corretor', 'corretor_admin', 'corretor_membro'].includes(guard.profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Envie um arquivo valido.' }, { status: 400 });
  }

  await ensureBucket();

  const arrayBuffer = await file.arrayBuffer();
  const path = `${leadId}/${Date.now()}-${safeFileName(file.name)}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(arrayBuffer), {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365);

  await supabaseAdmin.from('lead_atividades').insert([{
    lead_id: leadId,
    profile_id: guard.profile.id,
    tipo: 'sistema',
    titulo: `Arquivo anexado: ${file.name}`,
    descricao: signed?.signedUrl || path,
  }]);

  return NextResponse.json({ ok: true, path, url: signed?.signedUrl || null });
}
