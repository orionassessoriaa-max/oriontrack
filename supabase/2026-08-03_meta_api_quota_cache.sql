create table if not exists public.meta_api_cache (
  cache_key text primary key,
  endpoint text not null,
  resource_kind text not null default 'read',
  account_id text,
  payload jsonb not null,
  http_status integer not null default 200,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meta_api_cache_expires_at
  on public.meta_api_cache(expires_at);

create index if not exists idx_meta_api_cache_account
  on public.meta_api_cache(account_id, resource_kind, updated_at desc);

create table if not exists public.meta_api_usage (
  id text primary key default 'current',
  app_usage jsonb not null default '{}'::jsonb,
  business_usage jsonb not null default '{}'::jsonb,
  ad_account_usage jsonb not null default '{}'::jsonb,
  max_usage_percent numeric not null default 0,
  last_endpoint text,
  last_http_status integer,
  last_error jsonb,
  updated_at timestamptz not null default now()
);

alter table public.meta_api_cache enable row level security;
alter table public.meta_api_usage enable row level security;

-- Estas tabelas sao exclusivamente internas. O backend usa service_role,
-- que ignora RLS; nenhum token de navegador recebe acesso direto ao cache.
revoke all on table public.meta_api_cache from anon, authenticated;
revoke all on table public.meta_api_usage from anon, authenticated;

