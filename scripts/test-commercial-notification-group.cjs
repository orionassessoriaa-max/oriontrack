const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercita o fluxo real com fronteiras externas simuladas, sem enviar mensagens.
const root = path.resolve(__dirname, '..');
const groupId = '120363410914570116@g.us';
const env = { COMMERCIAL_LEADS_WHATSAPP_GROUP_ID: groupId, UAZAPI_GLOBAL_TOKEN: 'test-only-not-a-real-secret' };
let groupCalls = [];
let privateCalls = [];
let auditRows = [];
let providerFails = false;
const sdr = { id: 'sdr-1', nome: 'Responsavel Teste', telefone: '556100000000', tipo_usuario: 'sdr' };
const coordinator = { id: 'coordinator-1', nome: 'Coordenador Teste', telefone: '556100000001', tipo_usuario: 'coordenador' };
const lead = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', nome: 'Lead Ficticio', telefone: '556100000002', empresa: 'Empresa Teste', sdr_id: sdr.id };

function loadModule(file, imports) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, process: { env }, console, Buffer,
    require(name) {
      if (name === 'server-only') return {};
      if (!(name in imports)) throw new Error(`Import nao simulado: ${name}`);
      return imports[name];
    },
  }, { filename: file });
  return exports;
}

const apolo = {
  APOLO_MASTER_INSTANCE: 'apolo_master_sender',
  async sendApoloWhatsApp(options) {
    privateCalls.push(options);
    return options.profiles.map(profile => ({ profile_id: profile.id, status: 'success' }));
  },
};
const security = loadModule('src/lib/commercialClaimSecurity.ts', { 'node:crypto': require('node:crypto') });
const group = loadModule('src/lib/commercialNotificationGroup.ts', {
  '@/lib/commercialClaimSecurity': security,
  '@/lib/apoloNotifications': apolo,
  '@/lib/uazapi': {
    async uazapiFetch(url, options, instance) {
      groupCalls.push({ url, body: JSON.parse(options.body), instance });
      if (providerFails) throw new Error('Falha simulada do provedor');
      return { response: { status: 'success' } };
    },
  },
});
const notifications = loadModule('src/lib/commercialLeadNotifications.ts', {
  '@/lib/openaiUso': { openaiFetch() { throw new Error('Teste nao deve chamar IA'); } },
  '@/lib/apoloNotifications': apolo,
  '@/lib/commercialNotificationGroup': group,
  '@/lib/commercialQualification': { isCommercialMql: () => true, getCommercialMqlLevel: () => 'S' },
  '@/lib/supabase/admin': {
    supabaseAdmin: {
      from(table) {
        if (table === 'audit_logs') return { async insert(row) { auditRows.push(row); return { error: null }; } };
        let papel;
        let ids;
        const query = {
          select() { return query; },
          eq(key, value) { if (key === 'papel') papel = value; return query; },
          in(key, value) { if (key === 'id') ids = value; return query; },
          then(resolve, reject) {
            const members = [
              { profile_id: sdr.id, papel: 'sdr', ativo: true },
              { profile_id: coordinator.id, papel: 'coordenador', ativo: true },
            ];
            const data = table === 'comercial_membros'
              ? members.filter(row => !papel || row.papel === papel)
              : [sdr, coordinator].filter(row => !ids || ids.includes(row.id));
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    },
  },
});

async function main() {
  await notifications.notifyCommercialLeadPool(lead);
  assert.equal(groupCalls.length, 1);
  assert.equal(privateCalls.length, 0);
  assert.equal(groupCalls[0].body.number, groupId);
  assert.equal(groupCalls[0].instance.instanceName, 'apolo_master_sender');
  assert.equal(groupCalls[0].url, '/send/menu');
  assert.match(groupCalls[0].body.choices[0], /^ASSUMIR LEAD\|orion_claim:/);
  assert.equal(security.leadIdFromCommercialClaimButton(groupId, groupCalls[0].body.choices[0].split('|')[1]), lead.id);
  assert.ok(!groupCalls[0].body.text.includes(lead.nome));
  assert.ok(!groupCalls[0].body.text.includes(lead.telefone));

  groupCalls = []; privateCalls = [];
  const assignment = await notifications.notifyCommercialLeadAssignment(lead);
  assert.equal(groupCalls.length, 1);
  assert.ok(groupCalls[0].body.text.includes(lead.nome));
  assert.ok(!groupCalls[0].body.text.includes(lead.telefone));
  assert.ok(!groupCalls[0].body.text.includes(lead.empresa));
  assert.ok(!groupCalls[0].body.text.includes('Faturamento:'));
  assert.ok(groupCalls[0].body.text.includes(sdr.nome));
  assert.equal(assignment.sdr.length, 0);
  assert.equal(assignment.group[0].group_id, groupId);
  assert.equal(privateCalls.length, 1);
  assert.equal(privateCalls[0].profiles[0].id, coordinator.id);
  assert.equal(auditRows[0].metadata.group_delivery[0].group_id, groupId);
  assert.equal(auditRows[0].metadata.coordinator_delivery[0].profile_id, coordinator.id);

  providerFails = true; privateCalls = [];
  await assert.rejects(() => notifications.notifyCommercialLeadPool(lead), /Falha simulada/);
  await assert.rejects(() => notifications.notifyCommercialLeadAssignment(lead), /Falha simulada/);
  assert.ok(privateCalls.every(call => call.profiles.every(profile => profile.id !== sdr.id)));
  providerFails = false;

  env.COMMERCIAL_LEADS_WHATSAPP_GROUP_ID = '556100000000';
  const previousCount = groupCalls.length;
  await assert.rejects(() => notifications.notifyCommercialLeadPool(lead), /JID completo/);
  assert.equal(groupCalls.length, previousCount);

  env.COMMERCIAL_LEADS_WHATSAPP_GROUP_ID = '';
  groupCalls = []; privateCalls = []; auditRows = [];
  await notifications.notifyCommercialLeadPool(lead);
  const individual = await notifications.notifyCommercialLeadAssignment(lead);
  assert.equal(groupCalls.length, 0);
  assert.equal(privateCalls[0].profiles[0].id, sdr.id);
  assert.equal(individual.sdr[0].profile_id, sdr.id);
  assert.equal(individual.group.length, 0);
  console.log('OK: grupo, privacidade antes do START, atribuicao, coordenadores, falhas e envio individual.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
