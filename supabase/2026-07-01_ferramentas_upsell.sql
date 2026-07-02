create table if not exists public.corretora_ferramentas (
  id uuid primary key default gen_random_uuid(),
  corretora_id uuid not null references public.corretoras(id) on delete cascade,
  ferramenta_key text not null,
  status text not null default 'disponivel',
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corretora_ferramentas_status_check
    check (status in ('oculto', 'disponivel', 'ativo', 'em_breve')),
  constraint corretora_ferramentas_unique unique (corretora_id, ferramenta_key)
);

create index if not exists corretora_ferramentas_corretora_idx
  on public.corretora_ferramentas(corretora_id);

create index if not exists corretora_ferramentas_key_idx
  on public.corretora_ferramentas(ferramenta_key);

alter table public.corretora_ferramentas enable row level security;

drop policy if exists "corretora_ferramentas_admin_all" on public.corretora_ferramentas;
create policy "corretora_ferramentas_admin_all"
on public.corretora_ferramentas
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

drop policy if exists "corretora_ferramentas_team_read" on public.corretora_ferramentas;
create policy "corretora_ferramentas_team_read"
on public.corretora_ferramentas
for select
using (
  exists (
    select 1
    from public.profiles p
    join public.corretoras c on lower(trim(c.nome)) = lower(trim(p.nome_empresa))
    where p.id = auth.uid()
      and c.id = corretora_ferramentas.corretora_id
      and p.tipo_usuario in ('corretor', 'corretor_admin', 'corretor_membro')
  )
);
