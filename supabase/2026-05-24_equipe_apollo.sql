alter table public.profiles
  add column if not exists equipe_orion text
  check (equipe_orion is null or equipe_orion in ('apollo', 'kripto_hunters'));

create table if not exists public.equipe_metas (
  id uuid primary key default gen_random_uuid(),
  equipe text not null check (equipe in ('apollo', 'kripto_hunters')),
  mes text not null,
  meta_valor numeric not null default 0,
  prazo date not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (equipe, mes)
);

create table if not exists public.equipe_objetivos (
  id uuid primary key default gen_random_uuid(),
  equipe text not null check (equipe in ('apollo', 'kripto_hunters')),
  mes text not null,
  titulo text not null,
  valor_estimado numeric not null default 0,
  status text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'feito')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.equipe_pontos (
  id uuid primary key default gen_random_uuid(),
  equipe text not null check (equipe in ('apollo', 'kripto_hunters')),
  mes text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pontos integer not null check (pontos <> 0),
  motivo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.equipe_metas enable row level security;
alter table public.equipe_objetivos enable row level security;
alter table public.equipe_pontos enable row level security;

drop policy if exists equipe_metas_admin_all on public.equipe_metas;
create policy equipe_metas_admin_all on public.equipe_metas
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists equipe_metas_team_read on public.equipe_metas;
create policy equipe_metas_team_read on public.equipe_metas
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.equipe_orion = equipe_metas.equipe
  )
);

drop policy if exists equipe_objetivos_admin_all on public.equipe_objetivos;
create policy equipe_objetivos_admin_all on public.equipe_objetivos
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists equipe_objetivos_team_read on public.equipe_objetivos;
create policy equipe_objetivos_team_read on public.equipe_objetivos
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.equipe_orion = equipe_objetivos.equipe
  )
);

drop policy if exists equipe_pontos_admin_all on public.equipe_pontos;
create policy equipe_pontos_admin_all on public.equipe_pontos
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists equipe_pontos_team_read on public.equipe_pontos;
create policy equipe_pontos_team_read on public.equipe_pontos
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.equipe_orion = equipe_pontos.equipe
  )
);

insert into public.equipe_metas (equipe, mes, meta_valor, prazo)
values ('apollo', '2026-05', 50000, '2026-05-31')
on conflict (equipe, mes) do update
set meta_valor = excluded.meta_valor,
    prazo = excluded.prazo,
    updated_at = now();

insert into public.equipe_objetivos (equipe, mes, titulo, valor_estimado)
values
  ('apollo', '2026-05', 'Atual', 1500),
  ('apollo', '2026-05', 'Deltreggia', 1500),
  ('apollo', '2026-05', 'Inorave', 1100),
  ('apollo', '2026-05', 'BLM (TCV)', 5000),
  ('apollo', '2026-05', 'Inova Suprema (TCV)', 5000),
  ('apollo', '2026-05', 'Priorize', 1300),
  ('apollo', '2026-05', 'Ligamar', 10000)
on conflict do nothing;
