alter table public.leads
  add column if not exists origem text;

create index if not exists idx_leads_origem on public.leads(origem);

update public.leads
set origem = 'Orion'
where coalesce(origem, '') <> 'Orion'
  and (
    coalesce(utm_source, '') ilike '%[orion]%'
    or coalesce(utm_medium, '') ilike '%[orion]%'
    or coalesce(utm_campaign, '') ilike '%[orion]%'
    or coalesce(utm_term, '') ilike '%[orion]%'
    or coalesce(utm_content, '') ilike '%[orion]%'
    or coalesce(operadora, '') ilike '%[orion]%'
    or coalesce(observacoes, '') ilike '%[orion]%'
  );
