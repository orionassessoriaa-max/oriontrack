/**
 * Congela os dados da Unity no Agendor sem escrever nada no Orion.
 *
 * O snapshot e retomavel: paginas, conversas, mensagens e anexos ja salvos
 * nao sao baixados novamente. Contatos que tenham a etiqueta
 * "Beneficiario Ativo" continuam no bruto para auditoria, mas ficam marcados
 * como excluidos no escopo da futura migracao.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const OUTPUT_DIR = path.resolve(process.argv[2] || `agendor-unity-snapshot-${new Date().toISOString().slice(0, 10)}`);
const CRM_PAGE_SIZE = 100;
const CHAT_PAGE_SIZE = 25;
const CONVERSATION_CONCURRENCY = Math.max(1, Number(process.env.AGENDOR_EXPORT_CONCURRENCY || 3));
const BENEFICIARY_LABEL = 'beneficiario ativo';

function loadCredentials() {
  if (process.env.AGENDOR_UNITY_API_TOKEN && process.env.AGENDOR_UNITY_CHAT_API_TOKEN) {
    return {
      crm: process.env.AGENDOR_UNITY_API_TOKEN,
      chat: process.env.AGENDOR_UNITY_CHAT_API_TOKEN,
    };
  }
  const input = fs.readFileSync(0, 'utf8').trim();
  const parsed = JSON.parse(input || '{}');
  if (!parsed.crm || !parsed.chat) throw new Error('Credenciais do Agendor ausentes.');
  return parsed;
}

const credentials = loadCredentials();
const crmHeaders = { Authorization: `Token ${credentials.crm}`, Accept: 'application/json' };
const chatHeaders = { api_access_token: credentials.chat, Accept: 'application/json' };

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length < 10) return local;
  const ddd = local.slice(0, 2);
  const subscriber = local.slice(2);
  const withoutNinthDigit = subscriber.length === 9 && subscriber.startsWith('9') ? subscriber.slice(1) : subscriber;
  return `${ddd}${withoutNinthDigit}`;
}

function conversationPhone(conversation) {
  const sender = conversation?.meta?.sender || {};
  return sender.phone_number || sender.identifier || sender.whatsapp_jid || '';
}

function personPhone(person) {
  return person?.contact?.whatsapp || person?.contact?.mobile || person?.contact?.work || '';
}

function labelsOf(conversation) {
  return (conversation?.labels || []).map((label) => (
    typeof label === 'string' ? label : label?.title || label?.name || label?.label || ''
  )).filter(Boolean);
}

function hasBeneficiaryLabel(conversation) {
  return labelsOf(conversation).some((label) => normalizeLabel(label) === BENEFICIARY_LABEL);
}

function sha256(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

async function fetchWithRetry(url, options = {}, attempt = 1) {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  if (response.ok) return response;
  if ((response.status === 429 || response.status >= 500) && attempt < 12) {
    const retryAfter = Number(response.headers.get('retry-after') || 0) * 1_000;
    const fallback = response.status === 429
      ? Math.min(90_000, attempt * 7_500)
      : Math.min(20_000, 750 * (2 ** (attempt - 1)));
    await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, fallback)));
    return fetchWithRetry(url, options, attempt + 1);
  }
  const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
  throw new Error(`HTTP ${response.status} em ${url}: ${detail}`);
}

async function fetchJson(url, headers) {
  return (await fetchWithRetry(url, { headers })).json();
}

async function mapConcurrent(items, concurrency, worker, progress) {
  let cursor = 0;
  let completed = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
      completed += 1;
      progress?.(completed, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function loadPagedCollection({ firstUrl, pageUrl, headers, pageSize, totalOf, itemsOf, directory, label }) {
  ensureDir(directory);
  async function getPage(page) {
    const file = path.join(directory, `${String(page).padStart(5, '0')}.json`);
    if (fs.existsSync(file) && fs.statSync(file).size > 2) return readJson(file);
    const payload = await fetchJson(page === 1 ? firstUrl : pageUrl(page), headers);
    writeJsonAtomic(file, payload);
    return payload;
  }

  const first = await getPage(1);
  const total = Number(totalOf(first) || itemsOf(first).length || 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  for (let page = 2; page <= pages; page += 1) {
    await getPage(page);
    if (page % 25 === 0 || page === pages) console.log(`${label}: ${page}/${pages} paginas`);
  }
  const items = [];
  for (let page = 1; page <= pages; page += 1) {
    items.push(...itemsOf(readJson(path.join(directory, `${String(page).padStart(5, '0')}.json`))));
  }
  return { total, pages, items };
}

async function loadAllMessages(accountId, conversationId) {
  const base = `https://chat.agendor.com.br/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
  const byId = new Map();
  let before = null;
  for (let page = 0; page < 1_000; page += 1) {
    const payload = await fetchJson(before ? `${base}?before=${before}` : base, chatHeaders);
    const messages = Array.isArray(payload?.payload) ? payload.payload : [];
    let added = 0;
    for (const message of messages) {
      const key = String(message?.id || '');
      if (key && !byId.has(key)) {
        byId.set(key, message);
        added += 1;
      }
    }
    if (!added || messages.length < 20) break;
    const ids = messages.map((message) => Number(message?.id)).filter(Number.isFinite);
    if (!ids.length) break;
    before = Math.min(...ids);
  }
  return [...byId.values()];
}

function safePart(value) {
  return String(value || 'item').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function extensionOf(attachment) {
  const explicit = safePart(attachment?.extension || '').replace(/^\.+/, '');
  if (explicit) return explicit;
  try {
    const candidate = new URL(String(attachment?.data_url || attachment?.download_url || '')).pathname.split('.').pop();
    return candidate && candidate.length <= 8 ? safePart(candidate) : 'bin';
  } catch {
    return 'bin';
  }
}

async function downloadAttachment(url, destination) {
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) return fs.statSync(destination).size;
  const response = await fetchWithRetry(url, { headers: chatHeaders });
  ensureDir(path.dirname(destination));
  const temporary = `${destination}.tmp-${process.pid}`;
  // Readable.fromWeb aciona uma falha interna do parser do Undici em alguns
  // redirects antigos do Active Storage. Materializar a resposta antes da
  // gravacao evita que um anexo derrube todo o processo retomavel.
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Anexo vazio: ${url}`);
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, destination);
  return bytes.length;
}

async function snapshotConversation(accountId, conversation) {
  const conversationId = String(conversation.id);
  const shard = conversationId.slice(-2).padStart(2, '0');
  const messageFile = path.join(OUTPUT_DIR, 'chat', 'messages', shard, `${safePart(conversationId)}.json`);
  const attachmentIndexFile = path.join(OUTPUT_DIR, 'chat', 'attachment-index', shard, `${safePart(conversationId)}.json`);
  let messages;
  if (fs.existsSync(messageFile) && fs.statSync(messageFile).size > 2) messages = readJson(messageFile);
  else {
    messages = await loadAllMessages(accountId, conversationId);
    writeJsonAtomic(messageFile, messages);
  }

  const savedIndex = fs.existsSync(attachmentIndexFile) && fs.statSync(attachmentIndexFile).size > 2
    ? readJson(attachmentIndexFile)
    : [];
  const savedByAttachment = new Map(savedIndex.map((item) => [
    `${String(item.message_id || '')}:${String(item.attachment_id || '')}`,
    item,
  ]));

  const attachmentIndex = [];
  for (const message of messages) {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      const url = String(attachment?.data_url || attachment?.download_url || '');
      if (!url) continue;
      const attachmentId = String(attachment.id || index + 1);
      const fileName = `${safePart(message.id)}-${safePart(attachment.id || index + 1)}.${extensionOf(attachment)}`;
      const relativeFile = path.join('chat', 'media', shard, safePart(conversationId), fileName);
      const destination = path.join(OUTPUT_DIR, relativeFile);
      const saved = savedByAttachment.get(`${String(message.id || '')}:${attachmentId}`);
      if (saved?.file && fs.existsSync(destination) && fs.statSync(destination).size > 0) {
        attachmentIndex.push({
          ...saved,
          bytes: fs.statSync(destination).size,
          status: 'downloaded',
        });
        continue;
      }
      try {
        if (fs.existsSync(destination) && fs.statSync(destination).size === 0) fs.unlinkSync(destination);
        const bytes = await downloadAttachment(url, destination);
        attachmentIndex.push({
          conversation_id: conversationId,
          message_id: String(message.id || ''),
          attachment_id: attachmentId,
          file: relativeFile.replaceAll('\\', '/'),
          bytes,
          source_url: url,
          status: 'downloaded',
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`Anexo indisponivel no Agendor: conversa ${conversationId}, mensagem ${message.id}: ${detail}`);
        attachmentIndex.push({
          conversation_id: conversationId,
          message_id: String(message.id || ''),
          attachment_id: attachmentId,
          file: null,
          bytes: 0,
          source_url: url,
          status: 'unavailable',
          error: detail,
        });
      }
    }
  }
  writeJsonAtomic(attachmentIndexFile, attachmentIndex);
  return {
    messages: messages.length,
    attachments: attachmentIndex.length,
    attachmentFailures: attachmentIndex.filter((item) => item.status === 'unavailable').length,
  };
}

ensureDir(OUTPUT_DIR);
fs.chmodSync(OUTPUT_DIR, 0o700);
const startedAt = new Date().toISOString();
console.log(`Snapshot: ${OUTPUT_DIR}`);

const crm = await loadPagedCollection({
  firstUrl: `https://api.agendor.com.br/v3/people?per_page=${CRM_PAGE_SIZE}&page=1`,
  pageUrl: (page) => `https://api.agendor.com.br/v3/people?per_page=${CRM_PAGE_SIZE}&page=${page}`,
  headers: crmHeaders,
  pageSize: CRM_PAGE_SIZE,
  totalOf: (payload) => payload?.meta?.totalCount,
  itemsOf: (payload) => payload?.data || [],
  directory: path.join(OUTPUT_DIR, 'crm', 'people-pages'),
  label: 'Contatos CRM',
});

const profile = await fetchJson('https://chat.agendor.com.br/api/v1/profile', chatHeaders);
const accountId = profile?.account_id || profile?.accounts?.[0]?.id;
if (!accountId) throw new Error('Conta do Agendor Chat nao identificada.');
writeJsonAtomic(path.join(OUTPUT_DIR, 'chat', 'profile.json'), profile);

const conversations = await loadPagedCollection({
  firstUrl: `https://chat.agendor.com.br/api/v1/accounts/${accountId}/conversations?sort_order=latest_first&assignee_type=all&page=1`,
  pageUrl: (page) => `https://chat.agendor.com.br/api/v1/accounts/${accountId}/conversations?sort_order=latest_first&assignee_type=all&page=${page}`,
  headers: chatHeaders,
  pageSize: CHAT_PAGE_SIZE,
  totalOf: (payload) => payload?.data?.meta?.all_count,
  itemsOf: (payload) => payload?.data?.payload || [],
  directory: path.join(OUTPUT_DIR, 'chat', 'conversation-pages'),
  label: 'Conversas Chat',
});
const uniqueConversations = [...new Map(
  conversations.items.map((conversation) => [String(conversation.id), conversation]),
).values()];
if (uniqueConversations.length !== conversations.items.length) {
  console.log(`Conversas duplicadas na paginacao ignoradas: ${conversations.items.length - uniqueConversations.length}`);
}

const beneficiaryPhones = new Set(
  uniqueConversations.filter(hasBeneficiaryLabel).map((conversation) => normalizePhone(conversationPhone(conversation))).filter(Boolean),
);
const scope = {
  rule: 'Excluir da futura migracao todo contato cujo telefone apareca em qualquer conversa com etiqueta Beneficiario Ativo.',
  beneficiary_label: 'Beneficiário Ativo',
  included_conversation_ids: [],
  excluded_conversation_ids: [],
  included_person_ids: [],
  excluded_person_ids: [],
  labels: {},
};
for (const conversation of uniqueConversations) {
  const excluded = beneficiaryPhones.has(normalizePhone(conversationPhone(conversation)));
  scope[excluded ? 'excluded_conversation_ids' : 'included_conversation_ids'].push(String(conversation.id));
  for (const label of labelsOf(conversation)) scope.labels[label] = (scope.labels[label] || 0) + 1;
}
for (const person of crm.items) {
  const excluded = beneficiaryPhones.has(normalizePhone(personPhone(person)));
  scope[excluded ? 'excluded_person_ids' : 'included_person_ids'].push(String(person.id));
}
writeJsonAtomic(path.join(OUTPUT_DIR, 'migration-scope.json'), scope);

let messageCount = 0;
let attachmentCount = 0;
let attachmentFailureCount = 0;
await mapConcurrent(
  uniqueConversations,
  CONVERSATION_CONCURRENCY,
  async (conversation) => {
    const counts = await snapshotConversation(accountId, conversation);
    messageCount += counts.messages;
    attachmentCount += counts.attachments;
    attachmentFailureCount += counts.attachmentFailures;
  },
  (done, total) => {
    if (done % 50 === 0 || done === total) console.log(`Historicos: ${done}/${total} conversas, ${messageCount} mensagens, ${attachmentCount} anexos, ${attachmentFailureCount} indisponiveis`);
  },
);

const scopeFile = path.join(OUTPUT_DIR, 'migration-scope.json');
const manifest = {
  version: 1,
  source: 'Agendor CRM + Agendor Chat',
  operation: 'Unity Saude',
  mode: 'read-only snapshot; nenhuma escrita no Orion',
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  account_id: accountId,
  counts: {
    crm_people: crm.items.length,
    chat_conversations: uniqueConversations.length,
    messages: messageCount,
    attachments: attachmentCount,
    attachment_download_failures: attachmentFailureCount,
    beneficiary_phones_excluded: beneficiaryPhones.size,
    conversations_included_for_migration: scope.included_conversation_ids.length,
    conversations_excluded_from_migration: scope.excluded_conversation_ids.length,
    people_included_for_migration: scope.included_person_ids.length,
    people_excluded_from_migration: scope.excluded_person_ids.length,
  },
  migration_scope_sha256: sha256(scopeFile),
};
writeJsonAtomic(path.join(OUTPUT_DIR, 'manifest.json'), manifest);
console.log(JSON.stringify(manifest, null, 2));
