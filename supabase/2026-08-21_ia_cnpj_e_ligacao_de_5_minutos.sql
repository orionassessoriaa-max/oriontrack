-- Pedidos do Danilo, audio de 21/08:
--
-- 1. Parar de pedir e-mail para enviar a proposta. O que serve para cotar no
--    portal e o numero do CNPJ.
-- 2. Nunca dizer que a ligacao dura 15 minutos. Quinze minutos assusta; a
--    ligacao passa a ser de 5 minutos.
--
-- Os 15 minutos da regra de inatividade continuam intactos: aquilo e o tempo
-- que o Orion Track espera o lead responder, nao a duracao da ligacao.
update public.corretora_ai_configs
set system_prompt = replace(
      replace(
        replace(
          replace(
            replace(system_prompt,
              '- E-mail para envio da proposta.',
              '- Numero do CNPJ, quando o cliente for cotar como empresa: e com ele que a cotacao e feita no portal. Nunca peca e-mail.'),
            '*Email*: [email]',
            '*CNPJ informado*: [numero do CNPJ, se o cliente passou]'),
          '(investimento, email, ou agendamento)',
          '(investimento, numero do CNPJ, ou agendamento)'),
        'ligacao rapida de 15 minutos',
        'ligacao rapida de 5 minutos'),
      'ligacao de 15 minutos',
      'ligacao de 5 minutos'),
    updated_at = now()
where system_prompt like '%15 minutos%'
   or system_prompt like '%E-mail para envio da proposta%'
   or system_prompt like '%*Email*: [email]%';

select c.nome,
       a.system_prompt like '%Nunca peca e-mail%' as sem_email,
       a.system_prompt like '%ligacao rapida de 5 minutos%' as cinco_minutos,
       a.system_prompt like '%ligacao rapida de 15 minutos%' as ainda_com_quinze
from public.corretora_ai_configs a
join public.corretoras c on c.id = a.corretora_id
order by c.nome;
