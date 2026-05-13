alter table public.corretores
  add column if not exists facebook_login text,
  add column if not exists facebook_senha text,
  add column if not exists operadoras_info jsonb not null default '{}'::jsonb,
  add column if not exists regioes_campanha text,
  add column if not exists onboarding_status text not null default 'pendente'
    check (onboarding_status in ('pendente', 'dados_completos', 'campanhas_ativas')),
  add column if not exists campanhas_ativas boolean not null default false;

drop policy if exists "Corretores can update own leads" on public.leads;
create policy "Corretores can update own leads"
on public.leads
for update
using (
  corretor_id = (
    select profiles.corretor_id
    from public.profiles
    where profiles.id = auth.uid()
  )
)
with check (
  corretor_id = (
    select profiles.corretor_id
    from public.profiles
    where profiles.id = auth.uid()
  )
);

drop policy if exists "Admins can update all leads" on public.leads;
create policy "Admins can update all leads"
on public.leads
for update
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.tipo_usuario = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.tipo_usuario = 'admin'
  )
);

drop policy if exists "Gestores can read linked corretores" on public.corretores;
create policy "Gestores can read linked corretores"
on public.corretores
for select
using (
  gestor_trafego_id = auth.uid()
);

drop policy if exists "Gestores can update linked corretores onboarding" on public.corretores;
create policy "Gestores can update linked corretores onboarding"
on public.corretores
for update
using (
  gestor_trafego_id = auth.uid()
)
with check (
  gestor_trafego_id = auth.uid()
);
