alter table public.comercial_leads
  add column if not exists google_calendar_event_id text,
  add column if not exists google_calendar_synced_at timestamptz;

comment on column public.comercial_leads.google_calendar_event_id is
  'ID do evento criado na agenda comercial do Google Calendar.';
comment on column public.comercial_leads.google_calendar_synced_at is
  'Ultima sincronizacao bem-sucedida com o Google Calendar.';

notify pgrst, 'reload schema';
