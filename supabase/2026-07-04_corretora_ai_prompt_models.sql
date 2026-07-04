create table if not exists public.corretora_ai_prompt_models (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'Atendimento',
  system_prompt text not null,
  base_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists corretora_ai_prompt_models_created_at_idx
  on public.corretora_ai_prompt_models(created_at desc);

alter table public.corretora_ai_prompt_models enable row level security;

drop policy if exists "corretora_ai_prompt_models_admin_all" on public.corretora_ai_prompt_models;
create policy "corretora_ai_prompt_models_admin_all"
on public.corretora_ai_prompt_models
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

drop policy if exists "corretora_ai_prompt_models_admin_read" on public.corretora_ai_prompt_models;
create policy "corretora_ai_prompt_models_admin_read"
on public.corretora_ai_prompt_models
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
);
