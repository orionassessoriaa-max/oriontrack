create table if not exists public.comercial_ligacoes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.comercial_leads(id) on delete cascade,
  sdr_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'iniciada'
    check (status in ('iniciada', 'atendida', 'nao_atendida', 'concluida')),
  iniciada_at timestamptz not null default now(),
  finalizada_at timestamptz,
  duracao_segundos integer check (duracao_segundos is null or duracao_segundos >= 0),
  gravacao_url text,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comercial_ligacoes_sdr_iniciada_idx
  on public.comercial_ligacoes(sdr_id, iniciada_at desc);
create index if not exists comercial_ligacoes_lead_iniciada_idx
  on public.comercial_ligacoes(lead_id, iniciada_at desc);

alter table public.comercial_ligacoes enable row level security;
revoke all on table public.comercial_ligacoes from anon, authenticated;
grant select, insert, update, delete on table public.comercial_ligacoes to service_role;

notify pgrst, 'reload schema';
