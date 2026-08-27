-- A interface e a RPC permitem ate duas imagens por lote. O teto diario
-- precisa comportar pelo menos esse mesmo lote; caso contrario, o valor
-- padrao de duas imagens sempre falha antes de entrar na fila.
update public.orion_cred_global_config
set limite_diario_usd = greatest(
      limite_diario_usd,
      custo_estimado_imagem_usd * 2
    ),
    updated_at = now()
where id = 1;
