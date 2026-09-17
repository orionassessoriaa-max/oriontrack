import 'server-only';
import { randomUUID } from 'node:crypto';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

type CalendarLead = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  data_entrada: string;
  reuniao_agendada_at: string;
  google_calendar_event_id?: string | null;
};

type GoogleEvent = {
  id?: string;
  summary?: string;
  status?: string;
  colorId?: string;
  transparency?: string;
  eventType?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    createRequest?: { status?: { statusCode?: string } };
  };
};

export type GoogleCalendarScheduleEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean;
  colorId: string | null;
};

function requiredConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar não configurado. Autorize a conta da agenda comercial.');
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
  };
}

export function isGoogleCalendarConfigured() {
  return Boolean(
    (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID)
      && (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET)
      && process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
  );
}

export function isValidCalendarGuestEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function accessToken() {
  const config = requiredConfig();
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
    throw new Error(payload.error_description || 'Não foi possível acessar a agenda comercial do Google.');
  }
  if (payload.scope && !String(payload.scope).split(/\s+/).includes(CALENDAR_SCOPE)) {
    throw new Error('A conta Google foi autorizada sem permissão para criar eventos no Calendar.');
  }
  return String(payload.access_token);
}

function eventIdForLead(leadId: string) {
  return `orion${leadId.replace(/[^a-f0-9]/gi, '').toLowerCase()}`;
}

function meetLink(event: GoogleEvent) {
  return event.hangoutLink
    || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri
    || null;
}

function formatCrmEntry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TIME_ZONE,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

function eventDescription(lead: CalendarLead) {
  return [
    'Reunião comercial criada automaticamente pelo Orion Track.',
    '',
    `Lead: ${lead.nome}`,
    `Empresa: ${lead.empresa || 'Não informada'}`,
    `Telefone: ${lead.telefone || 'Não informado'}`,
    `E-mail: ${lead.email || 'Não informado'}`,
    `Data de entrada no CRM: ${formatCrmEntry(lead.data_entrada)}`,
  ].join('\n');
}

async function calendarRequest(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function waitForMeet(calendarId: string, eventId: string, token: string, initial: GoogleEvent) {
  let event = initial;
  for (let attempt = 0; attempt < 5 && !meetLink(event); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = await calendarRequest(
      `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      token,
    );
    if (!result.response.ok) break;
    event = result.payload as GoogleEvent;
  }
  return event;
}

export async function listGoogleCalendarEvents(timeMin: Date, timeMax: Date) {
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime()) || timeMax <= timeMin) {
    throw new Error('Intervalo da agenda invalido.');
  }
  if (timeMax.getTime() - timeMin.getTime() > 32 * 24 * 60 * 60 * 1000) {
    throw new Error('Consulte no maximo 32 dias da agenda por vez.');
  }
  const config = requiredConfig();
  const token = await accessToken();
  const events: GoogleCalendarScheduleEvent[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      showDeleted: 'false',
      maxResults: '2500',
      timeZone: SAO_PAULO_TIME_ZONE,
      ...(pageToken ? { pageToken } : {}),
    });
    const result = await calendarRequest(
      `calendars/${encodeURIComponent(config.calendarId)}/events?${params.toString()}`,
      token,
    );
    if (!result.response.ok) {
      const message = result.payload?.error?.message || `Google Calendar recusou a consulta (${result.response.status}).`;
      throw new Error(message);
    }
    for (const event of (result.payload?.items || []) as GoogleEvent[]) {
      const start = event.start?.dateTime || event.start?.date;
      const end = event.end?.dateTime || event.end?.date;
      if (!event.id || !start || !end || event.status === 'cancelled') continue;
      const allDay = Boolean(event.start?.date && !event.start?.dateTime);
      events.push({
        id: event.id,
        title: event.summary || 'Ocupado',
        start,
        end,
        allDay,
        busy: event.transparency !== 'transparent'
          && event.eventType !== 'workingLocation'
          && event.eventType !== 'birthday',
        colorId: event.colorId || null,
      });
    }
    pageToken = String(result.payload?.nextPageToken || '');
  } while (pageToken);
  return events;
}

export async function syncGoogleCalendarMeeting(lead: CalendarLead) {
  if (!isValidCalendarGuestEmail(lead.email)) {
    throw new Error('Informe um e-mail válido para convidar o lead para a reunião.');
  }
  const scheduledAt = new Date(lead.reuniao_agendada_at);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('Data da reunião inválida.');

  const config = requiredConfig();
  const token = await accessToken();
  const duration = Math.min(240, Math.max(15, Number(process.env.GOOGLE_CALENDAR_MEETING_DURATION_MINUTES || 60)));
  const endAt = new Date(scheduledAt.getTime() + duration * 60_000);
  const eventId = lead.google_calendar_event_id || eventIdForLead(lead.id);
  const titleSuffix = process.env.GOOGLE_CALENDAR_TITLE_SUFFIX || 'Consultoria Orion (K)';
  const commonBody = {
    summary: `${lead.nome} & ${titleSuffix}`,
    description: eventDescription(lead),
    start: { dateTime: scheduledAt.toISOString(), timeZone: SAO_PAULO_TIME_ZONE },
    end: { dateTime: endAt.toISOString(), timeZone: SAO_PAULO_TIME_ZONE },
    attendees: [{ email: String(lead.email).trim(), displayName: lead.nome }],
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: { useDefault: true },
  };
  const createBody = {
    id: eventId,
    ...commonBody,
    conferenceData: {
      createRequest: {
        requestId: `orion-${lead.id}-${randomUUID()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  const query = 'conferenceDataVersion=1&sendUpdates=all';
  let result;
  if (lead.google_calendar_event_id) {
    result = await calendarRequest(
      `calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}?${query}`,
      token,
      { method: 'PATCH', body: JSON.stringify(commonBody) },
    );
    if (result.response.status === 404) {
      result = await calendarRequest(
        `calendars/${encodeURIComponent(config.calendarId)}/events?${query}`,
        token,
        { method: 'POST', body: JSON.stringify(createBody) },
      );
    }
  } else {
    result = await calendarRequest(
      `calendars/${encodeURIComponent(config.calendarId)}/events?${query}`,
      token,
      { method: 'POST', body: JSON.stringify(createBody) },
    );
  }
  if (result.response.status === 409) {
    result = await calendarRequest(
      `calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}?${query}`,
      token,
      { method: 'PATCH', body: JSON.stringify(commonBody) },
    );
  }

  if (!result.response.ok) {
    const message = result.payload?.error?.message || `Google Calendar recusou o evento (${result.response.status}).`;
    throw new Error(message);
  }

  const event = await waitForMeet(config.calendarId, eventId, token, result.payload as GoogleEvent);
  const videoLink = meetLink(event);
  if (!videoLink) throw new Error('O Google criou o evento, mas ainda não disponibilizou o link do Meet. Tente novamente.');
  return {
    eventId: event.id || eventId,
    meetLink: videoLink,
    calendarLink: event.htmlLink || null,
  };
}
