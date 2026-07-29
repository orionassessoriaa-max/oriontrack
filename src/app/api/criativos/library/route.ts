import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  canUseCreativeFolder,
  getCreativeCorretorScope,
  groupCreativeFolders,
} from '@/lib/creatives/access';

const BUCKET = 'criativos';
const STAFF_ROLES = ['admin', 'gestor_trafego', 'designer', 'account_manager'] as const;

type LibraryAsset = {
  id: string;
  corretor_id: string;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  status: string;
  created_at: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function safeFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'criativo-gerado';
}

async function ensureBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (buckets?.some((bucket) => bucket.name === BUCKET)) return;

  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 30 * 1024 * 1024,
  });
  if (error) throw error;
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...STAFF_ROLES]);
  if ('error' in guard) return guard.error;

  try {
    const url = new URL(request.url);
    const gestorId = url.searchParams.get('gestor_id');
    const corretores = await getCreativeCorretorScope(guard.profile, gestorId);
    const folders = groupCreativeFolders(corretores);
    const corretorIds = corretores.map((corretor) => corretor.id);

    let assets: LibraryAsset[] = [];
    if (corretorIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('criativo_assets')
        .select('id, corretor_id, titulo, descricao, arquivo_url, status, created_at')
        .in('corretor_id', corretorIds)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      assets = data || [];
    }

    return NextResponse.json({
      folders: folders.map((folder) => ({
        ...folder,
        assets: assets.filter((asset) => folder.corretor_ids.includes(asset.corretor_id)),
      })),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error, 'Erro ao carregar as pastas de criativos.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, [...STAFF_ROLES]);
  if ('error' in guard) return guard.error;

  const limited = rateLimit(request, 'criativos:library:save', {
    limit: 20,
    windowMs: 10 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const corretorId = String(body.corretor_id || '').trim();
    const gestorId = String(body.gestor_id || '').trim() || null;
    const titulo = String(body.titulo || '').trim().slice(0, 160);
    const prompt = String(body.prompt || '').trim().slice(0, 4000);
    const imageDataUrl = String(body.image_data_url || '');

    if (!corretorId || !titulo || !imageDataUrl) {
      return NextResponse.json({ error: 'Informe a pasta, o nome e a imagem gerada.' }, { status: 400 });
    }
    if (!(await canUseCreativeFolder(guard.profile, corretorId, gestorId))) {
      return NextResponse.json({ error: 'Esta pasta nao pertence ao escopo deste gestor.' }, { status: 403 });
    }

    const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
    if (!match) {
      return NextResponse.json({ error: 'Formato da imagem gerada invalido.' }, { status: 400 });
    }

    const contentType = match[1];
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'A imagem deve ter no maximo 20 MB.' }, { status: 400 });
    }

    await ensureBucket();
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
    const path = `${corretorId}/gerados-por-ia/${Date.now()}-${safeFileName(titulo)}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { data: asset, error: insertError } = await supabaseAdmin
      .from('criativo_assets')
      .insert([{
        corretor_id: corretorId,
        titulo,
        descricao: prompt ? `Gerado por IA. Prompt: ${prompt}` : 'Gerado por IA no Orion Track.',
        arquivo_url: publicUrl,
        arquivo_path: path,
        status: 'em_aprovacao',
        enviado_por_profile_id: guard.profile.id,
      }])
      .select('id, corretor_id, titulo, descricao, arquivo_url, status, created_at')
      .single();
    if (insertError) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw insertError;
    }

    await writeAuditLog(request, guard.profile, {
      action: 'creative.ai.save',
      entity_type: 'criativo_asset',
      entity_id: asset.id,
      metadata: { corretor_id: corretorId, model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2' },
    });

    return NextResponse.json({ ok: true, asset });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error, 'Erro ao salvar o criativo na pasta.') }, { status: 500 });
  }
}
