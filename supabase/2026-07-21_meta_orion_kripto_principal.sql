-- Conta Meta principal da Orion, exclusiva da operacao Kripto Hunters.
-- Leads da Meta nao sao importados por esta configuracao.
alter table if exists public.meta_ad_accounts
  add column if not exists equipe_orion text,
  add column if not exists is_orion_principal boolean not null default false;

insert into public.meta_ad_accounts (
  meta_account_id,
  nome,
  currency,
  status,
  equipe_orion,
  is_orion_principal,
  updated_at
)
values (
  '1531044161152262',
  'CA - Orion Conta Principal',
  'BRL',
  'configured',
  'kripto_hunters',
  true,
  now()
)
on conflict (meta_account_id) do update
set nome = excluded.nome,
    equipe_orion = 'kripto_hunters',
    is_orion_principal = true,
    updated_at = now();
