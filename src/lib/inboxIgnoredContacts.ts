const IGNORED_INBOX_PHONE_KEYS = new Set([
  '6184409328', // Numero interno da administracao Orion.
  '6192370710', // Numero interno do Apolo Notificador.
]);

// Contatos desta lista nao devem nem entrar no processamento do webhook. O
// numero da administracao Orion fica fora daqui de proposito: ele continua
// oculto no Inbox, mas pode responder a um teste de IA e manter o fluxo ativo.
const IGNORED_INBOX_WEBHOOK_PHONE_KEYS = new Set([
  '6192370710', // Numero interno do Apolo Notificador.
]);

const IGNORED_INBOX_INSTANCES = new Set([
  'apolo_master_sender',
]);

function phoneKey(value: unknown) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }

  // O provedor pode devolver o mesmo celular com ou sem o nono digito. A
  // chave canonica impede que uma dessas variacoes reapareca como contato.
  if (digits.length === 11 && digits.slice(2).startsWith('9')) {
    digits = `${digits.slice(0, 2)}${digits.slice(3)}`;
  }

  return digits;
}

export function isIgnoredInboxContact(value: unknown) {
  return IGNORED_INBOX_PHONE_KEYS.has(phoneKey(value));
}

export function isIgnoredInboxWebhookContact(value: unknown) {
  return IGNORED_INBOX_WEBHOOK_PHONE_KEYS.has(phoneKey(value));
}

export function isIgnoredInboxSource(instance: unknown, ownerPhone: unknown) {
  const instanceKey = String(instance || '').trim().toLowerCase();
  return IGNORED_INBOX_INSTANCES.has(instanceKey) || isIgnoredInboxContact(ownerPhone);
}
