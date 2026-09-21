-- A Unity opera com um unico WhatsApp, administrado pelo perfil principal.
-- A validacao impede que um ID de outra corretora seja associado por engano.
do $$
declare
  unity_corretor_id uuid := 'a861c65e-e124-48ba-b578-5b23c59a8b94';
  unity_whatsapp_owner_id uuid := '8013d773-445e-40ff-86bf-5c37c3faf250';
  owner_is_valid boolean;
begin
  select exists (
    select 1
    from public.profiles
    where id = unity_whatsapp_owner_id
      and corretor_id = unity_corretor_id
      and tipo_usuario in ('corretor', 'corretor_admin')
      and status in ('active', 'ativo', 'Ativo')
  ) into owner_is_valid;

  if not owner_is_valid then
    raise exception 'O perfil principal da Unity nao esta ativo ou nao pertence a corretora esperada.';
  end if;

  update public.corretores
  set atendimento_compartilhado = true,
      numero_compartilhado_profile_id = unity_whatsapp_owner_id,
      updated_at = now()
  where id = unity_corretor_id;

  if not found then
    raise exception 'A corretora Unity nao foi encontrada.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
