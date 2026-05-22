-- Keep authenticated execution for RLS compatibility, but block anonymous RPC access to helper functions.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'current_profile_role') then
    revoke execute on function public.current_profile_role() from public, anon;
    grant execute on function public.current_profile_role() to authenticated;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'current_profile_corretor_id') then
    revoke execute on function public.current_profile_corretor_id() from public, anon;
    grant execute on function public.current_profile_corretor_id() to authenticated;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'current_user_tipo_usuario') then
    revoke execute on function public.current_user_tipo_usuario() from public, anon;
    grant execute on function public.current_user_tipo_usuario() to authenticated;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_admin') then
    revoke execute on function public.is_admin() from public, anon;
    grant execute on function public.is_admin() to authenticated;
  end if;
end $$;
