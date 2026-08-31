-- Tira o dono fixo do nivel S.
--
-- O S caia direto para o Leo. Agora todo lead entra na fila comum, sem dono, e
-- quem apertar Start primeiro fica com ele, inclusive o Leo. A regra do Start
-- continua igual para todo mundo.
update public.comercial_membros
set recebe_apenas_mql = null
where recebe_apenas_mql is not null;

select p.nome, m.papel, m.ativo, m.recebe_apenas_mql
from public.comercial_membros m
join public.profiles p on p.id = m.profile_id
order by m.papel, p.nome;
