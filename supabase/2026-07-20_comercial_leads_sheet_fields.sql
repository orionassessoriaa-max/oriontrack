alter table public.comercial_leads
  add column if not exists ja_investiu_trafego text,
  add column if not exists faturamento_mensal text,
  add column if not exists prioridade text,
  add column if not exists investimento text,
  add column if not exists vidas text,
  add column if not exists negocio_etapa text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term text,
  add column if not exists utm_content text;
