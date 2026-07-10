alter table public.leads
  add column if not exists origem text;

create index if not exists idx_leads_origem on public.leads(origem);
