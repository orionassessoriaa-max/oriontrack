alter table public.corretor_time_membros
  add column if not exists participa_rodizio boolean not null default true;

create index if not exists corretor_time_membros_rotation_idx
  on public.corretor_time_membros(time_id, status, participa_rodizio, ordem, created_at);

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
  broker_rotation_active boolean;
begin
  if new.corretor_id is null or new.responsavel_membro_id is not null then
    return new;
  end if;

  select coalesce(rodizio_ativo, true)
    into broker_rotation_active
  from public.corretores
  where id = new.corretor_id;

  if broker_rotation_active is false then
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
    and coalesce(participa_rodizio, true) = true
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
      and coalesce(participa_rodizio, true) = true
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
