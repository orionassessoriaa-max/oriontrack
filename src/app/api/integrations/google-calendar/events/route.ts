import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { listGoogleCalendarEvents } from '@/lib/integrations/googleCalendar';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const url = new URL(request.url);
  const timeMin = new Date(String(url.searchParams.get('time_min') || ''));
  const timeMax = new Date(String(url.searchParams.get('time_max') || ''));
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) {
    return NextResponse.json({ error: 'Informe o inicio e o fim da agenda.' }, { status: 400 });
  }
  try {
    const events = await listGoogleCalendarEvents(timeMin, timeMax);
    return NextResponse.json({
      events,
      duration_minutes: Math.min(240, Math.max(15, Number(process.env.GOOGLE_CALENDAR_MEETING_DURATION_MINUTES || 60))),
      time_zone: 'America/Sao_Paulo',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nao foi possivel carregar a agenda do Google.';
    console.error('commercial_google_calendar_events_failed', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
