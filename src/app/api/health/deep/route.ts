import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CheckResult = {
  ok: boolean;
  latency_ms: number;
  error?: string;
};

const CHECK_TIMEOUT_MS = 6_000;

function withTimeout<T>(promise: PromiseLike<T>, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} excedeu ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Falha desconhecida');
  return message.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 240);
}

async function runCheck(name: string, operation: () => PromiseLike<unknown>): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    await withTimeout(operation(), name);
    return { ok: true, latency_ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latency_ms: Math.round(performance.now() - startedAt),
      error: safeError(error),
    };
  }
}

export async function GET(request: Request) {
  const limited = rateLimit(request, 'health:deep', { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const startedAt = performance.now();

  const [database, auth] = await Promise.all([
    runCheck('database', async () => {
      const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
      if (error) throw error;
    }),
    runCheck('auth', async () => {
      const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) throw error;
    }),
  ]);

  const ok = database.ok && auth.ok;
  const memory = process.memoryUsage();
  const body = {
    ok,
    status: ok ? 'operational' : 'degraded',
    timestamp: new Date().toISOString(),
    total_latency_ms: Math.round(performance.now() - startedAt),
    checks: {
      application: { ok: true },
      database,
      auth,
    },
    process: {
      uptime_seconds: Math.round(process.uptime()),
      heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
      rss_mb: Math.round(memory.rss / 1024 / 1024),
    },
  };

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
