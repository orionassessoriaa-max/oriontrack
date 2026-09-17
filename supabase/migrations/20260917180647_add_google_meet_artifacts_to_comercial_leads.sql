alter table public.comercial_leads
  add column if not exists google_meet_conference_record_name text,
  add column if not exists reuniao_participantes jsonb not null default '[]'::jsonb,
  add column if not exists reuniao_transcricao text,
  add column if not exists reuniao_transcricao_url text,
  add column if not exists reuniao_resumo text,
  add column if not exists reuniao_artefatos_status text not null default 'pending',
  add column if not exists reuniao_artefatos_synced_at timestamptz;

alter table public.comercial_leads
  drop constraint if exists comercial_leads_reuniao_artefatos_status_check;

alter table public.comercial_leads
  add constraint comercial_leads_reuniao_artefatos_status_check
  check (reuniao_artefatos_status in (
    'pending',
    'permission_required',
    'waiting',
    'in_progress',
    'transcript_pending',
    'ready',
    'unavailable',
    'error'
  ));

create index if not exists comercial_leads_meet_artifacts_pending_idx
  on public.comercial_leads (reuniao_artefatos_synced_at asc nulls first, reuniao_agendada_at desc)
  where reuniao_link is not null
    and reuniao_agendada_at is not null
    and reuniao_artefatos_status in (
      'pending',
      'permission_required',
      'waiting',
      'in_progress',
      'transcript_pending',
      'error'
    );

comment on column public.comercial_leads.reuniao_participantes is
  'Participantes efetivos devolvidos pela API do Google Meet apos a conferencia.';
comment on column public.comercial_leads.reuniao_transcricao is
  'Texto estruturado da transcricao do Google Meet, com identificacao do participante.';
comment on column public.comercial_leads.reuniao_resumo is
  'Resumo gerado automaticamente a partir da transcricao da reuniao.';
comment on column public.comercial_leads.reuniao_artefatos_status is
  'Estado da sincronizacao dos participantes, transcricao e resumo da reuniao.';
