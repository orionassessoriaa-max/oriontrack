do $$
begin
  if to_regclass('public.corretora_bot_configs') is not null then
    alter table public.corretora_bot_configs
      alter column status set default 'inativo';

    update public.corretora_bot_configs
    set status = 'inativo',
        updated_at = now()
    where status = 'ativo';
  end if;
end $$;

notify pgrst, 'reload schema';
