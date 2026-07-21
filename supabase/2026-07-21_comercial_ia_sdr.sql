alter table if exists public.comercial_config
  add column if not exists ia_sdr_ativa boolean not null default true,
  add column if not exists ia_sdr_prompt text;
