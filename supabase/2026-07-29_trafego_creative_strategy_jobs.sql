create table if not exists public.trafego_estrategias_criativos (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  gestor_id uuid not null references public.profiles(id) on delete cascade,
  operadora text not null,
  regiao text not null,
  drive_gestor_folder_id text,
  drive_concessionaria_folder_id text,
  drive_regiao_folder_id text,
  drive_operadora_folder_id text,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corretor_id, operadora, regiao)
);

create table if not exists public.criativo_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  gestor_id uuid not null references public.profiles(id) on delete cascade,
  estrategia_id uuid references public.trafego_estrategias_criativos(id) on delete set null,
  recommendation_id uuid references public.trafego_recomendacoes(id) on delete set null,
  operadora text not null,
  regiao text not null,
  quantidade integer not null default 4 check (quantidade between 1 and 20),
  briefing text,
  referencia_url text,
  origem text not null default 'criativos'
    check (origem in ('entrada', 'criativos', 'apolo', 'troca_criativo')),
  status text not null default 'na_fila'
    check (status in ('na_fila', 'gerando', 'pronto', 'falhou')),
  progresso integer not null default 0,
  resultado jsonb not null default '[]'::jsonb,
  erro text,
  solicitado_por_profile_id uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.criativo_assets
  add column if not exists generation_job_id uuid references public.criativo_generation_jobs(id) on delete set null,
  add column if not exists operadora text,
  add column if not exists regiao text,
  add column if not exists headline text,
  add column if not exists legenda text,
  add column if not exists drive_file_id text,
  add column if not exists drive_folder_id text;

create index if not exists idx_trafego_estrategias_corretor
  on public.trafego_estrategias_criativos(corretor_id, ativa, created_at desc);
create index if not exists idx_criativo_generation_jobs_gestor
  on public.criativo_generation_jobs(gestor_id, created_at desc);
create index if not exists idx_criativo_generation_jobs_status
  on public.criativo_generation_jobs(status, created_at);
create index if not exists idx_criativo_assets_generation_job
  on public.criativo_assets(generation_job_id);

alter table public.trafego_estrategias_criativos enable row level security;
alter table public.criativo_generation_jobs enable row level security;

drop policy if exists "gestores leem estrategias proprias" on public.trafego_estrategias_criativos;
create policy "gestores leem estrategias proprias"
on public.trafego_estrategias_criativos for select
using (
  gestor_id = auth.uid()
  or exists (select 1 from public.profiles where id = auth.uid() and tipo_usuario = 'admin')
);

drop policy if exists "gestores leem jobs proprios" on public.criativo_generation_jobs;
create policy "gestores leem jobs proprios"
on public.criativo_generation_jobs for select
using (
  gestor_id = auth.uid()
  or exists (select 1 from public.profiles where id = auth.uid() and tipo_usuario = 'admin')
);
