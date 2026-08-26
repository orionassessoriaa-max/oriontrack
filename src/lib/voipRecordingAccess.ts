import { createHmac, timingSafeEqual } from 'node:crypto';

function signingSecret() {
  const secret = process.env.VOIP_RECORDING_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('VOIP_RECORDING_SIGNING_SECRET precisa ter pelo menos 32 caracteres.');
  }
  return secret;
}

function signature(recordId: number, expires: number) {
  return createHmac('sha256', signingSecret()).update(`${recordId}:${expires}`).digest('hex');
}

export function signedRecordingUrl(recordId: number, ttlSeconds = 3600) {
  const expires = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds);
  const sig = signature(recordId, expires);
  return `/api/comercial/calls/recording?record_id=${recordId}&expires=${expires}&signature=${sig}`;
}

export function validRecordingSignature(recordId: number, expires: number, received: string) {
  if (!Number.isSafeInteger(recordId) || recordId <= 0 || expires < Math.floor(Date.now() / 1000)) return false;
  if (expires > Math.floor(Date.now() / 1000) + 7200 || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = Buffer.from(signature(recordId, expires), 'hex');
  const actual = Buffer.from(received, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
