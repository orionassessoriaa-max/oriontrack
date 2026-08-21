-- A tela de IA esta com o erro "Could not find the 'modo_identidade' column"
-- porque a migration de 20/08 nunca rodou. Este arquivo cria as colunas e ja
-- deixa a SOMA CORRETORA configurada do jeito combinado: quem atende e a
-- propria Rafaela, pelo WhatsApp dela.
--
-- Modo propria muda duas coisas no atendimento:
--   abertura     -> "Aqui e a Rafaela, da Soma."
--   encerramento -> "vou montar seu estudo e te retorno", sem prometer
--                   especialista nem falar em outro numero.
alter table public.corretora_ai_configs
  add column if not exists modo_identidade text not null default 'equipe',
  add column if not exists nome_exibicao text;

alter table public.corretora_ai_configs
  drop constraint if exists corretora_ai_configs_modo_identidade_check;

alter table public.corretora_ai_configs
  add constraint corretora_ai_configs_modo_identidade_check
  check (modo_identidade in ('equipe', 'equipe_pessoa', 'propria'));

comment on column public.corretora_ai_configs.modo_identidade is
  'Como a IA se apresenta: equipe, equipe_pessoa ou propria.';
comment on column public.corretora_ai_configs.nome_exibicao is
  'Nome que o cliente le na conversa. Sem isso a IA usa o nome da concessionaria, que costuma estar em caixa alta.';

-- Quem ja estava marcado como "atende sozinho" vira modo propria, sem mudanca
-- de comportamento no meio do caminho (caso da Roniele).
update public.corretora_ai_configs
set modo_identidade = 'propria'
where atende_sozinho = true and modo_identidade <> 'propria';

update public.corretora_ai_configs
set nome_exibicao = 'Roniele'
where nome_exibicao is null
  and corretora_id = (select id from public.corretoras where nome = 'RONIELE CORRETORA');

-- SOMA: a Rafaela atende como ela mesma, pelo WhatsApp dela.
-- sender_mode volta para 'profile' porque a instancia dedicada
-- (orion_ai_af16f182...) deixa de ser usada.
update public.corretora_ai_configs
set persona = 'Rafaela',
    modo_identidade = 'propria',
    nome_exibicao = 'Rafaela',
    atende_sozinho = true,
    sender_mode = 'profile',
    sender_profile_id = 'f1ac775f-5778-4c66-847d-cd183623517b',
    dedicated_instance_name = null,
    updated_at = now()
where corretora_id = (select id from public.corretoras where nome = 'SOMA CORRETORA');

notify pgrst, 'reload schema';

select c.nome,
       a.persona,
       a.modo_identidade,
       a.nome_exibicao,
       a.sender_mode,
       a.status
from public.corretora_ai_configs a
join public.corretoras c on c.id = a.corretora_id
order by c.nome;
