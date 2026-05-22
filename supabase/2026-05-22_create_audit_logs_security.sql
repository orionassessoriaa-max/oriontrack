create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

drop policy if exists "admins can read audit logs" on public.audit_logs;
create policy "admins can read audit logs"
on public.audit_logs
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
);

drop policy if exists "server can write audit logs" on public.audit_logs;
create policy "server can write audit logs"
on public.audit_logs
for insert
with check (true);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_profile_id_idx on public.audit_logs (actor_profile_id);
create index if not exists audit_logs_action_idx on public.audit_logs (action);
