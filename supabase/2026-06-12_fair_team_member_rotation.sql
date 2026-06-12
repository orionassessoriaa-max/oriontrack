create or replace function public.assign_lead_to_corretor_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_record public.corretor_times%rowtype;
  member_record record;
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

  select id, profile_id
    into member_record
  from public.corretor_time_membros
  where time_id = team_record.id
    and status in ('ativo', 'active')
    and coalesce(participa_rodizio, true) = true
    and profile_id is not null
  order by ultimo_lead_at asc nulls first, ordem asc, created_at asc
  limit 1;

  if member_record.id is null then
    return new;
  end if;

  new.responsavel_membro_id := member_record.id;
  new.responsavel_profile_id := member_record.profile_id;

  update public.corretor_time_membros
    set ultimo_lead_at = now()
  where id = member_record.id;

  return new;
end;
$$;
