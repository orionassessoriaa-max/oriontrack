create or replace function public.current_profile_role()
returns text language sql security definer set search_path = public as $$
  select p.tipo_usuario from public.profiles p where p.id = auth.uid() limit 1
$$;

create or replace function public.current_profile_corretor_id()
returns uuid language sql security definer set search_path = public as $$
  select p.corretor_id from public.profiles p where p.id = auth.uid() limit 1
$$;

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select public.current_profile_role() = 'admin'
$$;

alter table public.corretores
  add column if not exists meta_ad_account_id text,
  add column if not exists meta_ad_account_name text;

create table if not exists public.lead_atividades (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  tipo text not null default 'nota' check (tipo in ('nota', 'status', 'ligacao', 'whatsapp', 'email', 'tarefa', 'sistema')),
  titulo text not null,
  descricao text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_tarefas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  corretor_id uuid references public.corretores(id) on delete cascade,
  responsavel_profile_id uuid references public.profiles(id) on delete set null,
  titulo text not null,
  descricao text,
  vencimento timestamptz,
  status text not null default 'pendente' check (status in ('pendente', 'concluida', 'cancelada')),
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_conversas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  corretor_id uuid references public.corretores(id) on delete cascade,
  telefone text not null,
  nome_contato text,
  status text not null default 'aberta' check (status in ('aberta', 'aguardando', 'resolvida')),
  ultima_mensagem_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.whatsapp_conversas(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  remetente text,
  mensagem text not null,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  meta_account_id text not null unique,
  nome text not null,
  currency text,
  timezone_name text,
  status text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  meta_campaign_id text not null unique,
  meta_account_id text not null,
  nome text not null,
  status text,
  objective text,
  corretor_id uuid references public.corretores(id) on delete set null,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_metricas_diarias (
  id uuid primary key default gen_random_uuid(),
  meta_account_id text not null,
  meta_campaign_id text,
  corretor_id uuid references public.corretores(id) on delete set null,
  data date not null,
  spend numeric(12,2) not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  leads integer not null default 0,
  cpl numeric(12,2),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_meta_metricas_unique_day on public.meta_metricas_diarias(meta_account_id, coalesce(meta_campaign_id, ''), data);
create index if not exists idx_lead_atividades_lead_id on public.lead_atividades(lead_id, created_at desc);
create index if not exists idx_lead_tarefas_lead_id on public.lead_tarefas(lead_id);
create index if not exists idx_lead_tarefas_responsavel on public.lead_tarefas(responsavel_profile_id, status, vencimento);
create index if not exists idx_whatsapp_conversas_corretor on public.whatsapp_conversas(corretor_id, ultima_mensagem_at desc);
create index if not exists idx_whatsapp_mensagens_conversa on public.whatsapp_mensagens(conversa_id, created_at desc);
create index if not exists idx_meta_campaigns_account on public.meta_campaigns(meta_account_id);
create index if not exists idx_meta_campaigns_corretor on public.meta_campaigns(corretor_id);
create index if not exists idx_meta_metricas_corretor_data on public.meta_metricas_diarias(corretor_id, data desc);
create index if not exists idx_meta_metricas_account_data on public.meta_metricas_diarias(meta_account_id, data desc);

alter table public.lead_atividades enable row level security;
alter table public.lead_tarefas enable row level security;
alter table public.whatsapp_conversas enable row level security;
alter table public.whatsapp_mensagens enable row level security;
alter table public.meta_ad_accounts enable row level security;
alter table public.meta_campaigns enable row level security;
alter table public.meta_metricas_diarias enable row level security;

drop policy if exists "crm_lead_atividades_select" on public.lead_atividades;
drop policy if exists "crm_lead_atividades_insert" on public.lead_atividades;
drop policy if exists "crm_lead_tarefas_select" on public.lead_tarefas;
drop policy if exists "crm_lead_tarefas_write" on public.lead_tarefas;
drop policy if exists "crm_whatsapp_conversas_select" on public.whatsapp_conversas;
drop policy if exists "crm_whatsapp_conversas_write" on public.whatsapp_conversas;
drop policy if exists "crm_whatsapp_mensagens_select" on public.whatsapp_mensagens;
drop policy if exists "crm_whatsapp_mensagens_write" on public.whatsapp_mensagens;
drop policy if exists "meta_accounts_admin_all" on public.meta_ad_accounts;
drop policy if exists "meta_accounts_read_authenticated" on public.meta_ad_accounts;
drop policy if exists "meta_campaigns_admin_all" on public.meta_campaigns;
drop policy if exists "meta_campaigns_read_scoped" on public.meta_campaigns;
drop policy if exists "meta_metricas_admin_all" on public.meta_metricas_diarias;
drop policy if exists "meta_metricas_read_scoped" on public.meta_metricas_diarias;

create policy "crm_lead_atividades_select" on public.lead_atividades
for select using (
  public.is_admin()
  or exists (
    select 1 from public.leads l
    where l.id = lead_atividades.lead_id
    and (
      l.corretor_id = public.current_profile_corretor_id()
      or exists (
        select 1 from public.corretores c
        where c.id = l.corretor_id
        and c.gestor_trafego_id = auth.uid()
      )
    )
  )
);

create policy "crm_lead_atividades_insert" on public.lead_atividades
for insert with check (
  public.is_admin()
  or profile_id = auth.uid()
  or exists (
    select 1 from public.leads l
    where l.id = lead_atividades.lead_id
    and (
      l.corretor_id = public.current_profile_corretor_id()
      or exists (
        select 1 from public.corretores c
        where c.id = l.corretor_id
        and c.gestor_trafego_id = auth.uid()
      )
    )
  )
);

create policy "crm_lead_tarefas_select" on public.lead_tarefas
for select using (
  public.is_admin()
  or corretor_id = public.current_profile_corretor_id()
  or responsavel_profile_id = auth.uid()
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id
    and c.gestor_trafego_id = auth.uid()
  )
);

create policy "crm_lead_tarefas_write" on public.lead_tarefas
for all using (
  public.is_admin()
  or corretor_id = public.current_profile_corretor_id()
  or responsavel_profile_id = auth.uid()
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id
    and c.gestor_trafego_id = auth.uid()
  )
) with check (
  public.is_admin()
  or corretor_id = public.current_profile_corretor_id()
  or responsavel_profile_id = auth.uid()
  or exists (
    select 1 from public.corretores c
    where c.id = lead_tarefas.corretor_id
    and c.gestor_trafego_id = auth.uid()
  )
);

create policy "crm_whatsapp_conversas_select" on public.whatsapp_conversas
for select using (
  public.is_admin()
  or corretor_id = public.current_profile_corretor_id()
  or exists (
    select 1 from public.corretores c
    where c.id = whatsapp_conversas.corretor_id
    and c.gestor_trafego_id = auth.uid()
  )
);

create policy "crm_whatsapp_conversas_write" on public.whatsapp_conversas
for all using (public.is_admin()) with check (public.is_admin());

create policy "crm_whatsapp_mensagens_select" on public.whatsapp_mensagens
for select using (
  public.is_admin()
  or exists (
    select 1 from public.whatsapp_conversas wc
    where wc.id = whatsapp_mensagens.conversa_id
    and (
      wc.corretor_id = public.current_profile_corretor_id()
      or exists (
        select 1 from public.corretores c
        where c.id = wc.corretor_id
        and c.gestor_trafego_id = auth.uid()
      )
    )
  )
);

create policy "crm_whatsapp_mensagens_write" on public.whatsapp_mensagens
for all using (public.is_admin()) with check (public.is_admin());

create policy "meta_accounts_admin_all" on public.meta_ad_accounts
for all using (public.is_admin()) with check (public.is_admin());

create policy "meta_accounts_read_authenticated" on public.meta_ad_accounts
for select using (auth.uid() is not null);

create policy "meta_campaigns_admin_all" on public.meta_campaigns
for all using (public.is_admin()) with check (public.is_admin());

create policy "meta_campaigns_read_scoped" on public.meta_campaigns
for select using (
  public.is_admin()
  or corretor_id = public.current_profile_corretor_id()
  or exists (
    select 1 from public.corretores c
    where c.id = meta_campaigns.corretor_id
    and c.gestor_trafego_id = auth.uid()
  )
);

create policy "meta_metricas_admin_all" on public.meta_metricas_diarias
for all using (public.is_admin()) with check (public.is_admin());

create policy "meta_metricas_read_scoped" on public.meta_metricas_diarias
for select using (
  public.is_admin()
  or corretor_id = public.current_profile_corretor_id()
  or exists (
    select 1 from public.corretores c
    where c.id = meta_metricas_diarias.corretor_id
    and c.gestor_trafego_id = auth.uid()
  )
);
