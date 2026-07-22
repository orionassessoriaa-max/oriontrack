create table if not exists public.comercial_lead_interacoes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.comercial_leads(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  comentario text,
  anexo_url text,
  anexo_nome text,
  created_at timestamptz not null default now(),
  constraint comercial_lead_interacoes_content_ck check (nullif(trim(coalesce(comentario, '')), '') is not null or anexo_url is not null)
);

create index if not exists comercial_lead_interacoes_lead_idx on public.comercial_lead_interacoes(lead_id, created_at desc);

create table if not exists public.comercial_metas (
  id uuid primary key default gen_random_uuid(),
  mes date not null unique,
  meta_valor numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.comercial_lead_interacoes enable row level security;
alter table public.comercial_metas enable row level security;

drop policy if exists comercial_lead_interacoes_read on public.comercial_lead_interacoes;
create policy comercial_lead_interacoes_read on public.comercial_lead_interacoes for select using (
  exists (select 1 from public.comercial_membros cm where cm.profile_id = auth.uid() and cm.ativo and cm.papel = 'coordenador')
  or exists (select 1 from public.comercial_leads cl where cl.id = lead_id and (cl.sdr_id = auth.uid() or cl.closer_id = auth.uid()))
);

drop policy if exists comercial_metas_read on public.comercial_metas;
create policy comercial_metas_read on public.comercial_metas for select using (
  exists (select 1 from public.comercial_membros cm where cm.profile_id = auth.uid() and cm.ativo and cm.papel = 'coordenador')
);
