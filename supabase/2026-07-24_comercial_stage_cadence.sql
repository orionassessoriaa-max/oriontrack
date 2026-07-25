alter table public.comercial_leads
  add column if not exists status_started_at timestamptz;

update public.comercial_leads
set status_started_at = coalesce(status_started_at, updated_at, data_entrada, now())
where status_started_at is null;

alter table public.comercial_leads
  alter column status_started_at set default now();

create or replace function public.comercial_track_stage_started_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.status_started_at := coalesce(new.status_started_at, new.data_entrada, now());
  elsif new.status is distinct from old.status then
    new.status_started_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists comercial_leads_track_stage_started_at on public.comercial_leads;
create trigger comercial_leads_track_stage_started_at
before insert or update of status on public.comercial_leads
for each row execute function public.comercial_track_stage_started_at();
