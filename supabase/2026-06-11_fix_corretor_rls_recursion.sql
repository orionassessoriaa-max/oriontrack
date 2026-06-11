-- Corrige recursao infinita na policy de corretores.
-- A policy anterior consultava public.corretores dentro da propria policy de
-- public.corretores. As funcoes security definer abaixo calculam o escopo do
-- usuario sem reaplicar RLS da tabela alvo.

create or replace function public.current_profile_brokerage_name()
returns text
language sql
security definer
set search_path = public
as $$
  select nullif(trim(coalesce(p.nome_empresa, c.nome_empresa, '')), '')
  from public.profiles p
  left join public.corretores c on c.id = p.corretor_id
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.current_user_can_access_corretor(
  target_corretor_id uuid,
  target_nome_empresa text,
  target_gestor_trafego_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.tipo_usuario = 'admin'
        or p.tipo_usuario = 'account_manager'
        or (
          p.tipo_usuario = 'gestor_trafego'
          and target_gestor_trafego_id = p.id
        )
        or (
          p.tipo_usuario in ('corretor', 'corretor_admin', 'corretor_membro')
          and (
            target_corretor_id = p.corretor_id
            or (
              public.current_profile_brokerage_name() is not null
              and public.current_profile_brokerage_name() = nullif(trim(coalesce(target_nome_empresa, '')), '')
            )
          )
        )
      )
  )
$$;

create or replace function public.current_user_can_access_lead(
  target_corretor_id uuid,
  target_responsavel_profile_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.corretores lead_corretor on lead_corretor.id = target_corretor_id
    where p.id = auth.uid()
      and (
        p.tipo_usuario = 'admin'
        or (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and (
            target_corretor_id = p.corretor_id
            or (
              public.current_profile_brokerage_name() is not null
              and public.current_profile_brokerage_name() = nullif(trim(coalesce(lead_corretor.nome_empresa, '')), '')
            )
          )
        )
        or (
          p.tipo_usuario = 'corretor_membro'
          and target_responsavel_profile_id = p.id
        )
      )
  )
$$;

drop policy if exists "corretores_select_by_role" on public.corretores;
create policy "corretores_select_by_role"
on public.corretores
for select
to authenticated
using (
  public.current_user_can_access_corretor(corretores.id, corretores.nome_empresa, corretores.gestor_trafego_id)
);

drop policy if exists "Corretores can read own leads" on public.leads;
create policy "Corretores can read own leads"
on public.leads
for select
to authenticated
using (
  public.current_user_can_access_lead(leads.corretor_id, leads.responsavel_profile_id)
);

drop policy if exists "Corretores can update own leads" on public.leads;
create policy "Corretores can update own leads"
on public.leads
for update
to authenticated
using (
  public.current_user_can_access_lead(leads.corretor_id, leads.responsavel_profile_id)
)
with check (
  public.current_user_can_access_lead(leads.corretor_id, leads.responsavel_profile_id)
);
