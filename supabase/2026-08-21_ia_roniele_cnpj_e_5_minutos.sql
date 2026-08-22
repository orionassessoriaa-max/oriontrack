-- Pedidos da Roniele, audio de 21/08. Valem SOMENTE para a IA dela; as outras
-- concessionarias continuam pedindo e-mail e falando em 15 minutos.
--
-- 1. Parar de pedir e-mail para enviar a proposta. O que serve para cotar no
--    portal e o numero do CNPJ.
-- 2. Nunca dizer que a ligacao dura 15 minutos. A ligacao passa a ser de 5.
--
-- Os 15 minutos da regra de inatividade continuam de pe: aquilo e o tempo que
-- o Orion Track espera o lead responder, nao a duracao da ligacao.
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
where corretora_id = (select id from public.corretoras where nome = 'RONIELE CORRETORA');

-- Confirmacao de escopo: so a Roniele pode aparecer com sem_email e
-- cinco_minutos verdadeiros.
select c.nome,
       a.system_prompt like '%Nunca peca e-mail%' as sem_email,
       a.system_prompt like '%ligacao rapida de 5 minutos%' as cinco_minutos,
       a.system_prompt like '%E-mail para envio da proposta%' as ainda_pede_email
from public.corretora_ai_configs a
join public.corretoras c on c.id = a.corretora_id
order by c.nome;
