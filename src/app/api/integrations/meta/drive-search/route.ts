import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser } from '@/lib/api/security';
import { extractDriveId, getDriveFile, isGoogleDriveConfigured, listDriveChildren, searchDriveFiles } from '@/lib/integrations/googleDrive';
import { isDriveItemInsideFolder, resolveManagerDriveScope } from '@/lib/creatives/driveManagerScope';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:drive-search', { limit: 30, windowMs: 5 * 60_000 });
    if (limited) return limited;
    const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
    if ('error' in guard) return guard.error;
    if (!isGoogleDriveConfigured()) return NextResponse.json({ configured: false, files: [], error: 'Google Drive ainda nao esta configurado no ambiente.' }, { status: 503 });
    const body = await request.json();
    const requestedManagerId = request.headers.get('x-orion-view-profile-id') || String(body.gestor_id || '') || null;
    const { manager, managerFolder } = await resolveManagerDriveScope(guard.profile, requestedManagerId);
    if (body.action === 'browse') {
      const requestedFolderId = extractDriveId(body.folder_id);
      const folderId = requestedFolderId || managerFolder.id;
      if (!(await isDriveItemInsideFolder(folderId, managerFolder.id))) {
        return NextResponse.json({ error: 'Esta pasta nao pertence ao gestor selecionado.' }, { status: 403 });
      }
      const [currentFolder, children] = await Promise.all([getDriveFile(folderId), listDriveChildren(folderId)]);
      return NextResponse.json({
        configured: true,
        rootFolderId: managerFolder.id,
        manager: { id: manager.id, nome: manager.nome },
        currentFolder,
        ...children,
      });
    }
    const requestedFolderId = extractDriveId(body.folder || body.folder_id) || managerFolder.id;
    if (!(await isDriveItemInsideFolder(requestedFolderId, managerFolder.id))) {
      return NextResponse.json({ error: 'Esta pasta nao pertence ao gestor selecionado.' }, { status: 403 });
    }
    const files = await searchDriveFiles({ query: String(body.query || ''), folderId: requestedFolderId });
    return NextResponse.json({ configured: true, files });
  } catch (error: any) {
    const message = String(error?.message || 'Nao foi possivel pesquisar no Google Drive.');
    const friendlyMessage = /File not found/i.test(message)
      ? 'A pasta Criativos Orion nao foi encontrada para a conta conectada. Verifique se ela foi restaurada da Lixeira e compartilhada com orionassessoriaa@gmail.com.'
      : message;
    return NextResponse.json({ error: friendlyMessage }, { status: 502 });
  }
}
