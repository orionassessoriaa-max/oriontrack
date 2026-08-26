import { NextResponse } from 'next/server';
import { syncVoipRecordings } from '@/lib/voipRecordingSync';

export const runtime = 'nodejs';

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET nao configurado.' }, { status: 500 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }
  const days = Math.min(7, Math.max(1, Number(new URL(request.url).searchParams.get('dias') || 2) || 2));
  try {
    return NextResponse.json({ ok: true, ...(await syncVoipRecordings(days)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao sincronizar gravacoes da VoIP.';
    console.error('[voip_recordings_sync]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
