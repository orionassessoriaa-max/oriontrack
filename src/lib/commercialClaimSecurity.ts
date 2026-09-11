import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(value: string) {
  const key = process.env.UAZAPI_GLOBAL_TOKEN;
  if (!key) throw new Error('Token UAZAPI ausente para autenticar o START.');
  return createHmac('sha256', key).update(value).digest('hex');
}

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function commercialClaimWebhookSecret() {
  return signature('orion:commercial-group-webhook:v1');
}

export function isCommercialClaimWebhookAuthorized(secret: string) {
  return equal(secret, commercialClaimWebhookSecret());
}

export function commercialClaimButtonId(groupId: string, leadId: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(leadId)) {
    throw new Error('ID de lead invalido para o botao START.');
  }
  return `orion_claim:${leadId}:${signature(`claim:${groupId}:${leadId}`).slice(0, 32)}`;
}

export function leadIdFromCommercialClaimButton(groupId: string, buttonId: string) {
  const match = /^orion_claim:([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}):([0-9a-f]{32})$/i.exec(buttonId);
  if (!match) return null;
  return equal(buttonId, commercialClaimButtonId(groupId, match[1])) ? match[1] : null;
}
