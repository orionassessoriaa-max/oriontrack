import { NextResponse } from 'next/server';
import { syncCommercialMeetingArtifacts } from '@/lib/commercialMeetingArtifacts';

export const runtime = 'nodejs';

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET nao configurado.' }, { status: 500 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }
  const requestedLimit = Number(new URL(request.url).searchParams.get('limit') || 20);
  try {
    return NextResponse.json({ ok: true, ...(await syncCommercialMeetingArtifacts(requestedLimit)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao sincronizar dados do Google Meet.';
    console.error('commercial_meeting_artifacts_cron_failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

