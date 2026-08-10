delete from public.leads
where lower(regexp_replace(trim(coalesce(nome, '')), '[[:space:]]+', ' ', 'g')) in ('joao silva', 'joão silva')
  and regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') like '%987654321';

create or replace function public.block_known_fake_lead()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(regexp_replace(trim(coalesce(new.nome, '')), '[[:space:]]+', ' ', 'g')) in ('joao silva', 'joão silva')
    and regexp_replace(coalesce(new.telefone, ''), '[^0-9]', '', 'g') like '%987654321'
  then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists block_known_fake_lead_before_insert on public.leads;

create trigger block_known_fake_lead_before_insert
before insert on public.leads
for each row
execute function public.block_known_fake_lead();
