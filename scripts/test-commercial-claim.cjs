const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const groupId = '120363410914570116@g.us';
const leadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const env = { UAZAPI_GLOBAL_TOKEN: 'test-secret-only' };
function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, Buffer, URL, console, process: { env }, require(name) {
    if (name === 'server-only') return {};
    assert.ok(name in imports, `Import nao simulado: ${name}`);
    return imports[name];
  } });
  return exports;
}
const security = load('src/lib/commercialClaimSecurity.ts', { 'node:crypto': require('node:crypto') });
let lead;
let notifications;
let audits;
let timelines;
let queryCalls = 0;
let contactBlocked = false;
let groupNotifications = [];
const profiles = [
  { id: 'sdr-1', nome: 'SDR Um', telefone: '5561999991111', status: 'active' },
  { id: 'sdr-2', nome: 'SDR Dois', telefone: '5561999992222', status: 'active' },
  { id: 'inactive', nome: 'Inativo', telefone: '5561999993333', status: 'inactive' },
];
function reset() {
  lead = { id: leadId, nome: 'Lead MQL S ficticio', sdr_id: null, faturamento_mensal: '100000', investimento: '10000' };
  notifications = []; audits = []; timelines = []; contactBlocked = false; groupNotifications = [];
}
const db = {
  from(table) {
    queryCalls++;
    const filters = [];
    let update;
    let single = false;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      is(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      update(value) { update = value; return query; },
      maybeSingle() { single = true; return query; },
      async insert(value) { assert.equal(table, 'audit_logs'); audits.push(value); return { error: null }; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          let rows = table === 'comercial_leads' ? (lead ? [lead] : [])
            : table === 'profiles' ? profiles
            : table === 'notificacao_preferencias' ? []
            : table === 'comercial_membros' ? [
              { profile_id: 'sdr-1', papel: 'sdr', ativo: true },
              { profile_id: 'sdr-2', papel: 'sdr', ativo: true },
              { profile_id: 'inactive', papel: 'sdr', ativo: false },
            ] : [];
          rows = rows.filter(row => filters.every(filter => filter(row)));
          if (update && contactBlocked) {
            return {
              data: null,
              error: {
                code: 'P0001',
                message: 'START bloqueado: registre uma tentativa de contato com o lead anterior (Lead anterior MQL ficticio) antes de assumir outro.',
                details: '',
              },
            };
          }
          if (update && rows.length) { Object.assign(lead, update); rows = [{ ...lead }]; }
          return { data: single ? rows[0] || null : rows, error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  },
};
const claims = load('src/lib/commercialLeadClaim.ts', {
  '@/lib/supabase/admin': { supabaseAdmin: db },
  '@/lib/commercialLeadNotifications': { async notifyCommercialLeadAssignment(value) { notifications.push(value); } },
  '@/lib/commercialTimeline': { async recordCommercialTimelineEvent(value) { timelines.push(value); } },
});
let storedMessage;
const handler = load('src/lib/commercialWhatsAppClaim.ts', {
  '@/lib/supabase/admin': { supabaseAdmin: db },
  '@/lib/apoloNotifications': { APOLO_MASTER_INSTANCE: 'apolo_master_sender' },
  '@/lib/commercialNotificationGroup': {
    commercialNotificationGroupId: () => groupId,
    async sendCommercialGroupNotification(id, title, message) {
      groupNotifications.push({ id, title, message });
      return [{ group_id: id, status: 'success' }];
    },
  },
  '@/lib/commercialClaimSecurity': security,
  '@/lib/commercialLeadClaim': claims,
  '@/lib/uazapi': {
    phoneMatchKey: value => String(value || '').replace(/\D/g, ''),
    async uazapiFetch(endpoint, init, options) {
      assert.equal(options.instanceName, 'apolo_master_sender');
      if (endpoint === '/message/find') return { messages: storedMessage ? [storedMessage] : [] };
      assert.equal(endpoint, '/group/info');
      assert.equal(JSON.parse(init.body).groupjid, groupId);
      return { JID: groupId, Participants: [{ JID: '123@lid', LID: '123@lid', PhoneNumber: '5561999991111@s.whatsapp.net' }] };
    },
  },
});
async function main() {
  reset();
  const buttonId = security.commercialClaimButtonId(groupId, leadId);
  assert.equal(security.leadIdFromCommercialClaimButton(groupId, buttonId), leadId);
  assert.equal(security.leadIdFromCommercialClaimButton('other@g.us', buttonId), null);
  assert.equal(security.leadIdFromCommercialClaimButton(groupId, buttonId.replace(leadId, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')), null);
  assert.equal(security.isCommercialClaimWebhookAuthorized(''), false);
  assert.equal(security.isCommercialClaimWebhookAuthorized(security.commercialClaimWebhookSecret()), true);

  const results = await Promise.all([
    claims.claimCommercialLead(leadId, 'sdr-1', 'whatsapp_grupo'),
    claims.claimCommercialLead(leadId, 'sdr-2', 'fila'),
  ]);
  assert.equal(results.filter(x => x.status === 'claimed').length, 1);
  assert.equal(results.filter(x => x.status === 'conflict').length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(timelines.length, 1);
  const winner = lead.sdr_id;
  assert.equal((await claims.claimCommercialLead(leadId, winner, 'whatsapp_grupo')).status, 'already_owned');
  assert.equal(notifications.length, 1);
  assert.equal((await claims.claimCommercialLead(leadId, 'inactive', 'fila')).status, 'forbidden');
  assert.equal(lead.sdr_id, winner);

  reset();
  storedMessage = { id: 'message-1', fromMe: false, isGroup: true, chatid: groupId, sender: '123@lid', buttonOrListid: buttonId };
  assert.equal((await handler.handleCommercialWhatsAppClaim('message-1')).status, 'claimed');
  assert.equal(lead.sdr_id, 'sdr-1');
  assert.equal((await handler.handleCommercialWhatsAppClaim('message-1')).status, 'already_owned');
  assert.equal(notifications.length, 1);

  reset();
  contactBlocked = true;
  storedMessage = { id: 'message-1', fromMe: false, isGroup: true, chatid: groupId, sender: '123@lid', buttonOrListid: buttonId };
  const blocked = await handler.handleCommercialWhatsAppClaim('message-1');
  assert.equal(blocked.status, 'previous_contact_required');
  assert.equal(blocked.previousLeadName, 'Lead anterior MQL ficticio');
  assert.equal(groupNotifications.length, 1);
  assert.equal(groupNotifications[0].title, 'START bloqueado');
  assert.match(groupNotifications[0].message, /Lead anterior MQL ficticio/);
  assert.doesNotMatch(groupNotifications[0].message, /5561999991111/);

  for (const patch of [
    { fromMe: true }, { isGroup: false }, { chatid: 'other@g.us' },
    { buttonOrListid: 'orion_claim:forged' }, { sender: 'attacker@lid' }, { id: 'different-id' },
  ]) {
    reset();
    storedMessage = { id: 'message-1', fromMe: false, isGroup: true, chatid: groupId, sender: '123@lid', buttonOrListid: buttonId, ...patch };
    const result = await handler.handleCommercialWhatsAppClaim('message-1');
    assert.notEqual(result.status, 'claimed');
    assert.equal(lead.sdr_id, null);
    assert.equal(notifications.length, 0);
  }
  const route = load('src/app/api/webhooks/comercial/whatsapp/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/commercialClaimSecurity': security,
    '@/lib/commercialWhatsAppClaim': handler,
  });
  const before = queryCalls;
  const unauth = await route.POST(new Request('https://example.test/api/webhooks/comercial/whatsapp', { method: 'POST', body: JSON.stringify({ message: storedMessage }) }));
  // URL e fornecida ao sandbox para a rota.
  assert.equal(unauth.status, 401);
  assert.equal(queryCalls, before);
  const distribution = load('src/lib/commercialDistribution.ts', { '@/lib/supabase/admin': { supabaseAdmin: db } });
  for (const level of ['S', 'A', 'B', 'C', null]) assert.equal(await distribution.donoAutomaticoDoLead(level), null);
  console.log('OK: disputa grupo/CRM, MQL S, duplicatas, assinatura, autenticacao, LID, remetente e grupo.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
