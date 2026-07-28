-- Leonardo Cruz e corretor operacional, nao integrante do Comercial/Kripto.
-- Remove somente o vinculo da equipe; o perfil e os dados da operacao permanecem intactos.
delete from public.comercial_membros cm
using public.profiles p
where p.id = cm.profile_id
  and (
    lower(trim(coalesce(p.nome, ''))) = 'leonardo cruz'
    or lower(trim(coalesce(p.email_real, p.email, ''))) = 'leonardocruz@orion.com'
  );
