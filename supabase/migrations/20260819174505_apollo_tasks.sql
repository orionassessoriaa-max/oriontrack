create table if not exists public.apollo_tasks (
  id uuid primary key default gen_random_uuid(),
  equipe text not null default 'apollo' check (equipe = 'apollo'),
  titulo text not null check (char_length(btrim(titulo)) between 2 and 180),
  prazo timestamptz not null,
  status text not null default 'a_fazer' check (status in ('a_fazer', 'fazendo', 'feito')),
  responsavel_profile_id uuid not null references public.profiles(id) on delete cascade,
  criado_por_profile_id uuid not null references public.profiles(id) on delete restrict,
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apollo_tasks_responsavel_status_prazo_idx
  on public.apollo_tasks (responsavel_profile_id, status, prazo);

create index if not exists apollo_tasks_status_prazo_idx
  on public.apollo_tasks (status, prazo);

create index if not exists apollo_tasks_criado_por_idx
  on public.apollo_tasks (criado_por_profile_id, created_at desc);

alter table public.apollo_tasks enable row level security;

revoke all on table public.apollo_tasks from anon, authenticated;
grant all on table public.apollo_tasks to service_role;

comment on table public.apollo_tasks is
  'Tarefas internas do time Apollo. O acesso e mediado pela API, que aplica escopo por usuario.';
