-- Pré-visualização de relatórios semanais e destinos de envio.
create table if not exists public.trafego_relatorios_semanais (
  id uuid primary key default gen_random_uuid(),
  gestor_id uuid references public.profiles(id) on delete set null,
  data_inicio date not null,
  data_fim date not null,
  itens jsonb not null default '[]'::jsonb,
  status text not null default 'PREVIEW' check (status in ('PREVIEW', 'ENVIADO')),
  created_at timestamptz not null default now()
);

create index if not exists trafego_relatorios_semanais_gestor_idx
  on public.trafego_relatorios_semanais (gestor_id, created_at desc);

create table if not exists public.trafego_relatorio_destinos (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  tipo text not null check (tipo in ('account', 'grupo')),
  nome text not null,
  destino text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corretor_id, tipo, destino)
);

create index if not exists trafego_relatorio_destinos_corretor_idx
  on public.trafego_relatorio_destinos (corretor_id, tipo, ativo);

alter table public.trafego_relatorios_semanais enable row level security;
alter table public.trafego_relatorio_destinos enable row level security;

drop policy if exists "trafego_relatorios_semanais_admin_read" on public.trafego_relatorios_semanais;
create policy "trafego_relatorios_semanais_admin_read"
  on public.trafego_relatorios_semanais for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.tipo_usuario in ('admin', 'gestor_trafego', 'account_manager')));

drop policy if exists "trafego_relatorio_destinos_admin_read" on public.trafego_relatorio_destinos;
create policy "trafego_relatorio_destinos_admin_read"
  on public.trafego_relatorio_destinos for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.tipo_usuario in ('admin', 'gestor_trafego', 'account_manager')));
