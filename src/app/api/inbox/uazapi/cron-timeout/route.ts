import { NextResponse } from 'next/server';
import { checkLeadAiTimeouts } from '@/lib/leadAiAgent';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET || process.env.UAZAPI_GLOBAL_TOKEN || process.env.EVOLUTION_API_KEY;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[uazapi_cron_timeout] Checking lead AI timeouts...');
    const result = await checkLeadAiTimeouts();
    console.log('[uazapi_cron_timeout] Finished checking timeouts:', result);

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('[uazapi_cron_timeout] Error in timeout cron route:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
