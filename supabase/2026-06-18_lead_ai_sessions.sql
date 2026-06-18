create table if not exists public.lead_ai_sessions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  corretor_id uuid references public.corretores(id) on delete cascade,
  admin_profile_id uuid references public.profiles(id) on delete set null,
  responsavel_profile_id uuid references public.profiles(id) on delete set null,
  persona text not null default 'Aline',
  status text not null default 'active',
  summary text,
  last_customer_message_at timestamptz,
  last_ai_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_ai_sessions_lead_unique unique (lead_id),
  constraint lead_ai_sessions_status_check check (status in ('active', 'handoff', 'paused', 'closed', 'error'))
);

create index if not exists lead_ai_sessions_status_idx
  on public.lead_ai_sessions(status, corretor_id, responsavel_profile_id);

alter table public.lead_ai_sessions enable row level security;

drop policy if exists "lead_ai_sessions_admin_all" on public.lead_ai_sessions;
create policy "lead_ai_sessions_admin_all"
on public.lead_ai_sessions
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.tipo_usuario = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.tipo_usuario = 'admin'
  )
);

drop policy if exists "lead_ai_sessions_broker_scope" on public.lead_ai_sessions;
create policy "lead_ai_sessions_broker_scope"
on public.lead_ai_sessions
for select
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_ai_sessions.lead_id
      and public.current_user_can_access_lead(l.corretor_id, l.responsavel_profile_id)
  )
);
