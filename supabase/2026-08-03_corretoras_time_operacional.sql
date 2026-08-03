alter table public.corretoras
  add column if not exists time_operacional jsonb not null default '[]'::jsonb,
  add column if not exists gestor_trafego_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_corretoras_gestor_trafego_id
  on public.corretoras(gestor_trafego_id);

update public.corretoras cr
set
  time_operacional = coalesce((
    select c.time_operacional
    from public.corretores c
    where lower(trim(c.nome_empresa)) = lower(trim(cr.nome))
    order by c.created_at asc
    limit 1
  ), '[]'::jsonb),
  gestor_trafego_id = (
    select c.gestor_trafego_id
    from public.corretores c
    where lower(trim(c.nome_empresa)) = lower(trim(cr.nome))
    order by c.created_at asc
    limit 1
  ),
  updated_at = now()
where
  (cr.time_operacional = '[]'::jsonb or cr.time_operacional is null)
  and exists (
    select 1
    from public.corretores c
    where lower(trim(c.nome_empresa)) = lower(trim(cr.nome))
      and (c.time_operacional is not null or c.gestor_trafego_id is not null)
  );
