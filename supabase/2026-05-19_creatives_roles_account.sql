alter table public.profiles
  add column if not exists tema_sistema text not null default 'claro'
    check (tema_sistema in ('claro', 'noturno'));

create table if not exists public.criativo_demandas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  tipo_criativo text not null default 'novo_criativo'
    check (tipo_criativo in ('novo_criativo', 'otimizacao')),
  corretor_id uuid references public.corretores(id) on delete set null,
  meta_account_id text,
  solicitante_profile_id uuid references public.profiles(id) on delete set null,
  responsavel_profile_id uuid references public.profiles(id) on delete set null,
  data_entrega date,
  status text not null default 'pendente'
    check (status in ('pendente', 'atrasado', 'feito', 'entregue', 'aprovado', 'revisao')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.criativo_assets (
  id uuid primary key default gen_random_uuid(),
  demanda_id uuid references public.criativo_demandas(id) on delete set null,
  corretor_id uuid references public.corretores(id) on delete set null,
  titulo text not null,
  descricao text,
  arquivo_url text,
  arquivo_path text,
  status text not null default 'em_aprovacao'
    check (status in ('em_aprovacao', 'aprovado', 'revisao', 'rodando')),
  comentario_corretor text,
  enviado_por_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_interacoes (
  id uuid primary key default gen_random_uuid(),
  account_manager_profile_id uuid references public.profiles(id) on delete cascade,
  corretor_id uuid references public.corretores(id) on delete cascade,
  data date not null default current_date,
  status text not null default 'pendente' check (status in ('pendente', 'feito')),
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_manager_profile_id, corretor_id, data)
);

create index if not exists idx_criativo_demandas_corretor on public.criativo_demandas(corretor_id, status, data_entrega);
create index if not exists idx_criativo_assets_corretor on public.criativo_assets(corretor_id, status, created_at desc);
create index if not exists idx_account_interacoes_manager_data on public.account_interacoes(account_manager_profile_id, data);

alter table public.criativo_demandas enable row level security;
alter table public.criativo_assets enable row level security;
alter table public.account_interacoes enable row level security;

drop policy if exists "criativo_demandas_read" on public.criativo_demandas;
drop policy if exists "criativo_demandas_insert" on public.criativo_demandas;
drop policy if exists "criativo_demandas_update" on public.criativo_demandas;
drop policy if exists "criativo_assets_read" on public.criativo_assets;
drop policy if exists "criativo_assets_insert" on public.criativo_assets;
drop policy if exists "criativo_assets_update" on public.criativo_assets;
drop policy if exists "account_interacoes_all" on public.account_interacoes;

create policy "criativo_demandas_read" on public.criativo_demandas
for select using (
  public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
  or corretor_id = public.current_profile_corretor_id()
  or solicitante_profile_id = auth.uid()
);

create policy "criativo_demandas_insert" on public.criativo_demandas
for insert with check (
  auth.uid() = solicitante_profile_id
  or public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
);

create policy "criativo_demandas_update" on public.criativo_demandas
for update using (
  public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
  or solicitante_profile_id = auth.uid()
  or corretor_id = public.current_profile_corretor_id()
) with check (
  public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
  or solicitante_profile_id = auth.uid()
  or corretor_id = public.current_profile_corretor_id()
);

create policy "criativo_assets_read" on public.criativo_assets
for select using (
  public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
  or corretor_id = public.current_profile_corretor_id()
);

create policy "criativo_assets_insert" on public.criativo_assets
for insert with check (
  public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
);

create policy "criativo_assets_update" on public.criativo_assets
for update using (
  public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
  or corretor_id = public.current_profile_corretor_id()
) with check (
  public.is_admin()
  or public.current_profile_role() in ('designer', 'account_manager')
  or corretor_id = public.current_profile_corretor_id()
);

create policy "account_interacoes_all" on public.account_interacoes
for all using (
  public.is_admin()
  or account_manager_profile_id = auth.uid()
) with check (
  public.is_admin()
  or account_manager_profile_id = auth.uid()
);
