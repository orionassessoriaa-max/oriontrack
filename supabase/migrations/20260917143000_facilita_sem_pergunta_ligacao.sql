-- A Facilita nao quer que a IA ofereca nem pergunte disponibilidade para
-- ligacao. A regra e exclusiva desta corretora e nao altera os demais prompts.
update public.corretora_ai_configs as config
set system_prompt =
      replace(
        replace(
          config.system_prompt,
          'Sua missao e confirmar o interesse, coletar as informacoes essenciais pendentes e agendar uma ligacao rapida de 15 minutos.',
          'Sua missao e confirmar o interesse, coletar as informacoes essenciais pendentes e encaminhar o atendimento para continuidade.'
        ),
        '- Agendamento de ligacao rapida de 15 minutos: peca dia e horario especificos.',
        ''
      ) || E'\n\n== REGRA EXCLUSIVA FACILITA: SEM LIGACAO ==\n'
      || '- Nunca ofereca ligacao, reuniao ou chamada.' || E'\n'
      || '- Nunca pergunte dia, horario ou disponibilidade para ligacao.' || E'\n'
      || '- Ao terminar a coleta, encerre sem nova pergunta, defina "handoff": true e informe apenas que o atendimento sera encaminhado para continuidade.',
    updated_at = now()
from public.corretoras as corretora
where config.corretora_id = corretora.id
  and lower(corretora.nome) like '%facilita%'
  and config.system_prompt not like '%REGRA EXCLUSIVA FACILITA: SEM LIGACAO%';

select count(*) as configs_facilita_sem_ligacao
from public.corretora_ai_configs as config
join public.corretoras as corretora on corretora.id = config.corretora_id
where lower(corretora.nome) like '%facilita%'
  and config.system_prompt like '%REGRA EXCLUSIVA FACILITA: SEM LIGACAO%';

notify pgrst, 'reload schema';

-- Rollback manual: restaurar o system_prompt anterior da Facilita a partir do
-- historico/versionamento do prompt. Nao ha rollback automatico para evitar
-- apagar outras alteracoes de texto feitas depois desta migration.
