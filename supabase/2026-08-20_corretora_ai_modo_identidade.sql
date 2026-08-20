-- Como a IA se apresenta em cada concessionaria.
--
--   equipe        : marca que nao e pessoa. "Me chamo Aline, da Octavita Corretora."
--   equipe_pessoa : corretora com nome de gente e assistente atendendo.
--                   "Me chamo Aline, faco parte da equipe da Michele."
--   propria       : a propria corretora atende. "Aqui e a Roniele."
--
-- O encerramento acompanha o modo: equipe promete um especialista,
-- equipe_pessoa promete a pessoa pelo nome e propria promete o estudo.
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
-- de comportamento no meio do caminho.
update public.corretora_ai_configs
set modo_identidade = 'propria'
where atende_sozinho = true and modo_identidade <> 'propria';

update public.corretora_ai_configs
set nome_exibicao = 'Roniele'
where nome_exibicao is null
  and corretora_id = (select id from public.corretoras where nome = 'RONIELE CORRETORA');

notify pgrst, 'reload schema';
