import appWorker from './.open-next/worker.js';

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

export default {
  fetch(request, env, ctx) {
    return appWorker.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    const secret = env.CRON_SECRET || env.UAZAPI_GLOBAL_TOKEN || env.EVOLUTION_API_KEY || '';
    const request = new Request('https://oriontrack.local/api/inbox/uazapi/cron-timeout', {
      method: 'POST',
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });

    ctx.waitUntil(appWorker.fetch(request, env, ctx));
  },
};
