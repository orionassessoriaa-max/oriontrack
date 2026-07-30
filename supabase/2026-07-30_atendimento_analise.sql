create table if not exists public.atendimento_analise_status (
  concessionaria_key text primary key,
  concessionaria_nome text not null,
  etapa text not null default 'entrada'
    check (etapa in ('entrada', 'safe', 'atencao', 'risco', 'aviso', 'stand_by', 'suspenso')),
  atualizado_por_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gestor_analise_semanal (
  id uuid primary key default gen_random_uuid(),
  gestor_id uuid not null references public.profiles(id) on delete cascade,
  concessionaria_key text not null,
  concessionaria_nome text not null,
  data date not null,
  status text not null check (status in ('boa', 'atencao', 'ruim')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gestor_id, concessionaria_key, data)
);

create index if not exists idx_atendimento_analise_etapa
  on public.atendimento_analise_status(etapa, updated_at desc);
create index if not exists idx_gestor_analise_semana
  on public.gestor_analise_semanal(gestor_id, data, concessionaria_key);

alter table public.atendimento_analise_status enable row level security;
alter table public.gestor_analise_semanal enable row level security;
