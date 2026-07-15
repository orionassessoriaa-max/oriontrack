create table if not exists public.comercial_membros (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  papel text not null check (papel in ('coordenador', 'closer', 'sdr')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comercial_leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  email text,
  empresa text,
  origem text,
  campanha text,
  status text not null default 'Oportunidade',
  sdr_id uuid references public.profiles(id) on delete set null,
  closer_id uuid references public.profiles(id) on delete set null,
  lead_qualificado boolean not null default false,
  valor_negociacao numeric(14,2) not null default 0,
  valor_fechado numeric(14,2) not null default 0,
  reuniao_agendada_at timestamptz,
  reuniao_realizada_at timestamptz,
  reuniao_qualificada boolean,
  no_show boolean not null default false,
  observacoes text,
  ultimo_contato_at timestamptz,
  fechado_at timestamptz,
  data_entrada timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comercial_tarefas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.comercial_leads(id) on delete cascade,
  responsavel_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  descricao text,
  vencimento timestamptz,
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta')),
  status text not null default 'pendente' check (status in ('pendente', 'concluida', 'cancelada')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comercial_investimentos (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  valor numeric(14,2) not null default 0,
  origem text,
  campanha text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comercial_leads_status_idx on public.comercial_leads(status);
create index if not exists comercial_leads_sdr_idx on public.comercial_leads(sdr_id, data_entrada desc);
create index if not exists comercial_leads_closer_idx on public.comercial_leads(closer_id, data_entrada desc);
create index if not exists comercial_leads_period_idx on public.comercial_leads(data_entrada desc);
create index if not exists comercial_tarefas_responsavel_idx on public.comercial_tarefas(responsavel_id, status, vencimento);
create index if not exists comercial_investimentos_data_idx on public.comercial_investimentos(data desc);

insert into public.comercial_membros (profile_id, papel)
select id, 'coordenador'
from public.profiles
where lower(nome) = 'pedro ghisolfi'
on conflict (profile_id) do update set papel = excluded.papel, ativo = true, updated_at = now();

insert into public.comercial_membros (profile_id, papel)
select id, 'closer'
from public.profiles
where lower(nome) = 'leonardo cruz'
on conflict (profile_id) do update set papel = excluded.papel, ativo = true, updated_at = now();

insert into public.comercial_membros (profile_id, papel)
select id, 'sdr'
from public.profiles
where lower(nome) like 'renan%'
on conflict (profile_id) do update set papel = excluded.papel, ativo = true, updated_at = now();

alter table public.comercial_membros enable row level security;
alter table public.comercial_leads enable row level security;
alter table public.comercial_tarefas enable row level security;
alter table public.comercial_investimentos enable row level security;

drop policy if exists comercial_membros_read on public.comercial_membros;
create policy comercial_membros_read on public.comercial_membros for select using (
  auth.uid() = profile_id
  or exists (select 1 from public.comercial_membros cm where cm.profile_id = auth.uid() and cm.papel = 'coordenador' and cm.ativo)
  or public.is_admin()
);

drop policy if exists comercial_leads_read on public.comercial_leads;
create policy comercial_leads_read on public.comercial_leads for select using (
  public.is_admin()
  or sdr_id = auth.uid()
  or closer_id = auth.uid()
  or exists (select 1 from public.comercial_membros cm where cm.profile_id = auth.uid() and cm.papel = 'coordenador' and cm.ativo)
);

drop policy if exists comercial_tasks_read on public.comercial_tarefas;
create policy comercial_tasks_read on public.comercial_tarefas for select using (
  public.is_admin()
  or responsavel_id = auth.uid()
  or exists (select 1 from public.comercial_membros cm where cm.profile_id = auth.uid() and cm.papel = 'coordenador' and cm.ativo)
);

drop policy if exists comercial_investimentos_read on public.comercial_investimentos;
create policy comercial_investimentos_read on public.comercial_investimentos for select using (
  exists (select 1 from public.comercial_membros cm where cm.profile_id = auth.uid() and cm.ativo)
  or public.is_admin()
);

