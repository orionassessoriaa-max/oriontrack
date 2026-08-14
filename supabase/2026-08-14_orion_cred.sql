create table if not exists public.orion_cred_accounts (
  gestor_id uuid primary key references public.profiles(id) on delete cascade,
  limite_creditos integer not null default 0 check (limite_creditos >= 0),
  creditos_usados integer not null default 0 check (creditos_usados >= 0),
  creditos_reservados integer not null default 0 check (creditos_reservados >= 0),
  ciclo_inicio date not null default current_date,
  ciclo_fim date not null default (current_date + 20),
  alerta_80_enviado_em timestamptz,
  alerta_100_enviado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (creditos_usados + creditos_reservados <= limite_creditos)
);

create table if not exists public.orion_cred_ledger (
  id uuid primary key default gen_random_uuid(),
  gestor_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('credito', 'reserva', 'consumo', 'estorno', 'ajuste')),
  quantidade integer not null check (quantidade > 0),
  referencia text,
  descricao text,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_orion_cred_ledger_gestor_created
  on public.orion_cred_ledger(gestor_id, created_at desc);

alter table public.orion_cred_accounts enable row level security;
alter table public.orion_cred_ledger enable row level security;

drop policy if exists "gestor le proprio orion cred" on public.orion_cred_accounts;
create policy "gestor le proprio orion cred"
on public.orion_cred_accounts for select
using (
  gestor_id = auth.uid()
  or exists (select 1 from public.profiles where id = auth.uid() and tipo_usuario = 'admin')
);

drop policy if exists "gestor le proprio extrato orion cred" on public.orion_cred_ledger;
create policy "gestor le proprio extrato orion cred"
on public.orion_cred_ledger for select
using (
  gestor_id = auth.uid()
  or exists (select 1 from public.profiles where id = auth.uid() and tipo_usuario = 'admin')
);

create or replace function public.orion_cred_reservar(
  p_gestor_id uuid,
  p_quantidade integer,
  p_referencia text
) returns public.orion_cred_accounts
language plpgsql
security definer
set search_path = public
as $$
declare conta public.orion_cred_accounts;
begin
  if p_quantidade <= 0 then raise exception 'Quantidade de creditos invalida.'; end if;

  update public.orion_cred_accounts
     set creditos_reservados = creditos_reservados + p_quantidade,
         updated_at = now()
   where gestor_id = p_gestor_id
     and limite_creditos - creditos_usados - creditos_reservados >= p_quantidade
  returning * into conta;

  if conta.gestor_id is null then
    raise exception 'Saldo Orion Cred insuficiente ou ainda nao configurado.';
  end if;

  insert into public.orion_cred_ledger(gestor_id, tipo, quantidade, referencia, descricao)
  values (p_gestor_id, 'reserva', p_quantidade, p_referencia, 'Reserva para geracao de criativo');
  return conta;
end;
$$;

create or replace function public.orion_cred_consumir(
  p_gestor_id uuid,
  p_quantidade integer,
  p_referencia text
) returns public.orion_cred_accounts
language plpgsql
security definer
set search_path = public
as $$
declare conta public.orion_cred_accounts;
begin
  update public.orion_cred_accounts
     set creditos_reservados = creditos_reservados - p_quantidade,
         creditos_usados = creditos_usados + p_quantidade,
         updated_at = now()
   where gestor_id = p_gestor_id
     and creditos_reservados >= p_quantidade
  returning * into conta;
  if conta.gestor_id is null then raise exception 'Reserva Orion Cred nao encontrada.'; end if;

  insert into public.orion_cred_ledger(gestor_id, tipo, quantidade, referencia, descricao)
  values (p_gestor_id, 'consumo', p_quantidade, p_referencia, 'Criativo gerado com sucesso');
  return conta;
end;
$$;

create or replace function public.orion_cred_estornar(
  p_gestor_id uuid,
  p_quantidade integer,
  p_referencia text
) returns public.orion_cred_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  conta public.orion_cred_accounts;
  estornado integer;
begin
  select * into conta
    from public.orion_cred_accounts
   where gestor_id = p_gestor_id
   for update;
  if conta.gestor_id is null then raise exception 'Conta Orion Cred nao encontrada.'; end if;
  estornado := least(greatest(p_quantidade, 0), conta.creditos_reservados);

  update public.orion_cred_accounts
     set creditos_reservados = creditos_reservados - estornado,
         updated_at = now()
   where gestor_id = p_gestor_id
  returning * into conta;

  if estornado > 0 then
    insert into public.orion_cred_ledger(gestor_id, tipo, quantidade, referencia, descricao)
    values (p_gestor_id, 'estorno', estornado, p_referencia, 'Reserva devolvida');
  end if;
  return conta;
end;
$$;

create or replace function public.orion_cred_adicionar(
  p_gestor_id uuid,
  p_quantidade integer,
  p_admin_id uuid
) returns public.orion_cred_accounts
language plpgsql
security definer
set search_path = public
as $$
declare conta public.orion_cred_accounts;
begin
  if p_quantidade <= 0 then raise exception 'Informe uma quantidade positiva.'; end if;

  insert into public.orion_cred_accounts(gestor_id, limite_creditos, atualizado_por)
  values (p_gestor_id, p_quantidade, p_admin_id)
  on conflict (gestor_id) do update
    set limite_creditos = public.orion_cred_accounts.limite_creditos + excluded.limite_creditos,
        atualizado_por = p_admin_id,
        alerta_80_enviado_em = case
          when public.orion_cred_accounts.creditos_usados::numeric /
               nullif(public.orion_cred_accounts.limite_creditos + excluded.limite_creditos, 0) < .8 then null
          else public.orion_cred_accounts.alerta_80_enviado_em end,
        alerta_100_enviado_em = null,
        updated_at = now()
  returning * into conta;

  insert into public.orion_cred_ledger(gestor_id, tipo, quantidade, descricao, criado_por)
  values (p_gestor_id, 'credito', p_quantidade, 'Creditos adicionados pelo administrador', p_admin_id);
  return conta;
end;
$$;

create or replace function public.orion_cred_marcar_alerta(
  p_gestor_id uuid,
  p_percentual integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare alterado integer;
begin
  if p_percentual = 100 then
    update public.orion_cred_accounts
       set alerta_100_enviado_em = now(), updated_at = now()
     where gestor_id = p_gestor_id
       and alerta_100_enviado_em is null
       and creditos_usados >= limite_creditos;
  elsif p_percentual = 80 then
    update public.orion_cred_accounts
       set alerta_80_enviado_em = now(), updated_at = now()
     where gestor_id = p_gestor_id
       and alerta_80_enviado_em is null
       and limite_creditos > 0
       and creditos_usados::numeric / limite_creditos >= .8
       and creditos_usados < limite_creditos;
  else
    return false;
  end if;
  get diagnostics alterado = row_count;
  return alterado > 0;
end;
$$;

revoke all on function public.orion_cred_reservar(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.orion_cred_consumir(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.orion_cred_estornar(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.orion_cred_adicionar(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.orion_cred_marcar_alerta(uuid, integer) from public, anon, authenticated;
grant execute on function public.orion_cred_reservar(uuid, integer, text) to service_role;
grant execute on function public.orion_cred_consumir(uuid, integer, text) to service_role;
grant execute on function public.orion_cred_estornar(uuid, integer, text) to service_role;
grant execute on function public.orion_cred_adicionar(uuid, integer, uuid) to service_role;
grant execute on function public.orion_cred_marcar_alerta(uuid, integer) to service_role;
