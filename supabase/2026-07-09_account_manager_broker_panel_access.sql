-- Allow account managers to inspect broker operational panels.
-- This fixes the "Visualizar painel" flow: the UI impersonates the broker
-- profile, but the Supabase JWT is still the account manager user.

drop policy if exists "account_manager_read_broker_leads" on public.leads;
create policy "account_manager_read_broker_leads"
on public.leads
for select
to authenticated
using (public.current_profile_role() = 'account_manager');

drop policy if exists "account_manager_update_broker_leads" on public.leads;
create policy "account_manager_update_broker_leads"
on public.leads
for update
to authenticated
using (public.current_profile_role() = 'account_manager')
with check (public.current_profile_role() = 'account_manager');

drop policy if exists "account_manager_read_lead_atividades" on public.lead_atividades;
create policy "account_manager_read_lead_atividades"
on public.lead_atividades
for select
to authenticated
using (public.current_profile_role() = 'account_manager');

drop policy if exists "account_manager_insert_lead_atividades" on public.lead_atividades;
create policy "account_manager_insert_lead_atividades"
on public.lead_atividades
for insert
to authenticated
with check (public.current_profile_role() = 'account_manager');

drop policy if exists "account_manager_read_lead_tarefas" on public.lead_tarefas;
create policy "account_manager_read_lead_tarefas"
on public.lead_tarefas
for select
to authenticated
using (public.current_profile_role() = 'account_manager');

drop policy if exists "account_manager_write_lead_tarefas" on public.lead_tarefas;
create policy "account_manager_write_lead_tarefas"
on public.lead_tarefas
for all
to authenticated
using (public.current_profile_role() = 'account_manager')
with check (public.current_profile_role() = 'account_manager');

drop policy if exists "account_manager_read_whatsapp_conversas" on public.whatsapp_conversas;
create policy "account_manager_read_whatsapp_conversas"
on public.whatsapp_conversas
for select
to authenticated
using (public.current_profile_role() = 'account_manager');

drop policy if exists "account_manager_read_whatsapp_mensagens" on public.whatsapp_mensagens;
create policy "account_manager_read_whatsapp_mensagens"
on public.whatsapp_mensagens
for select
to authenticated
using (
  public.current_profile_role() = 'account_manager'
  and exists (
    select 1
    from public.whatsapp_conversas wc
    where wc.id = whatsapp_mensagens.conversa_id
  )
);
