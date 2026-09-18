import fs from 'node:fs';
import path from 'node:path';

const root = 'C:\\Users\\PC-000\\Documents\\oriontrack';
const logPath = path.join(root, 'reports', 'send-leo-reports-apolo.log');
const instanceName = 'apolo_master_sender';
const phone = '556181625459';
const message = 'Bom dia chefe Apolo aqui, segue os relatorios do Léo';
const pdfs = [
  path.join(root, 'reports', 'historico-leonardo-cruz-whatsapp.pdf'),
  path.join(root, 'reports', 'analise-atendimento-leonardo-cruz.pdf'),
];

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(logPath, `${text}\n`, 'utf8');
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function cleanBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.instances)) return payload.instances;
  if (Array.isArray(payload?.response)) return payload.response;
  return [];
}

function readInstanceName(instance) {
  return String(
    instance?.name ||
    instance?.instanceName ||
    instance?.instance ||
    instance?.session ||
    instance?.sessionkey ||
    ''
  );
}

function readInstanceToken(instance) {
  return String(
    instance?.token ||
    instance?.instanceToken ||
    instance?.apikey ||
    instance?.apiKey ||
    instance?.key ||
    instance?.credential?.token ||
    ''
  ).trim();
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText || 'Falha na UAZAPI';
    throw new Error(`${response.status} ${message}`);
  }
  return payload;
}

async function getInstanceToken(baseUrl, globalToken) {
  const payload = await requestJson(`${baseUrl}/instance/all`, {
    method: 'GET',
    headers: { admintoken: globalToken },
  });
  const instance = asArray(payload).find((item) => readInstanceName(item) === instanceName);
  const token = readInstanceToken(instance);
  if (!token) throw new Error(`Instancia ${instanceName} nao encontrada ou sem token.`);
  return token;
}

async function sendText(baseUrl, token) {
  return requestJson(`${baseUrl}/send/text`, {
    method: 'POST',
    headers: { token, sessionkey: instanceName, session: instanceName },
    body: JSON.stringify({ number: phone, text: message }),
  });
}

async function sendPdf(baseUrl, token, filePath) {
  const base64 = fs.readFileSync(filePath).toString('base64');
  const dataUrl = `data:application/pdf;base64,${base64}`;
  return requestJson(`${baseUrl}/send/media`, {
    method: 'POST',
    headers: { token, sessionkey: instanceName, session: instanceName },
    body: JSON.stringify({
      number: phone,
      path: dataUrl,
      file: dataUrl,
      type: 'document',
      caption: '',
    }),
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  loadEnvFile(path.join(root, '.env.local'));
  loadEnvFile(path.join(root, '.env.production'));

  for (const filePath of pdfs) {
    if (!fs.existsSync(filePath)) throw new Error(`PDF nao encontrado: ${filePath}`);
  }

  const baseUrl = cleanBaseUrl(process.env.UAZAPI_URL);
  const globalToken = process.env.UAZAPI_GLOBAL_TOKEN;
  if (!baseUrl || !globalToken) throw new Error('UAZAPI_URL ou UAZAPI_GLOBAL_TOKEN ausente no ambiente.');

  log(`Preparando envio para ${phone} pela instancia ${instanceName}.`);
  const token = await getInstanceToken(baseUrl, globalToken);
  log('Instancia Apolo localizada.');

  if (process.argv.includes('--dry-run')) {
    log('Dry-run concluido. Nada foi enviado.');
    return;
  }

  await sendText(baseUrl, token);
  log('Texto enviado.');
  await wait(1000);

  for (const filePath of pdfs) {
    await sendPdf(baseUrl, token, filePath);
    log(`PDF enviado: ${path.basename(filePath)}`);
    await wait(1000);
  }

  log('Envio finalizado com sucesso.');
}

main().catch((error) => {
  log(`ERRO: ${error?.message || error}`);
  process.exit(1);
});
