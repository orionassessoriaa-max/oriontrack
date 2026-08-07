import { NextResponse } from 'next/server';
import { checkLeadAiTimeouts } from '@/lib/leadAiAgent';
import { checkLeadAiInstanceHealth } from '@/lib/leadAiHealthMonitor';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET || process.env.UAZAPI_GLOBAL_TOKEN || process.env.EVOLUTION_API_KEY;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[uazapi_cron_timeout] Checking lead AI timeouts...');
    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
    const result = dryRun ? { count: 0, dryRun: true } : await checkLeadAiTimeouts();
    const health = await checkLeadAiInstanceHealth({ notify: !dryRun, reconnect: !dryRun, mutate: !dryRun });
    console.log('[uazapi_cron_timeout] Finished checking timeouts:', result);

    return NextResponse.json({ ok: true, timeouts: result, health });
  } catch (error: unknown) {
    console.error('[uazapi_cron_timeout] Error in timeout cron route:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
