import 'server-only';
import { openaiFetch } from '@/lib/openaiUso';

const READ_SCOPE = 'https://www.googleapis.com/auth/meetings.space.readonly';
const SETTINGS_SCOPE = 'https://www.googleapis.com/auth/meetings.space.settings';

type GoogleParticipant = {
  name?: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: { displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};

type ConferenceRecord = {
  name?: string;
  startTime?: string;
  endTime?: string;
};

type Transcript = {
  name?: string;
  state?: string;
  docsDestination?: { exportUri?: string };
};

type TranscriptEntry = {
  participant?: string;
  text?: string;
  startTime?: string;
};

export type MeetingParticipant = {
  name: string;
  joined_at: string | null;
  left_at: string | null;
};

export class GoogleMeetPermissionError extends Error {}

function oauthConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Workspace nao configurado para sincronizar o Meet.');
  }
  return { clientId, clientSecret, refreshToken };
}

async function workspaceAccessToken(requiredScope: string) {
  const config = oauthConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || 'Nao foi possivel acessar o Google Workspace.');
  }
  const scopes = String(payload.scope || '').split(/\s+/).filter(Boolean);
  if (scopes.length && !scopes.includes(requiredScope)) {
    throw new GoogleMeetPermissionError(`A autorizacao Google nao possui o escopo ${requiredScope}.`);
  }
  return String(payload.access_token);
}

async function meetRequest(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://meet.googleapis.com/v2/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw new GoogleMeetPermissionError(payload?.error?.message || 'A conta Google nao autorizou o acesso aos dados do Meet.');
  }
  if (!response.ok) throw new Error(payload?.error?.message || `Google Meet respondeu com HTTP ${response.status}.`);
  return payload;
}

export function meetingCodeFromLink(value: string | null | undefined) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname !== 'meet.google.com') return null;
    const code = url.pathname.split('/').filter(Boolean)[0] || '';
    return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code) ? code.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function enableMeetAutoTranscription(meetLink: string) {
  const meetingCode = meetingCodeFromLink(meetLink);
  if (!meetingCode) throw new Error('Link do Google Meet invalido.');
  const token = await workspaceAccessToken(SETTINGS_SCOPE);
  const space = await meetRequest(`spaces/${encodeURIComponent(meetingCode)}`, token);
  if (!space.name) throw new Error('O Google Meet nao retornou o identificador da sala.');
  await meetRequest(
    `${space.name}?updateMask=${encodeURIComponent('config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration')}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({
        name: space.name,
        config: {
          artifactConfig: {
            transcriptionConfig: { autoTranscriptionGeneration: 'ON' },
          },
        },
      }),
    },
  );
}

async function listAll<T>(path: string, collection: string, token: string) {
  const items: T[] = [];
  let pageToken = '';
  do {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await meetRequest(`${path}${pageToken ? `${separator}pageToken=${encodeURIComponent(pageToken)}` : ''}`, token);
    items.push(...((payload[collection] || []) as T[]));
    pageToken = String(payload.nextPageToken || '');
  } while (pageToken);
  return items;
}

function participantDisplayName(participant: GoogleParticipant) {
  return participant.signedinUser?.displayName
    || participant.anonymousUser?.displayName
    || participant.phoneUser?.displayName
    || 'Participante nao identificado';
}

function fallbackMeetingSummary(transcript: string) {
  const excerpts = transcript.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 8);
  return [
    'Resumo automático provisório',
    '',
    ...excerpts.map((line) => `- ${line}`),
    '',
    'Revise a transcrição completa para validar decisões e próximos passos.',
  ].join('\n');
}

async function generateMeetingSummary(transcript: string) {
  const fallback = fallbackMeetingSummary(transcript);
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    const response = await openaiFetch('resumo_reuniao_comercial', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        temperature: 0.15,
        messages: [
          {
            role: 'system',
            content: 'Resuma reunioes comerciais em portugues do Brasil. Use apenas fatos presentes na transcricao. Organize em: Contexto, Necessidades, Objecoes, Decisoes e Proximos passos. Seja objetivo, preserve nomes e numeros e sinalize quando algo nao foi definido.',
          },
          { role: 'user', content: transcript.slice(0, 120_000) },
        ],
      }),
      cache: 'no-store',
    }, 90_000);
    if (!response.ok) return fallback;
    const payload = await response.json().catch(() => ({}));
    return String(payload.choices?.[0]?.message?.content || '').trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function readMeetArtifacts(meetLink: string) {
  const meetingCode = meetingCodeFromLink(meetLink);
  if (!meetingCode) throw new Error('Link do Google Meet invalido.');
  const token = await workspaceAccessToken(READ_SCOPE);
  const filter = `space.meeting_code = "${meetingCode}"`;
  const recordPayload = await meetRequest(`conferenceRecords?filter=${encodeURIComponent(filter)}&pageSize=10`, token);
  const records = (recordPayload.conferenceRecords || []) as ConferenceRecord[];
  const record = records.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')))[0];
  if (!record?.name) return { status: 'waiting' as const };

  const googleParticipants = await listAll<GoogleParticipant>(`${record.name}/participants?pageSize=250`, 'participants', token);
  const participants: MeetingParticipant[] = googleParticipants.map((participant) => ({
    name: participantDisplayName(participant),
    joined_at: participant.earliestStartTime || null,
    left_at: participant.latestEndTime || null,
  }));
  if (!record.endTime) {
    return { status: 'in_progress' as const, conferenceRecordName: record.name, participants };
  }

  const transcripts = await listAll<Transcript>(`${record.name}/transcripts?pageSize=100`, 'transcripts', token);
  const readyTranscripts = transcripts.filter((transcript) => transcript.state === 'FILE_GENERATED' && transcript.name);
  if (!readyTranscripts.length) {
    return {
      status: transcripts.length ? 'transcript_pending' as const : 'unavailable' as const,
      conferenceRecordName: record.name,
      participants,
    };
  }

  const participantNames = new Map(googleParticipants.map((participant) => [participant.name, participantDisplayName(participant)]));
  const allEntries: TranscriptEntry[] = [];
  for (const transcript of readyTranscripts) {
    allEntries.push(...await listAll<TranscriptEntry>(`${transcript.name}/entries?pageSize=100`, 'transcriptEntries', token));
  }
  allEntries.sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
  const transcriptText = allEntries
    .map((entry) => `${participantNames.get(entry.participant) || 'Participante'}: ${String(entry.text || '').trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n');
  if (!transcriptText) {
    return { status: 'transcript_pending' as const, conferenceRecordName: record.name, participants };
  }
  return {
    status: 'ready' as const,
    conferenceRecordName: record.name,
    participants,
    transcript: transcriptText,
    transcriptUrl: readyTranscripts.find((transcript) => transcript.docsDestination?.exportUri)?.docsDestination?.exportUri || null,
    summary: await generateMeetingSummary(transcriptText),
  };
}
