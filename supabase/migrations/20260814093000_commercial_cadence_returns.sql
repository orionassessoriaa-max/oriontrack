-- Cadencia comercial unica por lead, retorno substitutivo e reserva por MQL.
alter table public.comercial_leads
  add column if not exists cadencia_ativa boolean not null default false,
  add column if not exists cadencia_inicio_at timestamptz,
  add column if not exists cadencia_fim_at timestamptz,
  add column if not exists retorno_agendado_at timestamptz,
  add column if not exists retorno_status text,
  add column if not exists mql_reserva text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comercial_leads_retorno_status_ck'
  ) then
    alter table public.comercial_leads
      add constraint comercial_leads_retorno_status_ck
      check (retorno_status is null or retorno_status in ('agendado', 'resolvido', 'nao_resolvido'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'comercial_leads_mql_reserva_ck'
  ) then
    alter table public.comercial_leads
      add constraint comercial_leads_mql_reserva_ck
      check (mql_reserva is null or mql_reserva in ('S', 'A', 'B', 'C'));
  end if;
end $$;

alter table public.comercial_tarefas
  add column if not exists tipo text not null default 'geral';

update public.comercial_tarefas
set tipo = 'retorno'
where lead_id is not null
  and lower(titulo) like 'retorno%';

update public.comercial_leads lead
set cadencia_ativa = true,
    cadencia_inicio_at = coalesce(lead.cadencia_inicio_at, lead.status_started_at, lead.data_entrada, lead.created_at),
    cadencia_fim_at = null
where lead.retorno_status is null
  and (lower(lead.status) like '%tentando contato%' or lower(lead.status) like '%1% dia%');

with next_returns as (
  select distinct on (t.lead_id) t.lead_id, t.vencimento, t.created_at
  from public.comercial_tarefas t
  where t.lead_id is not null
    and t.tipo = 'retorno'
    and t.status = 'pendente'
    and t.vencimento is not null
  order by t.lead_id, t.vencimento asc
)
update public.comercial_leads lead
set retorno_agendado_at = task.vencimento,
    retorno_status = 'agendado',
    cadencia_ativa = false,
    cadencia_fim_at = coalesce(lead.cadencia_fim_at, task.created_at)
from next_returns task
where task.lead_id = lead.id
  and lead.retorno_status is null;

create table if not exists public.comercial_cadencia_pontos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.comercial_leads(id) on delete cascade,
  dia smallint not null check (dia between 1 and 10),
  ponto smallint not null check (ponto between 1 and 8),
  canal text not null check (canal in ('ligacao_fixo', 'ligacao_whatsapp', 'mensagem_whatsapp', 'audio_whatsapp')),
  status text not null default 'pendente' check (status in ('pendente', 'nao_atendeu', 'sem_resposta', 'atendeu', 'respondeu', 'nao_necessario')),
  registrado_por uuid references public.profiles(id) on delete set null,
  registrado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, dia, ponto)
);

create index if not exists comercial_cadencia_pontos_lead_dia_idx
  on public.comercial_cadencia_pontos (lead_id, dia, ponto);
create index if not exists comercial_leads_retorno_pendente_idx
  on public.comercial_leads (retorno_agendado_at)
  where retorno_status = 'agendado';

alter table public.comercial_cadencia_pontos enable row level security;
revoke all on table public.comercial_cadencia_pontos from anon, authenticated;
grant select, insert, update, delete on table public.comercial_cadencia_pontos to service_role;

notify pgrst, 'reload schema';
