import 'server-only';

import { profileIdFromUazapiInstance } from '@/lib/uazapi';

const SUPERVISOR_ROLES = new Set(['admin', 'corretor_admin', 'account_manager']);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asUuid(value: unknown) {
  const candidate = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

export function inboxMessageProfileId(message: unknown) {
  const source = record(message);
  const metadata = record(source.metadata);
  const data = record(metadata.data);
  const nestedMessage = record(metadata.message);
  const explicitProfileId = asUuid(
    metadata.sender_profile_id
    || metadata.senderProfileId
    || data.sender_profile_id
    || nestedMessage.sender_profile_id
  );
  if (explicitProfileId) return explicitProfileId;

  const instance = String(
    metadata.instance
    || metadata.instanceName
    || metadata.session
    || data.instance
    || data.instanceName
    || nestedMessage.instance
    || nestedMessage.instanceName
    || ''
  ).trim();

  return asUuid(profileIdFromUazapiInstance(instance));
}

export function memberCanViewInboxMessage(
  viewerProfileId: string,
  message: unknown,
  roleByProfileId: ReadonlyMap<string, string> = new Map(),
) {
  const viewerId = String(viewerProfileId || '').trim().toLowerCase();
  const source = record(message);
  const metadata = record(source.metadata);

  // Em mensagem recebida, a instancia identifica o WhatsApp que recebeu o
  // arquivo, nao a pessoa que escreveu. Antes ela era tratada como autoria do
  // dono da instancia e integrantes autorizados na conversa recebiam 403 ao
  // tentar abrir audios, imagens e documentos enviados pelo cliente.
  if (source.direction === 'inbound') return true;

  const actorProfileId = inboxMessageProfileId(message);

  if (actorProfileId) {
    if (actorProfileId === viewerId) return true;
    return SUPERVISOR_ROLES.has(String(roleByProfileId.get(actorProfileId) || '').toLowerCase());
  }

  // Respostas da IA pertencem ao atendimento do lead. Uma mensagem humana
  // enviada sem autoria comprovada nao pode vazar para outro integrante.
  if (metadata.ai_agent === true || metadata.sender_type === 'ai') return true;
  return false;
}

