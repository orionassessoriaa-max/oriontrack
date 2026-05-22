-- Close public writes to audit logs. Server-side service role bypasses RLS and can still insert.
drop policy if exists "server can write audit logs" on public.audit_logs;
drop policy if exists audit_logs_service_insert on public.audit_logs;

-- Internal trigger/helper functions should not be callable through public RPC.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'assign_lead_to_corretor_team_member') then
    revoke execute on function public.assign_lead_to_corretor_team_member() from public, anon, authenticated;
    alter function public.assign_lead_to_corretor_team_member() set search_path = public;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
    alter function public.rls_auto_enable() set search_path = public;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'touch_updated_at') then
    alter function public.touch_updated_at() set search_path = public;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_gestor_trafego_from_time') then
    alter function public.set_gestor_trafego_from_time() set search_path = public;
  end if;
end $$;

-- Cover foreign keys used by dashboards, inbox, creatives and team distribution.
create index if not exists account_interacoes_corretor_id_idx on public.account_interacoes (corretor_id);
create index if not exists corretor_time_membros_corretor_id_idx on public.corretor_time_membros (corretor_id);
create index if not exists criativo_assets_demanda_id_idx on public.criativo_assets (demanda_id);
create index if not exists criativo_assets_enviado_por_profile_id_idx on public.criativo_assets (enviado_por_profile_id);
create index if not exists criativo_demandas_responsavel_profile_id_idx on public.criativo_demandas (responsavel_profile_id);
create index if not exists criativo_demandas_solicitante_profile_id_idx on public.criativo_demandas (solicitante_profile_id);
create index if not exists lead_atividades_profile_id_idx on public.lead_atividades (profile_id);
create index if not exists lead_tarefas_corretor_id_idx on public.lead_tarefas (corretor_id);
create index if not exists whatsapp_conversas_lead_id_idx on public.whatsapp_conversas (lead_id);
