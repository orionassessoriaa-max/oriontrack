-- Coordenador que acompanha o time sem receber cada lead no WhatsApp.
--
-- A notificacao de lead novo ia para todos os coordenadores do Kripto, e o
-- envio ignora a preferencia individual de proposito (lead novo nao pode
-- depender de alguem ter ligado o aviso). Por isso a excecao vive aqui, na
-- ficha do membro.
alter table public.comercial_membros
  add column if not exists recebe_notificacoes boolean not null default true;

comment on column public.comercial_membros.recebe_notificacoes is
  'false tira o membro dos avisos de lead novo, sem tirar o acesso ao comercial.';

-- Patrick continua coordenador e enxerga tudo; quem responde pelos leads do
-- Kripto no WhatsApp e o Pedro.
update public.comercial_membros
set recebe_notificacoes = false
where profile_id = '3270edab-cf01-4740-a9e3-98715096cbf3';

notify pgrst, 'reload schema';

select p.nome, m.papel, m.ativo, m.recebe_notificacoes
from public.comercial_membros m
join public.profiles p on p.id = m.profile_id
order by m.papel, p.nome;
