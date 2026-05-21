create table if not exists public.corretor_times (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  nome text not null default 'Time comercial',
  proximo_indice integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists corretor_times_corretor_unique_active
  on public.corretor_times(corretor_id)
  where ativo = true;

create table if not exists public.corretor_time_membros (
  id uuid primary key default gen_random_uuid(),
  time_id uuid not null references public.corretor_times(id) on delete cascade,
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  nome text not null,
  email text not null,
  status text not null default 'ativo',
  ordem integer not null default 0,
  ultimo_lead_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists corretor_time_membros_time_idx
  on public.corretor_time_membros(time_id, status, ordem, created_at);

create index if not exists corretor_time_membros_profile_idx
  on public.corretor_time_membros(profile_id);

alter table public.leads
  add column if not exists responsavel_membro_id uuid references public.corretor_time_membros(id) on delete set null,
  add column if not exists responsavel_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists leads_responsavel_profile_idx
  on public.leads(responsavel_profile_id);

create index if not exists leads_responsavel_membro_idx
  on public.leads(responsavel_membro_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists corretor_times_touch_updated_at on public.corretor_times;
create trigger corretor_times_touch_updated_at
before update on public.corretor_times
for each row execute function public.touch_updated_at();

drop trigger if exists corretor_time_membros_touch_updated_at on public.corretor_time_membros;
create trigger corretor_time_membros_touch_updated_at
before update on public.corretor_time_membros
for each row execute function public.touch_updated_at();

create or replace function public.assign_lead_to_corretor_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_record public.corretor_times%rowtype;
  member_record record;
  total_members integer;
  next_index integer;
begin
  if new.corretor_id is null or new.responsavel_membro_id is not null then
    return new;
  end if;

  select *
    into team_record
  from public.corretor_times
  where corretor_id = new.corretor_id
    and ativo = true
  order by created_at asc
  limit 1;

  if not found then
    return new;
  end if;

  select count(*)
    into total_members
  from public.corretor_time_membros
  where time_id = team_record.id
    and status = 'ativo'
    and profile_id is not null;

  if coalesce(total_members, 0) = 0 then
    return new;
  end if;

  next_index := greatest(coalesce(team_record.proximo_indice, 0), 0) % total_members;

  select id, profile_id
    into member_record
  from (
    select
      id,
      profile_id,
      row_number() over(order by ordem asc, created_at asc) - 1 as row_index
    from public.corretor_time_membros
    where time_id = team_record.id
      and status = 'ativo'
      and profile_id is not null
  ) ordered_members
  where row_index = next_index
  limit 1;

  if member_record.id is null then
    return new;
  end if;

  new.responsavel_membro_id := member_record.id;
  new.responsavel_profile_id := member_record.profile_id;

  update public.corretor_times
    set proximo_indice = (next_index + 1) % total_members
  where id = team_record.id;

  update public.corretor_time_membros
    set ultimo_lead_at = now()
  where id = member_record.id;

  return new;
end;
$$;

drop trigger if exists leads_assign_to_corretor_team_member on public.leads;
create trigger leads_assign_to_corretor_team_member
before insert on public.leads
for each row execute function public.assign_lead_to_corretor_team_member();

alter table public.corretor_times enable row level security;
alter table public.corretor_time_membros enable row level security;

drop policy if exists "Admins manage corretor times" on public.corretor_times;
create policy "Admins manage corretor times"
on public.corretor_times
for all
to authenticated
using (current_user_tipo_usuario() = 'admin')
with check (current_user_tipo_usuario() = 'admin');

drop policy if exists "Corretores manage own times" on public.corretor_times;
create policy "Corretores manage own times"
on public.corretor_times
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'corretor'
      and p.corretor_id = corretor_times.corretor_id
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'corretor'
      and p.corretor_id = corretor_times.corretor_id
  )
);

drop policy if exists "Team members read own time" on public.corretor_times;
create policy "Team members read own time"
on public.corretor_times
for select
to authenticated
using (
  exists (
    select 1 from public.corretor_time_membros m
    where m.time_id = corretor_times.id
      and m.profile_id = auth.uid()
  )
);

drop policy if exists "Admins manage corretor team members" on public.corretor_time_membros;
create policy "Admins manage corretor team members"
on public.corretor_time_membros
for all
to authenticated
using (current_user_tipo_usuario() = 'admin')
with check (current_user_tipo_usuario() = 'admin');

drop policy if exists "Corretores manage own team members" on public.corretor_time_membros;
create policy "Corretores manage own team members"
on public.corretor_time_membros
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'corretor'
      and p.corretor_id = corretor_time_membros.corretor_id
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'corretor'
      and p.corretor_id = corretor_time_membros.corretor_id
  )
);

drop policy if exists "Team members read self" on public.corretor_time_membros;
create policy "Team members read self"
on public.corretor_time_membros
for select
to authenticated
using (profile_id = auth.uid());

drop policy if exists "Corretores can read own leads" on public.leads;
create policy "Corretores can read own leads"
on public.leads
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        (p.tipo_usuario = 'corretor' and p.corretor_id = leads.corretor_id)
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
);

drop policy if exists "Corretores can update own leads" on public.leads;
create policy "Corretores can update own leads"
on public.leads
for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        (p.tipo_usuario = 'corretor' and p.corretor_id = leads.corretor_id)
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        (p.tipo_usuario = 'corretor' and p.corretor_id = leads.corretor_id)
        or (p.tipo_usuario = 'corretor_membro' and leads.responsavel_profile_id = p.id)
      )
  )
);
