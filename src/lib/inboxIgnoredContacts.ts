const IGNORED_INBOX_PHONE_KEYS = new Set([
  '6184409328', // Numero interno da administracao Orion.
  '6192370710', // Numero interno do Apolo Notificador.
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
