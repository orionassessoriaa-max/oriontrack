-- Corretora em que a propria dona atende: a persona da IA e ela mesma, entao
-- nao existe especialista para quem repassar. Muda a abertura (sem "Me chamo X,
-- da X Corretora") e o encerramento (vira "vou montar seu estudo e te retorno").
alter table public.corretora_ai_configs
  add column if not exists atende_sozinho boolean not null default false;

comment on column public.corretora_ai_configs.atende_sozinho is
  'true quando a persona da IA e a propria responsavel pelo atendimento; desliga o repasse para especialista.';

-- Por enquanto vale so para a Roniele. As outras corretoras seguem repassando.
update public.corretora_ai_configs
set atende_sozinho = true,
    persona = 'Roniele',
    updated_at = now()
where corretora_id = (select id from public.corretoras where nome = 'RONIELE CORRETORA');

notify pgrst, 'reload schema';
