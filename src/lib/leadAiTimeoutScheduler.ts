import { checkLeadAiTimeouts } from '@/lib/leadAiAgent';
import { checkLeadAiInstanceHealth } from '@/lib/leadAiHealthMonitor';

const DEFAULT_INTERVAL_MS = 60 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __orionLeadAiTimeoutTimer?: ReturnType<typeof setInterval>;
  __orionLeadAiTimeoutRunning?: boolean;
};

function getIntervalMs() {
  const raw = Number(process.env.LEAD_AI_TIMEOUT_INTERVAL_MS || '');
  if (Number.isFinite(raw) && raw >= 10_000) return raw;
  return DEFAULT_INTERVAL_MS;
}

async function runTimeoutCheck() {
  const globalState = globalThis as SchedulerGlobal;
  if (globalState.__orionLeadAiTimeoutRunning) return;

  globalState.__orionLeadAiTimeoutRunning = true;
  try {
    const result = await checkLeadAiTimeouts();
    if (result.count > 0) {
      console.log('[lead_ai_timeout_scheduler] Handed off timed out leads:', result.count);
    }
    if ('error' in result && result.error) {
      console.error('[lead_ai_timeout_scheduler] Timeout check returned error:', result.error);
    }
    const health = await checkLeadAiInstanceHealth();
    if (health.disconnected > 0 || health.recovered > 0) {
      console.log('[lead_ai_timeout_scheduler] AI instance health:', health);
    }
  } catch (error) {
    console.error('[lead_ai_timeout_scheduler] Timeout check failed:', error);
  } finally {
    globalState.__orionLeadAiTimeoutRunning = false;
  }
}

export function ensureLeadAiTimeoutScheduler() {
  const globalState = globalThis as SchedulerGlobal;
  if (globalState.__orionLeadAiTimeoutTimer) return;

  void runTimeoutCheck();

  const timer = setInterval(() => {
    void runTimeoutCheck();
  }, getIntervalMs());

  timer.unref?.();
  globalState.__orionLeadAiTimeoutTimer = timer;
}
