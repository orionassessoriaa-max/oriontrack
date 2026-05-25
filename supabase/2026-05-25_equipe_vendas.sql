create table if not exists public.equipe_vendas (
  id uuid primary key default gen_random_uuid(),
  equipe text not null check (equipe in ('apollo', 'kripto_hunters')),
  mes text not null,
  nome text not null,
  vendido text not null,
  valor numeric not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.equipe_vendas enable row level security;

drop policy if exists equipe_vendas_admin_all on public.equipe_vendas;
create policy equipe_vendas_admin_all
on public.equipe_vendas
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists equipe_vendas_team_read on public.equipe_vendas;
create policy equipe_vendas_team_read
on public.equipe_vendas
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.equipe_orion = equipe_vendas.equipe
  )
);

create index if not exists equipe_vendas_equipe_mes_idx
on public.equipe_vendas (equipe, mes);
