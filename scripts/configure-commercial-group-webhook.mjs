import { createHmac } from 'node:crypto';

const base = String(process.env.UAZAPI_URL || '').replace(/\/+$/, '');
const key = process.env.UAZAPI_GLOBAL_TOKEN;
if (!base || !key) throw new Error('Ambiente UAZAPI ausente.');
const endpoint = 'https://track.orionassessoriaa.com.br/api/webhooks/comercial/whatsapp';
const secret = createHmac('sha256', key).update('orion:commercial-group-webhook:v1').digest('hex');
async function request(path, headers, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
const payload = await request('/instance/all', { admintoken: key });
const instances = Array.isArray(payload) ? payload : payload.data || payload.instances || [];
const instance = instances.find(item => item.name === 'apolo_master_sender' && item.status === 'connected');
if (!instance?.token) throw new Error('Apolo nao esta conectado.');
const headers = { token: instance.token };
const hooks = await request('/webhook', headers);
if (!Array.isArray(hooks)) throw new Error('Resposta de webhooks invalida.');
const matches = hooks.filter(hook => String(hook.url || '').split('?')[0] === endpoint);
if (matches.length > 1) throw new Error('Webhooks comerciais duplicados: resolver antes de configurar.');
if (process.argv.includes('--apply')) {
  await request('/webhook', headers, {
    ...(matches[0] ? { action: 'update', id: matches[0].id } : { action: 'add' }),
    enabled: true, url: `${endpoint}?secret=${secret}`, events: ['messages'],
    excludeMessages: ['wasSentByApi', 'fromMeYes', 'isGroupNo'],
    addUrlEvents: false, addUrlTypesMessages: false,
  });
  const updated = await request('/webhook', headers);
  if (!hooks.every(old => updated.some(hook => hook.id === old.id))) throw new Error('Webhook anterior ausente apos configuracao.');
  const selected = updated.find(hook => hook.url === `${endpoint}?secret=${secret}` && hook.enabled);
  if (!selected) throw new Error('Webhook comercial nao ficou ativo.');
  console.log('Webhook do START ativo; demais webhooks preservados.');
} else {
  console.log(`Verificacao concluida: ${hooks.length} webhook(s); START ${matches[0]?.enabled ? 'ativo' : 'a configurar'}.`);
}
