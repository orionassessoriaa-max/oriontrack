alter table public.comercial_leads
  add column if not exists contato_cadencia_ativa boolean not null default false,
  add column if not exists contato_cadencia_inicio timestamptz;

create table if not exists public.comercial_cadencia_tentativas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.comercial_leads(id) on delete cascade,
  dia smallint not null check (dia between 1 and 10),
  ordem smallint not null check (ordem between 1 and 8),
  canal text not null check (canal in ('ligacao_fixo', 'ligacao_whatsapp', 'mensagem_whatsapp', 'audio_whatsapp')),
  titulo text not null,
  status text not null default 'pendente' check (status in ('pendente', 'nao_atendeu', 'sem_resposta', 'atendeu', 'respondeu', 'nao_necessario')),
  autor_id uuid references public.profiles(id) on delete set null,
  concluido_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, dia, ordem)
);

create index if not exists comercial_cadencia_tentativas_lead_dia_idx
  on public.comercial_cadencia_tentativas (lead_id, dia, ordem);

alter table public.comercial_cadencia_tentativas enable row level security;
revoke all on table public.comercial_cadencia_tentativas from anon, authenticated;

create or replace function public.sync_comercial_contact_cadence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  entrando boolean;
  saindo boolean;
begin
  entrando := lower(trim(coalesce(new.status, ''))) = 'tentando contato';
  saindo := tg_op = 'UPDATE'
    and lower(trim(coalesce(old.status, ''))) = 'tentando contato'
    and not entrando;

  if entrando and (
    tg_op = 'INSERT'
    or lower(trim(coalesce(old.status, ''))) <> 'tentando contato'
  ) then
    new.contato_cadencia_ativa := true;
    new.contato_cadencia_inicio := now();
  elsif saindo then
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
set contato_cadencia_ativa = true,
    contato_cadencia_inicio = coalesce(
      contato_cadencia_inicio,
      status_started_at,
      data_entrada,
      created_at,
      now()
    )
where lower(trim(coalesce(status, ''))) = 'tentando contato';

notify pgrst, 'reload schema';
