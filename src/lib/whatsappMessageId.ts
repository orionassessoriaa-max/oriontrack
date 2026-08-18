export function normalizeWhatsAppMessageId(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const separatorIndex = raw.lastIndexOf(':');
  return separatorIndex >= 0 ? raw.slice(separatorIndex + 1).trim() : raw;
}
