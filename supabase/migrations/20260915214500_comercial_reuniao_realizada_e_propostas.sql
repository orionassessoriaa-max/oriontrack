-- Etapa operacional exclusiva do closer Léo após uma reunião concluída.
update public.comercial_config
set etapas = (
  select jsonb_agg(item order by ordinal)
  from (
    select item, ordinal
    from jsonb_array_elements(etapas) with ordinality as entries(item, ordinal)
    union all
    select '{"id":"Reunião realizada","label":"Reunião realizada"}'::jsonb, 10000
    where not exists (
      select 1
      from jsonb_array_elements(etapas) as existing(item)
      where existing.item->>'id' = 'Reunião realizada'
    )
  ) staged
)
where id = 1;

create table if not exists public.comercial_propostas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.comercial_leads(id) on delete cascade,
  nome_cliente text not null,
  html_snapshot text not null,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comercial_propostas_lead_created_idx
  on public.comercial_propostas (lead_id, created_at desc);

alter table public.comercial_propostas enable row level security;

notify pgrst, 'reload schema';
