create table if not exists public.corretoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  status text not null default 'ativo',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists corretoras_nome_unique_idx
on public.corretoras (lower(trim(nome)));

alter table public.corretoras enable row level security;

drop policy if exists "corretoras_admin_all" on public.corretoras;
create policy "corretoras_admin_all"
on public.corretoras
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
);

drop policy if exists "corretoras_team_read" on public.corretoras;
create policy "corretoras_team_read"
on public.corretoras
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario in ('admin', 'gestor_trafego', 'account_manager')
  )
);
