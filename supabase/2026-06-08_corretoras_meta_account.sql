alter table public.corretoras
  add column if not exists meta_ad_account_id text,
  add column if not exists meta_ad_account_name text;

create index if not exists corretoras_meta_ad_account_id_idx
on public.corretoras (meta_ad_account_id);
