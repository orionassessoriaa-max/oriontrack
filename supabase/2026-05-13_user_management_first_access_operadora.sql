alter table public.profiles
  add column if not exists email_real text,
  add column if not exists precisa_trocar_senha boolean not null default false;

alter table public.leads
  add column if not exists operadora text;

create index if not exists idx_leads_operadora on public.leads(operadora);
create index if not exists idx_profiles_email_real on public.profiles(email_real);
