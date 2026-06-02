create or replace function public.is_corretor()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_profile_role() in ('corretor', 'corretor_admin')
$$;

drop policy if exists "Corretores can read own leads" on public.leads;
create policy "Corretores can read own leads"
on public.leads
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        (p.tipo_usuario in ('corretor', 'corretor_admin') and p.corretor_id = leads.corretor_id)
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
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        (p.tipo_usuario in ('corretor', 'corretor_admin') and p.corretor_id = leads.corretor_id)
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        (p.tipo_usuario in ('corretor', 'corretor_admin') and p.corretor_id = leads.corretor_id)
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
);
