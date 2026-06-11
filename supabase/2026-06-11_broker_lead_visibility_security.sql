-- Reforca a leitura segura dos leads por corretor/concessionaria.
-- Corrige casos em que o profile esta vinculado ao corretor, mas a tela nao
-- consegue montar o escopo por nome_empresa via RLS.

update public.profiles p
set nome_empresa = c.nome_empresa
from public.corretores c
where p.corretor_id = c.id
  and nullif(trim(c.nome_empresa), '') is not null
  and coalesce(nullif(trim(p.nome_empresa), ''), '') is distinct from c.nome_empresa;

drop policy if exists "corretores_select_by_role" on public.corretores;
create policy "corretores_select_by_role"
on public.corretores
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    left join public.corretores own_corretor on own_corretor.id = p.corretor_id
    where p.id = auth.uid()
      and (
        p.tipo_usuario = 'admin'
        or (
          p.tipo_usuario in ('corretor', 'corretor_admin', 'corretor_membro')
          and (
            corretores.id = p.corretor_id
            or (
              nullif(trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')), '') is not null
              and trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')) = trim(coalesce(corretores.nome_empresa, ''))
            )
          )
        )
        or (
          p.tipo_usuario = 'gestor_trafego'
          and corretores.gestor_trafego_id = p.id
        )
        or p.tipo_usuario = 'account_manager'
      )
  )
);

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
              nullif(trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')), '') is not null
              and trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')) = trim(coalesce(lead_corretor.nome_empresa, ''))
            )
          )
        )
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
);

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
              nullif(trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')), '') is not null
              and trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')) = trim(coalesce(lead_corretor.nome_empresa, ''))
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
              nullif(trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')), '') is not null
              and trim(coalesce(p.nome_empresa, own_corretor.nome_empresa, '')) = trim(coalesce(lead_corretor.nome_empresa, ''))
            )
          )
        )
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
);
