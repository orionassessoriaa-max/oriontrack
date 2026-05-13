-- Orion Track RLS baseline
-- Apply in Supabase SQL editor after confirming table/column names in production.

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
as $$
  select p.tipo_usuario
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.current_profile_corretor_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select p.corretor_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'admin'
$$;

create or replace function public.is_gestor_trafego()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'gestor_trafego'
$$;

create or replace function public.is_corretor()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'corretor'
$$;

alter table public.profiles enable row level security;
alter table public.corretores enable row level security;
alter table public.leads enable row level security;
alter table public.solicitacoes_suporte enable row level security;
alter table public.relatorios_trafego enable row level security;

drop policy if exists "profiles_select_by_role" on public.profiles;
drop policy if exists "profiles_admin_write" on public.profiles;

create policy "profiles_select_by_role"
on public.profiles
for select
to authenticated
using (
  public.is_admin()
  or id = auth.uid()
  or (
    public.is_gestor_trafego()
    and tipo_usuario = 'corretor'
    and corretor_id in (
      select c.id
      from public.corretores c
      where c.gestor_trafego_id = auth.uid()
    )
  )
);

create policy "profiles_admin_write"
on public.profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "corretores_select_by_role" on public.corretores;
drop policy if exists "corretores_admin_write" on public.corretores;

create policy "corretores_select_by_role"
on public.corretores
for select
to authenticated
using (
  public.is_admin()
  or (public.is_corretor() and id = public.current_profile_corretor_id())
  or (public.is_gestor_trafego() and gestor_trafego_id = auth.uid())
);

create policy "corretores_admin_write"
on public.corretores
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "leads_select_by_role" on public.leads;
drop policy if exists "leads_insert_by_role" on public.leads;
drop policy if exists "leads_update_by_role" on public.leads;
drop policy if exists "leads_delete_admin" on public.leads;

create policy "leads_select_by_role"
on public.leads
for select
to authenticated
using (
  public.is_admin()
  or (public.is_corretor() and corretor_id = public.current_profile_corretor_id())
  or (
    public.is_gestor_trafego()
    and exists (
      select 1
      from public.corretores c
      where c.id = leads.corretor_id
        and c.gestor_trafego_id = auth.uid()
    )
  )
);

create policy "leads_insert_by_role"
on public.leads
for insert
to authenticated
with check (
  public.is_admin()
  or (public.is_corretor() and corretor_id = public.current_profile_corretor_id())
  or (
    public.is_gestor_trafego()
    and exists (
      select 1
      from public.corretores c
      where c.id = leads.corretor_id
        and c.gestor_trafego_id = auth.uid()
    )
  )
);

create policy "leads_update_by_role"
on public.leads
for update
to authenticated
using (
  public.is_admin()
  or (public.is_corretor() and corretor_id = public.current_profile_corretor_id())
  or (
    public.is_gestor_trafego()
    and exists (
      select 1
      from public.corretores c
      where c.id = leads.corretor_id
        and c.gestor_trafego_id = auth.uid()
    )
  )
)
with check (
  public.is_admin()
  or (public.is_corretor() and corretor_id = public.current_profile_corretor_id())
  or (
    public.is_gestor_trafego()
    and exists (
      select 1
      from public.corretores c
      where c.id = leads.corretor_id
        and c.gestor_trafego_id = auth.uid()
    )
  )
);

create policy "leads_delete_admin"
on public.leads
for delete
to authenticated
using (public.is_admin());

drop policy if exists "suporte_select_by_role" on public.solicitacoes_suporte;
drop policy if exists "suporte_insert_corretor" on public.solicitacoes_suporte;
drop policy if exists "suporte_update_admin" on public.solicitacoes_suporte;

create policy "suporte_select_by_role"
on public.solicitacoes_suporte
for select
to authenticated
using (
  public.is_admin()
  or (public.is_corretor() and corretor_id = public.current_profile_corretor_id())
  or (
    public.is_gestor_trafego()
    and exists (
      select 1
      from public.corretores c
      where c.id = solicitacoes_suporte.corretor_id
        and c.gestor_trafego_id = auth.uid()
    )
  )
);

create policy "suporte_insert_corretor"
on public.solicitacoes_suporte
for insert
to authenticated
with check (
  public.is_corretor()
  and corretor_id = public.current_profile_corretor_id()
);

create policy "suporte_update_admin"
on public.solicitacoes_suporte
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "relatorios_select_by_role" on public.relatorios_trafego;
drop policy if exists "relatorios_insert_gestor" on public.relatorios_trafego;
drop policy if exists "relatorios_update_by_role" on public.relatorios_trafego;
drop policy if exists "relatorios_delete_admin" on public.relatorios_trafego;

create policy "relatorios_select_by_role"
on public.relatorios_trafego
for select
to authenticated
using (
  public.is_admin()
  or (public.is_corretor() and corretor_id = public.current_profile_corretor_id())
  or (
    public.is_gestor_trafego()
    and gestor_id = auth.uid()
    and exists (
      select 1
      from public.corretores c
      where c.id = relatorios_trafego.corretor_id
        and c.gestor_trafego_id = auth.uid()
    )
  )
);

create policy "relatorios_insert_gestor"
on public.relatorios_trafego
for insert
to authenticated
with check (
  public.is_gestor_trafego()
  and gestor_id = auth.uid()
  and exists (
    select 1
    from public.corretores c
    where c.id = relatorios_trafego.corretor_id
      and c.gestor_trafego_id = auth.uid()
  )
);

create policy "relatorios_update_by_role"
on public.relatorios_trafego
for update
to authenticated
using (
  public.is_admin()
  or (
    public.is_gestor_trafego()
    and gestor_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or (
    public.is_gestor_trafego()
    and gestor_id = auth.uid()
  )
);

create policy "relatorios_delete_admin"
on public.relatorios_trafego
for delete
to authenticated
using (public.is_admin());
