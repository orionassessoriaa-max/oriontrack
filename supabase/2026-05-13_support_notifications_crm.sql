alter table public.solicitacoes_suporte
  add column if not exists solicitante_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists solicitante_nome text,
  add column if not exists solicitante_tipo text check (solicitante_tipo in ('admin', 'corretor', 'gestor_trafego')),
  add column if not exists categoria text;

alter table public.solicitacoes_suporte
  alter column corretor_id drop not null;

alter table public.corretores
  add column if not exists crm_api_url text;

alter table public.profiles
  add column if not exists foto_url text,
  add column if not exists nome_empresa text,
  add column if not exists precisa_trocar_senha boolean not null default false;

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  mensagem text not null,
  remetente_profile_id uuid references public.profiles(id) on delete set null,
  destinatario_profile_id uuid references public.profiles(id) on delete cascade,
  destinatario_tipo text check (destinatario_tipo in ('todos', 'admin', 'corretor', 'gestor_trafego')),
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notificacoes enable row level security;

drop policy if exists "Admins manage all notifications" on public.notificacoes;
create policy "Admins manage all notifications"
on public.notificacoes
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

drop policy if exists "Users read own role notifications" on public.notificacoes;
create policy "Users read own role notifications"
on public.notificacoes
for select
using (
  destinatario_profile_id = auth.uid()
  or destinatario_tipo = 'todos'
  or destinatario_tipo = (
    select profiles.tipo_usuario
    from public.profiles
    where profiles.id = auth.uid()
  )
);

drop policy if exists "Users mark own notifications as read" on public.notificacoes;
create policy "Users mark own notifications as read"
on public.notificacoes
for update
using (
  destinatario_profile_id = auth.uid()
  or destinatario_tipo = 'todos'
  or destinatario_tipo = (
    select profiles.tipo_usuario
    from public.profiles
    where profiles.id = auth.uid()
  )
)
with check (
  destinatario_profile_id = auth.uid()
  or destinatario_tipo = 'todos'
  or destinatario_tipo = (
    select profiles.tipo_usuario
    from public.profiles
    where profiles.id = auth.uid()
  )
);
