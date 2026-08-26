import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { baixarGravacaoVoip } from '@/lib/voip';
import { validRecordingSignature } from '@/lib/voipRecordingAccess';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const recordId = Number(url.searchParams.get('record_id'));
  const expires = Number(url.searchParams.get('expires'));
  const signature = String(url.searchParams.get('signature') || '');
  if (!validRecordingSignature(recordId, expires, signature)) {
    return NextResponse.json({ error: 'Link de gravacao invalido ou expirado.' }, { status: 401 });
  }
  const { data: call } = await supabaseAdmin
    .from('comercial_ligacoes')
    .select('voip_record_id,status')
    .eq('voip_record_id', recordId)
    .maybeSingle();
  if (!call || !['atendida', 'concluida'].includes(call.status)) {
    return NextResponse.json({ error: 'Gravacao nao encontrada.' }, { status: 404 });
  }
  try {
    const audio = await baixarGravacaoVoip(recordId);
    return new Response(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `inline; filename="ligacao-${recordId}.mp3"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Nao foi possivel baixar a gravacao.' },
      { status: 502 },
    );
  }
}
