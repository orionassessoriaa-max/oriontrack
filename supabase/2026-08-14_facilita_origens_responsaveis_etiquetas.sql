create table if not exists public.corretor_lead_origins (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  responsavel_membro_id uuid references public.corretor_time_membros(id) on delete set null,
  responsavel_profile_id uuid references public.profiles(id) on delete set null,
  kanban_etapas jsonb not null default '[]'::jsonb,
  ativo boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists corretor_lead_origins_corretor_nome_uidx
  on public.corretor_lead_origins (corretor_id, lower(btrim(nome)));

create index if not exists corretor_lead_origins_corretor_ativo_idx
  on public.corretor_lead_origins (corretor_id, ativo, nome);

create index if not exists corretor_lead_origins_responsavel_membro_idx
  on public.corretor_lead_origins (responsavel_membro_id)
  where responsavel_membro_id is not null;

create index if not exists corretor_lead_origins_responsavel_profile_idx
  on public.corretor_lead_origins (responsavel_profile_id)
  where responsavel_profile_id is not null;

create table if not exists public.corretor_lead_labels (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  ativo boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists corretor_lead_labels_corretor_nome_uidx
  on public.corretor_lead_labels (corretor_id, lower(btrim(nome)));

create index if not exists corretor_lead_labels_corretor_ativo_idx
  on public.corretor_lead_labels (corretor_id, ativo, nome);

alter table public.leads
  add column if not exists origem_config_id uuid references public.corretor_lead_origins(id) on delete set null;

create index if not exists leads_corretor_origem_config_data_idx
  on public.leads (corretor_id, origem_config_id, data_entrada desc)
  where origem_config_id is not null;

alter table public.corretor_lead_origins enable row level security;
alter table public.corretor_lead_labels enable row level security;

revoke all on table public.corretor_lead_origins from anon, authenticated;
revoke all on table public.corretor_lead_labels from anon, authenticated;
grant select, insert, update, delete on table public.corretor_lead_origins to service_role;
grant select, insert, update, delete on table public.corretor_lead_labels to service_role;

comment on table public.corretor_lead_origins is
  'Origens reutilizaveis, responsavel padrao e etapas do pipeline por concessionaria.';

comment on table public.corretor_lead_labels is
  'Etiquetas reutilizaveis dos leads por concessionaria.';

comment on column public.leads.origem_config_id is
  'Origem configurada usada para selecionar o pipeline da concessionaria.';
