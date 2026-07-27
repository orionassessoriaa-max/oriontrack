-- Impede que a IA pressione o lead depois de uma recusa de ligacao/reuniao.
-- Pode ser executada mais de uma vez.

update public.comercial_config
set ia_sdr_prompt = concat(
  coalesce(ia_sdr_prompt, ''),
  E'\n\n== RECUSA DE LIGACAO OU REUNIAO ==\n',
  E'Se o lead disser que nao quer ligacao ou reuniao, que prefere continuar por mensagem ou responder "ligacao nao": aceite sem insistir. Nao peca outro horario, nao repita o convite e nao tente convencer. Diga de forma acolhedora que esta tudo bem continuar por aqui e que um especialista da equipe vai entrar em contato por outro numero para prosseguir com o atendimento. Defina handoff como true e nao faca outra pergunta.'
),
updated_at = now()
where id = 1
  and coalesce(ia_sdr_prompt, '') not like '%RECUSA DE LIGACAO OU REUNIAO%';

notify pgrst, 'reload schema';
