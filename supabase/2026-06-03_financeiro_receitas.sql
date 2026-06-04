create table if not exists public.financeiro_receitas (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  parcela_numero integer not null default 1,
  total_parcelas integer not null default 1,
  valor_total numeric(12,2) not null default 0,
  valor_parcela numeric(12,2) not null default 0,
  vencimento date not null,
  status text not null default 'pendente' check (status in ('pendente', 'recebida')),
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, parcela_numero)
);

create index if not exists financeiro_receitas_corretor_vencimento_idx
  on public.financeiro_receitas (corretor_id, vencimento);

create index if not exists financeiro_receitas_lead_idx
  on public.financeiro_receitas (lead_id);

alter table public.financeiro_receitas enable row level security;

drop policy if exists financeiro_receitas_admin_all on public.financeiro_receitas;
create policy financeiro_receitas_admin_all on public.financeiro_receitas
for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tipo_usuario = 'admin'));

drop policy if exists financeiro_receitas_corretor_own on public.financeiro_receitas;
create policy financeiro_receitas_corretor_own on public.financeiro_receitas
for all to authenticated
using (
  corretor_id = (
    select p.corretor_id
    from public.profiles p
    where p.id = (select auth.uid())
      and p.tipo_usuario in ('corretor', 'corretor_admin', 'corretor_membro')
  )
)
with check (
  corretor_id = (
    select p.corretor_id
    from public.profiles p
    where p.id = (select auth.uid())
      and p.tipo_usuario in ('corretor', 'corretor_admin', 'corretor_membro')
  )
);
