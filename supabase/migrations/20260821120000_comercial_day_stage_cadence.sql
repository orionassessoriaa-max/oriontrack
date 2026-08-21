-- Mantem uma cadencia independente em cada etapa Dia 1 a Dia 10.
-- As tentativas ja sao historicas por (lead_id, dia, ordem), portanto mudar
-- de Dia 1 para Dia 2 cria um checklist novo sem apagar o anterior.
create or replace function public.sync_comercial_contact_cadence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  etapa_dia_nova boolean;
  etapa_dia_antiga boolean;
begin
  etapa_dia_nova := lower(trim(coalesce(new.status, ''))) ~ '^dia[[:space:]]*(10|[1-9])$'
    or lower(trim(coalesce(new.status, ''))) ~ '^1[º°o]?[[:space:]]*dia$';
  etapa_dia_antiga := tg_op = 'UPDATE' and (
    lower(trim(coalesce(old.status, ''))) ~ '^dia[[:space:]]*(10|[1-9])$'
    or lower(trim(coalesce(old.status, ''))) ~ '^1[º°o]?[[:space:]]*dia$'
  );

  if etapa_dia_nova then
    new.contato_cadencia_ativa := true;
    if tg_op = 'INSERT' or not etapa_dia_antiga then
      new.contato_cadencia_inicio := now();
    end if;
  elsif etapa_dia_antiga then
    new.contato_cadencia_ativa := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_comercial_contact_cadence on public.comercial_leads;
create trigger trg_sync_comercial_contact_cadence
before insert or update of status on public.comercial_leads
for each row execute function public.sync_comercial_contact_cadence();

update public.comercial_leads
set contato_cadencia_ativa = (
      lower(trim(coalesce(status, ''))) ~ '^dia[[:space:]]*(10|[1-9])$'
      or lower(trim(coalesce(status, ''))) ~ '^1[º°o]?[[:space:]]*dia$'
    ),
    contato_cadencia_inicio = case
      when lower(trim(coalesce(status, ''))) ~ '^dia[[:space:]]*(10|[1-9])$'
        or lower(trim(coalesce(status, ''))) ~ '^1[º°o]?[[:space:]]*dia$'
      then coalesce(contato_cadencia_inicio, status_started_at, data_entrada, created_at, now())
      else contato_cadencia_inicio
    end;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comercial_leads'
  ) then
    alter publication supabase_realtime add table public.comercial_leads;
  end if;
end $$;

alter table public.comercial_leads replica identity full;

notify pgrst, 'reload schema';
