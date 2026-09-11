-- Orcamento de criativos alinhado ao gasto real da OpenAI.
--
-- O controle existia, mas com um preco irreal: acreditava que cada imagem
-- custava US$ 0,053, enquanto a fatura mostra US$ 0,42 por imagem em
-- gpt-image-2 com quality medium. Na pratica ele liberava oito vezes mais
-- geracao do que o orcamento aguentava.
--
-- Teto pedido pela diretoria: R$ 250 por mes.
--   R$ 250 / 5,19 (cotacao de 20/08/2026) = US$ 48,17
--   menos US$ 4 de texto (IA das corretoras, SDR, Apolo, alertas)
--   = US$ 44 para criativos.
--
-- Com US$ 0,42 por imagem, isso da cerca de 104 criativos no mes, ou 3,5 por
-- dia util. Se a qualidade cair para low, o mesmo orcamento rende o triplo.
update public.orion_cred_global_config
set orcamento_criativos_usd = 44.00,
    limite_diario_usd = 1.50,
    custo_estimado_imagem_usd = 0.42,
    -- Ciclo passa a acompanhar o mes civil, que e como o teto foi pedido.
    ciclo_inicio = date_trunc('month', current_date)::date,
    ciclo_fim = (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
    -- Os alertas de 60, 80, 90 e 100 por cento voltam a valer neste ciclo.
    alerta_60_enviado_em = null,
    alerta_80_enviado_em = null,
    alerta_90_enviado_em = null,
    alerta_100_enviado_em = null,
    updated_at = now()
where id = 1;

select orcamento_criativos_usd,
       limite_diario_usd,
       custo_estimado_imagem_usd,
       gasto_usd,
       ciclo_inicio,
       ciclo_fim,
       floor(orcamento_criativos_usd / custo_estimado_imagem_usd) as criativos_no_ciclo
from public.orion_cred_global_config
where id = 1;
