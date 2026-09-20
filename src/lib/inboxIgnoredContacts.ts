const IGNORED_INBOX_PHONE_KEYS = new Set([
  '556192370710', // Numero interno do Apolo Notificador.
]);

function phoneKey(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

export function isIgnoredInboxContact(value: unknown) {
  return IGNORED_INBOX_PHONE_KEYS.has(phoneKey(value));
}
