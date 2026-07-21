-- Libera o acesso comercial do Patrick como coordenador.
-- Localiza o perfil existente pelo nome ou e-mail; nao cria outro usuario.
insert into public.comercial_membros (profile_id, papel, ativo, updated_at)
select p.id, 'coordenador', true, now()
from public.profiles p
where lower(coalesce(p.nome, '')) like '%patrick%'
   or lower(coalesce(p.email, '')) like '%patrick%'
   or lower(coalesce(p.email_real, '')) like '%patrick%'
on conflict (profile_id) do update
set papel = 'coordenador', ativo = true, updated_at = now();
