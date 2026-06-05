create table if not exists public.notificacao_preferencias (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  whatsapp_enabled boolean not null default false,
  telefone text,
  tipos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notificacao_preferencias enable row level security;

drop policy if exists "notification_preferences_admin_all" on public.notificacao_preferencias;
create policy "notification_preferences_admin_all"
on public.notificacao_preferencias
for all
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.tipo_usuario = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.tipo_usuario = 'admin'
  )
);

drop policy if exists "notification_preferences_user_own" on public.notificacao_preferencias;
create policy "notification_preferences_user_own"
on public.notificacao_preferencias
for all
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create index if not exists notificacao_preferencias_whatsapp_idx
on public.notificacao_preferencias (whatsapp_enabled);
