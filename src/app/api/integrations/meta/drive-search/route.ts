import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { extractDriveId, isGoogleDriveConfigured, searchDriveFiles } from '@/lib/integrations/googleDrive';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:drive-search', { limit: 30, windowMs: 5 * 60_000 });
    if (limited) return limited;
    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7));
    if (error || !user) return NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 });
    const { data: profile } = await supabaseAdmin.from('profiles').select('tipo_usuario').eq('id', user.id).maybeSingle();
    if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    if (!isGoogleDriveConfigured()) return NextResponse.json({ configured: false, files: [], error: 'Google Drive ainda nao esta configurado no ambiente.' }, { status: 503 });
    const body = await request.json();
    const files = await searchDriveFiles({ query: String(body.query || ''), folderId: extractDriveId(body.folder || body.folder_id) });
    return NextResponse.json({ configured: true, files });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel pesquisar no Google Drive.' }, { status: 502 });
  }
}

