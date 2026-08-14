begin;

update public.profiles
set
  tipo_usuario = 'admin',
  is_admin_master = false,
  equipe_orion = 'apollo'
where id = '87ef1725-fc6c-43e5-be04-50ac481e49d5'
  and lower(coalesce(nome, '')) = 'lucas rodrigues';

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
  'tipo_usuario', 'admin',
  'cargo', 'Coordenador Operacional'
)
where id = '87ef1725-fc6c-43e5-be04-50ac481e49d5';

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = '87ef1725-fc6c-43e5-be04-50ac481e49d5'
      and tipo_usuario = 'admin'
      and is_admin_master = false
  ) then
    raise exception 'Nao foi possivel configurar Lucas Rodrigues como Coordenador Operacional.';
  end if;
end;
$$;

commit;
