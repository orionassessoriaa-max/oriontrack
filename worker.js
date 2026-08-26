import appWorker from './.open-next/worker.js';

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

export default {
  fetch(request, env, ctx) {
    return appWorker.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    const secret = env.CRON_SECRET || '';
    const headers = secret ? { authorization: `Bearer ${secret}` } : {};
    const timeoutRequest = new Request('https://oriontrack.local/api/inbox/uazapi/cron-timeout', {
      method: 'POST',
      headers,
    });
    const voipRequest = new Request('https://oriontrack.local/api/integrations/voip/recordings/cron', {
      method: 'POST',
      headers,
    });

    ctx.waitUntil(Promise.all([
      appWorker.fetch(timeoutRequest, env, ctx),
      appWorker.fetch(voipRequest, env, ctx),
    ]));
  },
};
