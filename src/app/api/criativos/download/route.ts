import { requireApiUser, rateLimit } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseCreativeFolder } from '@/lib/creatives/access';
import { downloadDriveFile, extractDriveId, getDriveFile } from '@/lib/integrations/googleDrive';

const STAFF_ROLES = ['admin', 'gestor_trafego', 'designer', 'account_manager'] as const;

function safeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'criativo';
}

function extensionFor(contentType: string) {
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('mp4')) return 'mp4';
  return 'png';
}

function downloadResponse(bytes: ArrayBuffer | Uint8Array, contentType: string, title: string) {
  const base = safeFileName(title.replace(/\.[^.]+$/, ''));
  const filename = `${base}.${extensionFor(contentType)}`;
  const body = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...STAFF_ROLES]);
  if ('error' in guard) return guard.error;

  const limited = rateLimit(request, 'criativos:download', {
    limit: 60,
    windowMs: 10 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  try {
    const url = new URL(request.url);
    const assetId = String(url.searchParams.get('asset_id') || '').trim();
    const corretorId = String(url.searchParams.get('corretor_id') || '').trim();
    const gestorId = String(url.searchParams.get('gestor_id') || '').trim() || null;
    if (!assetId || !corretorId) return Response.json({ error: 'Criativo invalido.' }, { status: 400 });
    if (!(await canUseCreativeFolder(guard.profile, corretorId, gestorId))) {
      return Response.json({ error: 'Este criativo esta fora do seu escopo.' }, { status: 403 });
    }

    if (assetId.startsWith('drive:')) {
      const driveFileId = extractDriveId(assetId.slice('drive:'.length));
      if (!driveFileId) return Response.json({ error: 'Arquivo do Drive invalido.' }, { status: 400 });
      const [file, bytes] = await Promise.all([getDriveFile(driveFileId), downloadDriveFile(driveFileId)]);
      return downloadResponse(bytes, file.mimeType || 'image/png', file.name || 'criativo');
    }

    const { data: asset, error } = await supabaseAdmin
      .from('criativo_assets')
      .select('id, corretor_id, titulo, arquivo_url, drive_file_id')
      .eq('id', assetId)
      .eq('corretor_id', corretorId)
      .maybeSingle();
    if (error) throw error;
    if (!asset) return Response.json({ error: 'Criativo nao encontrado.' }, { status: 404 });

    const driveFileId = extractDriveId(asset.drive_file_id);
    if (driveFileId) {
      const [file, bytes] = await Promise.all([getDriveFile(driveFileId), downloadDriveFile(driveFileId)]);
      return downloadResponse(bytes, file.mimeType || 'image/png', asset.titulo || file.name || 'criativo');
    }

    const source = String(asset.arquivo_url || '').trim();
    if (!source) return Response.json({ error: 'Arquivo do criativo indisponivel.' }, { status: 404 });
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) return Response.json({ error: 'Nao foi possivel baixar o arquivo.' }, { status: 502 });
    return downloadResponse(await response.arrayBuffer(), response.headers.get('content-type') || 'image/png', asset.titulo);
  } catch (error: unknown) {
    return Response.json({
      error: error instanceof Error ? error.message : 'Erro ao baixar o criativo.',
    }, { status: 500 });
  }
}
