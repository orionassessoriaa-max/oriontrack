create table if not exists public.lead_source_routes (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in (
    'meta_ad_account',
    'meta_page',
    'meta_form',
    'n8n_workflow',
    'spreadsheet',
    'custom'
  )),
  source_id text not null,
  label text,
  corretora_id uuid not null references public.corretoras(id) on delete cascade,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_source_routes_type_source_unique_idx
  on public.lead_source_routes (source_type, lower(trim(source_id)));

create index if not exists lead_source_routes_corretora_active_idx
  on public.lead_source_routes (corretora_id, active);

drop trigger if exists lead_source_routes_touch_updated_at on public.lead_source_routes;
create trigger lead_source_routes_touch_updated_at
before update on public.lead_source_routes
for each row execute function public.touch_updated_at();

alter table public.lead_source_routes enable row level security;

drop policy if exists "lead_source_routes_admin_all" on public.lead_source_routes;
create policy "lead_source_routes_admin_all"
on public.lead_source_routes
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
);

create table if not exists public.lead_routing_quarantine (
  id uuid primary key default gen_random_uuid(),
  reason text not null,
  source_type text,
  source_id text,
  supplied_corretor_id text,
  resolved_corretora_id uuid references public.corretoras(id) on delete set null,
  resolved_corretor_id uuid references public.corretores(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'discarded')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists lead_routing_quarantine_status_created_idx
  on public.lead_routing_quarantine (status, created_at desc);

create index if not exists lead_routing_quarantine_source_idx
  on public.lead_routing_quarantine (source_type, source_id);

alter table public.lead_routing_quarantine enable row level security;

drop policy if exists "lead_routing_quarantine_admin_read" on public.lead_routing_quarantine;
create policy "lead_routing_quarantine_admin_read"
on public.lead_routing_quarantine
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
);

insert into public.lead_source_routes (source_type, source_id, label, corretora_id, metadata)
select
  'meta_ad_account',
  regexp_replace(trim(c.meta_ad_account_id), '^act_', '', 'i'),
  coalesce(nullif(trim(c.meta_ad_account_name), ''), c.nome),
  c.id,
  jsonb_build_object('seeded_from', 'corretoras.meta_ad_account_id')
from public.corretoras c
where nullif(trim(c.meta_ad_account_id), '') is not null
on conflict (source_type, (lower(trim(source_id)))) do update
set
  corretora_id = excluded.corretora_id,
  label = excluded.label,
  active = true,
  metadata = public.lead_source_routes.metadata || excluded.metadata,
  updated_at = now();
