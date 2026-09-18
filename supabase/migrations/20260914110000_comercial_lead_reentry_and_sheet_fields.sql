-- Campos recebidos da planilha do Kripto Hunters.
alter table public.comercial_leads
  add column if not exists instagram text,
  add column if not exists disposicao text,
  add column if not exists qualificacao_lp text,
  add column if not exists url_lp text,
  add column if not exists fbclid text;
