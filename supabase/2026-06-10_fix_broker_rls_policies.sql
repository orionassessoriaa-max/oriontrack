-- Migration: Fix Broker RLS Policies for Shared Company (nome_empresa)
-- Target Tables: public.corretores, public.leads
-- Author: Antigravity

-- 1. Fix RLS on public.corretores to allow sibling brokers to find each other by sharing `nome_empresa`
drop policy if exists "corretores_select_by_role" on public.corretores;
create policy "corretores_select_by_role"
on public.corretores
for select
to authenticated
using (
  public.is_admin()
  or (
    public.current_profile_role() in ('corretor', 'corretor_admin', 'corretor_membro')
    and (
      id = public.current_profile_corretor_id()
      or (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and nullif(trim(p.nome_empresa), '') is not null
            and p.nome_empresa = corretores.nome_empresa
        )
      )
    )
  )
  or (public.is_gestor_trafego() and gestor_trafego_id = auth.uid())
);

-- 2. Fix RLS on public.leads (Select) to allow both 'corretor' and 'corretor_admin' to read shared brokerage leads
drop policy if exists "Corretores can read own leads" on public.leads;
create policy "Corretores can read own leads"
on public.leads
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    left join public.corretores own_corretor on own_corretor.id = p.corretor_id
    left join public.corretores lead_corretor on lead_corretor.id = leads.corretor_id
    where p.id = auth.uid()
      and (
        (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and (
            p.corretor_id = leads.corretor_id
            or (
              nullif(trim(own_corretor.nome_empresa), '') is not null
              and own_corretor.nome_empresa = lead_corretor.nome_empresa
            )
          )
        )
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
);

-- 3. Fix RLS on public.leads (Update) to allow both 'corretor' and 'corretor_admin' to update shared brokerage leads
drop policy if exists "Corretores can update own leads" on public.leads;
create policy "Corretores can update own leads"
on public.leads
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    left join public.corretores own_corretor on own_corretor.id = p.corretor_id
    left join public.corretores lead_corretor on lead_corretor.id = leads.corretor_id
    where p.id = auth.uid()
      and (
        (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and (
            p.corretor_id = leads.corretor_id
            or (
              nullif(trim(own_corretor.nome_empresa), '') is not null
              and own_corretor.nome_empresa = lead_corretor.nome_empresa
            )
          )
        )
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    left join public.corretores own_corretor on own_corretor.id = p.corretor_id
    left join public.corretores lead_corretor on lead_corretor.id = leads.corretor_id
    where p.id = auth.uid()
      and (
        (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and (
            p.corretor_id = leads.corretor_id
            or (
              nullif(trim(own_corretor.nome_empresa), '') is not null
              and own_corretor.nome_empresa = lead_corretor.nome_empresa
            )
          )
        )
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
);
