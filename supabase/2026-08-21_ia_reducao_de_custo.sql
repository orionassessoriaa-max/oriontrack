-- Vocabulario pedido pelo Danilo: a IA deve falar em "reducao de custo", nunca
-- em "economia". Para corretor de PME, economia soa a cliente cacando o mais
-- barato; reducao de custo soa a decisao de gestao.
--
-- Alteracao cirurgica: insere a regra logo abaixo do cabecalho de tom, sem
-- reescrever o prompt inteiro. Assim a excecao da Facilita, que nao tem a
-- pergunta de necessidade especifica, continua intacta.
update public.corretora_ai_configs
set system_prompt = replace(
      system_prompt,
      '== TOM E ESTILO ==',
      '== TOM E ESTILO ==' || chr(10) ||
      '- Nunca use a palavra "economia". Fale em "reducao de custo": e assim que o corretor e o cliente PME conversam sobre isso.'
    ),
    updated_at = now()
where system_prompt like '%== TOM E ESTILO ==%'
  and system_prompt not like '%Nunca use a palavra "economia"%';

select count(*) filter (where system_prompt like '%Nunca use a palavra "economia"%') as com_a_regra,
       count(*) as total
from public.corretora_ai_configs;
