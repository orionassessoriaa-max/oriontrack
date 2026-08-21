-- Mantem uma cadencia independente em cada etapa Dia 1 a Dia 10.
-- As tentativas ja sao historicas por (lead_id, dia, ordem), portanto mudar
-- de Dia 1 para Dia 2 cria um checklist novo sem apagar o anterior.
--
-- As etapas reais no banco sao "DIA 1º", "Dia 3º", "DIA 10º". O reconhecimento
-- anterior exigia "dia 1" exato, entao nenhuma etapa casava e a cadencia ficava
-- desligada em 90 leads. A regra abaixo aceita as formas que aparecem quando
-- alguem renomeia a coluna, e e a mesma de src/lib/comercialCadencia.ts.
create or replace function public.comercial_dia_da_etapa(valor text)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when lower(trim(coalesce(valor, ''))) ~ '^dia[[:space:]]*0?(10|[1-9])[[:space:]]*[ºo°]?$'
      then (regexp_match(lower(trim(valor)), '^dia[[:space:]]*0?(10|[1-9])'))[1]::int
    when lower(trim(coalesce(valor, ''))) ~ '^0?(10|[1-9])[[:space:]]*[ºo°]?[[:space:]]*dia$'
      then (regexp_match(lower(trim(valor)), '^0?(10|[1-9])'))[1]::int
    else null
  end;
$$;

create or replace function public.sync_comercial_contact_cadence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  dia_novo int;
  dia_antigo int;
begin
  dia_novo := public.comercial_dia_da_etapa(new.status);
  dia_antigo := case when tg_op = 'UPDATE' then public.comercial_dia_da_etapa(old.status) else null end;

  if dia_novo is not null then
    new.contato_cadencia_ativa := true;
    -- Trocar de Dia 1 para Dia 2 reinicia o relogio: o card so fica vermelho
    -- se passar de um dia parado na etapa nova.
    if tg_op = 'INSERT' or dia_antigo is null or dia_antigo <> dia_novo then
      new.contato_cadencia_inicio := now();
    end if;
  elsif dia_antigo is not null then
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
set contato_cadencia_ativa = public.comercial_dia_da_etapa(status) is not null,
    contato_cadencia_inicio = case
      when public.comercial_dia_da_etapa(status) is not null
      then coalesce(contato_cadencia_inicio, status_started_at, data_entrada, created_at, now())
      else contato_cadencia_inicio
    end;

-- O Kanban ja assinava postgres_changes em comercial_leads, mas a tabela nunca
-- entrou na publicacao: teste em 21/08/2026 assinou o canal, disparou um update
-- e nao recebeu nenhum evento. Sem isto a tela so muda no polling ou no F5.
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

-- Necessario para o evento de DELETE passar pelo filtro de RLS; sem isto o
-- lead apagado continua no quadro ate alguem recarregar.
alter table public.comercial_leads replica identity full;

notify pgrst, 'reload schema';

select status,
       public.comercial_dia_da_etapa(status) as dia,
       count(*) as leads
from public.comercial_leads
group by 1, 2
order by 2 nulls last, 1;
