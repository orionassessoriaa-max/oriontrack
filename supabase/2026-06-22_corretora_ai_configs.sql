create table if not exists public.corretora_ai_configs (
  id uuid primary key default gen_random_uuid(),
  corretora_id uuid not null references public.corretoras(id) on delete cascade,
  persona text not null default 'Aline',
  system_prompt text not null,
  status text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corretora_ai_configs_corretora_unique unique (corretora_id)
);

create index if not exists corretora_ai_configs_corretora_idx
  on public.corretora_ai_configs(corretora_id);

alter table public.corretora_ai_configs enable row level security;

drop policy if exists "corretora_ai_configs_admin_all" on public.corretora_ai_configs;
create policy "corretora_ai_configs_admin_all"
on public.corretora_ai_configs
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

drop policy if exists "corretora_ai_configs_read" on public.corretora_ai_configs;
create policy "corretora_ai_configs_read"
on public.corretora_ai_configs
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
  )
);
