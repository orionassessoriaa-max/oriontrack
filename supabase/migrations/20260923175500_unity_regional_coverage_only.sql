-- A Unity comercializa somente planos regionais. O prompt antigo oferecia
-- cobertura nacional e fazia a ISA confirmar uma opcao inexistente.
update public.corretora_ai_configs
set
  system_prompt = replace(
    replace(
      replace(system_prompt, E'- Cobertura nacional ou regional?\n', ''),
      'cnpj para um plano sulamerica nacional para minhas 3 filhas mantendo o hospital einstein',
      'cnpj para um plano regional para minhas 3 filhas mantendo o hospital de preferencia'
    ),
    'Vou cotar no CNPJ para suas 3 filhas, mantendo o Einstein - isso mesmo, certo?',
    'Vou cotar no CNPJ para suas 3 filhas, mantendo o hospital de preferencia - isso mesmo, certo?'
  ) || E'\n\n== REGRA EXCLUSIVA DE COBERTURA DA UNITY ==\n'
    || E'- A Unity trabalha somente com planos de cobertura regional.\n'
    || E'- Nunca ofereca, pergunte ou confirme cobertura nacional.\n'
    || E'- Se o cliente pedir cobertura nacional, explique que a Unity trabalha com cobertura regional e continue a qualificacao nessa modalidade.\n'
    || E'- Leia o historico e nunca repita uma pergunta ja respondida nem envie a mesma mensagem duas vezes.',
  updated_at = now()
where corretora_id = '8923837e-36e9-4eb6-888a-1f4cf2ca42ac'
  and system_prompt not like '%REGRA EXCLUSIVA DE COBERTURA DA UNITY%';
