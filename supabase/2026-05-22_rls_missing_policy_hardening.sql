-- Materials: authenticated users can read active materials; admins manage all.
drop policy if exists materiais_admin_all on public.materiais;
drop policy if exists materiais_authenticated_read_active on public.materiais;
create policy materiais_admin_all on public.materiais
for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'));
create policy materiais_authenticated_read_active on public.materiais
for select to authenticated
using (coalesce(status, 'ativo') in ('ativo', 'active', 'Ativo'));

-- Broker pages: public can read active capture pages; admins manage; broker can read own page.
drop policy if exists paginas_corretores_public_read_active on public.paginas_corretores;
drop policy if exists paginas_corretores_admin_all on public.paginas_corretores;
drop policy if exists paginas_corretores_corretor_read_own on public.paginas_corretores;
create policy paginas_corretores_public_read_active on public.paginas_corretores
for select to anon, authenticated
using (coalesce(status, 'ativa') in ('ativa', 'ativo', 'active', 'Ativo'));
create policy paginas_corretores_admin_all on public.paginas_corretores
for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'));
create policy paginas_corretores_corretor_read_own on public.paginas_corretores
for select to authenticated
using (corretor_id = (select p.corretor_id from public.profiles p where p.id = (select auth.uid())));

-- Traffic reports: admins see all; managers see linked brokers; brokers see own reports.
drop policy if exists relatorios_trafego_admin_all on public.relatorios_trafego;
drop policy if exists relatorios_trafego_gestor_linked on public.relatorios_trafego;
drop policy if exists relatorios_trafego_corretor_own on public.relatorios_trafego;
create policy relatorios_trafego_admin_all on public.relatorios_trafego
for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'));
create policy relatorios_trafego_gestor_linked on public.relatorios_trafego
for all to authenticated
using (
  gestor_id = (select auth.uid())
  or exists (
    select 1 from public.corretores c
    where c.id = relatorios_trafego.corretor_id
      and c.gestor_trafego_id = (select auth.uid())
  )
)
with check (
  gestor_id = (select auth.uid())
  or exists (
    select 1 from public.corretores c
    where c.id = relatorios_trafego.corretor_id
      and c.gestor_trafego_id = (select auth.uid())
  )
);
create policy relatorios_trafego_corretor_own on public.relatorios_trafego
for select to authenticated
using (corretor_id = (select p.corretor_id from public.profiles p where p.id = (select auth.uid())));

-- Support requests: admins manage; requester can create and read own requests.
drop policy if exists solicitacoes_suporte_admin_all on public.solicitacoes_suporte;
drop policy if exists solicitacoes_suporte_user_own on public.solicitacoes_suporte;
drop policy if exists solicitacoes_suporte_user_insert on public.solicitacoes_suporte;
create policy solicitacoes_suporte_admin_all on public.solicitacoes_suporte
for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'));
create policy solicitacoes_suporte_user_own on public.solicitacoes_suporte
for select to authenticated
using (solicitante_profile_id = (select auth.uid()) or corretor_id = (select p.corretor_id from public.profiles p where p.id = (select auth.uid())));
create policy solicitacoes_suporte_user_insert on public.solicitacoes_suporte
for insert to authenticated
with check (solicitante_profile_id = (select auth.uid()));

create index if not exists paginas_corretores_corretor_id_idx on public.paginas_corretores (corretor_id);
create index if not exists relatorios_trafego_corretor_id_idx on public.relatorios_trafego (corretor_id);
create index if not exists relatorios_trafego_gestor_id_idx on public.relatorios_trafego (gestor_id);
create index if not exists solicitacoes_suporte_corretor_id_idx on public.solicitacoes_suporte (corretor_id);
create index if not exists solicitacoes_suporte_solicitante_profile_id_idx on public.solicitacoes_suporte (solicitante_profile_id);
