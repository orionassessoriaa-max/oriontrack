-- O vendedor operacional trabalha somente com leads atribuidos ao proprio
-- perfil. A regra fica no banco para impedir acesso por REST, URL ou console.
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
              and lower(public.current_profile_brokerage_name()) = lower(nullif(trim(coalesce(lead_corretor.nome_empresa, '')), ''))
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

drop policy if exists "crm_whatsapp_conversas_select" on public.whatsapp_conversas;
create policy "crm_whatsapp_conversas_select" on public.whatsapp_conversas
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and whatsapp_conversas.corretor_id = public.current_profile_corretor_id()
        )
        or (
          p.tipo_usuario = 'corretor_membro'
          and exists (
            select 1
            from public.leads l
            where l.id = whatsapp_conversas.lead_id
              and l.responsavel_profile_id = p.id
          )
        )
      )
  )
  or exists (
    select 1 from public.corretores c
    where c.id = whatsapp_conversas.corretor_id
      and c.gestor_trafego_id = auth.uid()
  )
);

drop policy if exists "crm_whatsapp_mensagens_select" on public.whatsapp_mensagens;
create policy "crm_whatsapp_mensagens_select" on public.whatsapp_mensagens
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.whatsapp_conversas wc
    join public.profiles p on p.id = auth.uid()
    where wc.id = whatsapp_mensagens.conversa_id
      and (
        (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and wc.corretor_id = public.current_profile_corretor_id()
        )
        or (
          p.tipo_usuario = 'corretor_membro'
          and exists (
            select 1
            from public.leads l
            where l.id = wc.lead_id
              and l.responsavel_profile_id = p.id
          )
        )
        or exists (
          select 1 from public.corretores c
          where c.id = wc.corretor_id
            and c.gestor_trafego_id = auth.uid()
        )
      )
  )
);

drop policy if exists "crm_lead_atividades_select" on public.lead_atividades;
create policy "crm_lead_atividades_select" on public.lead_atividades
for select to authenticated
using (
  exists (
    select 1 from public.leads l
    where l.id = lead_atividades.lead_id
      and public.current_user_can_access_lead(l.corretor_id, l.responsavel_profile_id)
  )
  or exists (
    select 1 from public.leads l
    join public.corretores c on c.id = l.corretor_id
    where l.id = lead_atividades.lead_id
      and c.gestor_trafego_id = auth.uid()
  )
);

drop policy if exists "crm_lead_atividades_insert" on public.lead_atividades;
create policy "crm_lead_atividades_insert" on public.lead_atividades
for insert to authenticated
with check (
  exists (
    select 1 from public.leads l
    where l.id = lead_atividades.lead_id
      and public.current_user_can_access_lead(l.corretor_id, l.responsavel_profile_id)
  )
  or exists (
    select 1 from public.leads l
    join public.corretores c on c.id = l.corretor_id
    where l.id = lead_atividades.lead_id
      and c.gestor_trafego_id = auth.uid()
  )
);

drop policy if exists "crm_lead_tarefas_select" on public.lead_tarefas;
create policy "crm_lead_tarefas_select" on public.lead_tarefas
for select to authenticated
using (
  exists (
    select 1 from public.leads l
    where l.id = lead_tarefas.lead_id
      and public.current_user_can_access_lead(l.corretor_id, l.responsavel_profile_id)
  )
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id
      and c.gestor_trafego_id = auth.uid()
  )
);

drop policy if exists "crm_lead_tarefas_write" on public.lead_tarefas;
create policy "crm_lead_tarefas_write" on public.lead_tarefas
for all to authenticated
using (
  exists (
    select 1 from public.leads l
    where l.id = lead_tarefas.lead_id
      and public.current_user_can_access_lead(l.corretor_id, l.responsavel_profile_id)
  )
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id
      and c.gestor_trafego_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.leads l
    where l.id = lead_tarefas.lead_id
      and public.current_user_can_access_lead(l.corretor_id, l.responsavel_profile_id)
  )
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id
      and c.gestor_trafego_id = auth.uid()
  )
);

notify pgrst, 'reload schema';
