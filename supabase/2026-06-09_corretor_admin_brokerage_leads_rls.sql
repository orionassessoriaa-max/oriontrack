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
        (p.tipo_usuario = 'corretor' and p.corretor_id = leads.corretor_id)
        or (
          p.tipo_usuario = 'corretor_admin'
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
        (p.tipo_usuario = 'corretor' and p.corretor_id = leads.corretor_id)
        or (
          p.tipo_usuario = 'corretor_admin'
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
        (p.tipo_usuario = 'corretor' and p.corretor_id = leads.corretor_id)
        or (
          p.tipo_usuario = 'corretor_admin'
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
