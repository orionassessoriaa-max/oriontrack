alter table public.comercial_leads
  add column if not exists estado text;

create index if not exists comercial_leads_estado_idx on public.comercial_leads(estado);
