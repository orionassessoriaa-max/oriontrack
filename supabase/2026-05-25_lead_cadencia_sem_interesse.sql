alter table public.leads
  add column if not exists sem_interesse_motivo text,
  add column if not exists sem_interesse_fez_cotacao boolean,
  add column if not exists cadencia_ativa boolean not null default false,
  add column if not exists cadencia_inicio timestamptz,
  add column if not exists cadencia_fim timestamptz;

create index if not exists idx_leads_cadencia_ativa
  on public.leads (corretor_id, cadencia_ativa, cadencia_inicio);
