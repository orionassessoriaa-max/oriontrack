-- Corrige o acesso do integrante criado para o Kripto Hunters.
-- Pode ser executado mais de uma vez.
update public.profiles
set equipe_orion = 'kripto_hunters'
where lower(trim(nome)) = lower('Renan Barreto')
  and tipo_usuario = 'corretor_membro';

insert into public.comercial_membros (profile_id, papel, ativo, updated_at)
select p.id, 'sdr', true, now()
from public.profiles p
where lower(trim(p.nome)) = lower('Renan Barreto')
  and p.tipo_usuario = 'corretor_membro'
on conflict (profile_id) do update
set papel = excluded.papel,
    ativo = true,
    updated_at = now();
