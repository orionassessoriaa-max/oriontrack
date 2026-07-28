-- Permite pausar campanha, conjunto ou anuncio na fila de recomendacoes.
-- Execute apos trafego_rastreio_recomendacoes, inclusive se ela ja foi aplicada.
alter table if exists public.trafego_recomendacoes
  drop constraint if exists trafego_recomendacoes_acao_check;

alter table if exists public.trafego_recomendacoes
  add constraint trafego_recomendacoes_acao_check
  check (acao in (
    'pausar_campanha',
    'pausar_conjunto',
    'pausar_anuncio',
    'trocar_criativo',
    'revisar_publico',
    'revisar_rastreio',
    'avisar_admin'
  ));
