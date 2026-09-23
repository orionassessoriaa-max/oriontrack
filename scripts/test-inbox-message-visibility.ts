import assert from 'node:assert/strict';
import { memberCanViewInboxMessage } from '../src/lib/inboxMessageVisibility';

const danilo = '1256c916-7a9c-4cb2-96bb-aeaee5088a8b';
const henrique = 'c0e7ff54-2e0c-4c76-8745-c9fd85eddf19';
const admin = 'e1db6a41-8395-4c7d-b92d-70642f26edc0';
const roles = new Map([
  [henrique, 'corretor_membro'],
  [admin, 'corretor_admin'],
]);

assert.equal(memberCanViewInboxMessage(danilo, {
  direction: 'inbound',
  metadata: { instance: `orion_${henrique}` },
}, roles), true, 'audio recebido pertence ao cliente, nao ao dono da instancia');

assert.equal(memberCanViewInboxMessage(danilo, {
  direction: 'outbound',
  metadata: { sender_profile_id: henrique },
}, roles), false, 'mensagem privada de outro integrante continua oculta');

assert.equal(memberCanViewInboxMessage(danilo, {
  direction: 'outbound',
  metadata: { sender_profile_id: danilo },
}, roles), true, 'integrante pode ver a propria mensagem');

assert.equal(memberCanViewInboxMessage(danilo, {
  direction: 'outbound',
  metadata: { sender_profile_id: admin },
}, roles), true, 'mensagem do administrador continua visivel');

console.log('Inbox message visibility: 4 verificacoes aprovadas.');
