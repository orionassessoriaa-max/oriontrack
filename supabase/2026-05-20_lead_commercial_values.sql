alter table public.leads
  add column if not exists valor_negociacao numeric,
  add column if not exists operadora_negociacao text,
  add column if not exists tipo_plano text,
  add column if not exists valor_venda numeric,
  add column if not exists valor_comissao numeric;
