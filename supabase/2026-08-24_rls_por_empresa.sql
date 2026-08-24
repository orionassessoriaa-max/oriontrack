-- Corretor da mesma empresa nao conseguia registrar nada pelo navegador.
--
-- A Fortis tem dois cadastros de corretor, Milena e Guilherme, e a tela mostra
-- os leads dos dois porque o app agrupa por nome_empresa. Mas as politicas de
-- lead_atividades e lead_tarefas comparavam com um unico corretor_id, o do
-- proprio perfil. Resultado: o Guilherme via 64 leads, e ao criar tarefa em
-- qualquer um dos 56 da Milena o banco respondia
-- "new row violates row-level security policy for table lead_atividades".
--
-- A troca de status dele funcionava porque passa por rota de servidor, com
-- chave de servico, que nao passa por RLS. Por isso o problema parecia
-- aleatorio.
create or replace function public.current_profile_corretor_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- Todos os cadastros de corretor da mesma empresa do perfil logado.
  select c.id
  from public.corretores c
  where c.nome_empresa is not null
    and c.nome_empresa = (
      select c2.nome_empresa
      from public.profiles p
      join public.corretores c2 on c2.id = p.corretor_id
      where p.id = auth.uid()
    )
  union
  select p.corretor_id
  from public.profiles p
  where p.id = auth.uid() and p.corretor_id is not null;
$$;

revoke all on function public.current_profile_corretor_ids() from public;
grant execute on function public.current_profile_corretor_ids() to authenticated, service_role;

drop policy if exists "crm_lead_atividades_select" on public.lead_atividades;
create policy "crm_lead_atividades_select" on public.lead_atividades
for select using (
  public.is_admin()
  or profile_id = auth.uid()
  or exists (
    select 1 from public.leads l
    where l.id = lead_atividades.lead_id
    and (
      l.corretor_id in (select public.current_profile_corretor_ids())
      or exists (
        select 1 from public.corretores c
        where c.id = l.corretor_id and c.gestor_trafego_id = auth.uid()
      )
    )
  )
);

drop policy if exists "crm_lead_atividades_insert" on public.lead_atividades;
create policy "crm_lead_atividades_insert" on public.lead_atividades
for insert with check (
  public.is_admin()
  or profile_id = auth.uid()
  or exists (
    select 1 from public.leads l
    where l.id = lead_atividades.lead_id
    and (
      l.corretor_id in (select public.current_profile_corretor_ids())
      or exists (
        select 1 from public.corretores c
        where c.id = l.corretor_id and c.gestor_trafego_id = auth.uid()
      )
    )
  )
);

drop policy if exists "crm_lead_tarefas_select" on public.lead_tarefas;
create policy "crm_lead_tarefas_select" on public.lead_tarefas
for select using (
  public.is_admin()
  or corretor_id in (select public.current_profile_corretor_ids())
  or responsavel_profile_id = auth.uid()
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id and c.gestor_trafego_id = auth.uid()
  )
);

drop policy if exists "crm_lead_tarefas_write" on public.lead_tarefas;
create policy "crm_lead_tarefas_write" on public.lead_tarefas
for all using (
  public.is_admin()
  or corretor_id in (select public.current_profile_corretor_ids())
  or responsavel_profile_id = auth.uid()
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id and c.gestor_trafego_id = auth.uid()
  )
) with check (
  public.is_admin()
  or corretor_id in (select public.current_profile_corretor_ids())
  or responsavel_profile_id = auth.uid()
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id and c.gestor_trafego_id = auth.uid()
  )
);

notify pgrst, 'reload schema';

-- Confere quantos cadastros de corretor cada empresa tem: onde houver mais de
-- um, a regra antiga estava barrando gente da propria casa.
select nome_empresa, count(*) as cadastros
from public.corretores
where nome_empresa is not null
group by nome_empresa
having count(*) > 1
order by 2 desc;
