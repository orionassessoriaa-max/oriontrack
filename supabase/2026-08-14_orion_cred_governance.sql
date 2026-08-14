-- Governanca completa do Orion Cred para geracao de criativos.
-- O custo em USD e estimado pelo Orion Track. Ele nao consulta nem altera a IA dos corretores.

alter table public.orion_cred_accounts
  add column if not exists alerta_60_enviado_em timestamptz,
  add column if not exists alerta_90_enviado_em timestamptz;

alter table public.orion_cred_ledger
  drop constraint if exists orion_cred_ledger_tipo_check;

alter table public.orion_cred_ledger
  add constraint orion_cred_ledger_tipo_check
  check (tipo in (
    'credito', 'reserva', 'consumo', 'estorno', 'ajuste',
    'debito', 'transferencia_entrada', 'transferencia_saida'
  ));

alter table public.orion_cred_ledger
  add column if not exists corretor_id uuid references public.corretores(id) on delete set null,
  add column if not exists concessionaria text,
  add column if not exists operadora text,
  add column if not exists regiao text,
  add column if not exists prompt text,
  add column if not exists resultado text,
  add column if not exists asset_id uuid references public.criativo_assets(id) on delete set null,
  add column if not exists custo_estimado_usd numeric(12,4) not null default 0;

create table if not exists public.orion_cred_global_config (
  id smallint primary key default 1 check (id = 1),
  orcamento_criativos_usd numeric(12,4) not null default 12 check (orcamento_criativos_usd >= 0),
  limite_diario_usd numeric(12,4) not null default 0.60 check (limite_diario_usd >= 0),
  custo_estimado_imagem_usd numeric(12,4) not null default 0.053 check (custo_estimado_imagem_usd > 0),
  gasto_usd numeric(12,4) not null default 0 check (gasto_usd >= 0),
  reservado_usd numeric(12,4) not null default 0 check (reservado_usd >= 0),
  ciclo_inicio date not null default current_date,
  ciclo_fim date not null default (current_date + 20),
  alerta_60_enviado_em timestamptz,
  alerta_80_enviado_em timestamptz,
  alerta_90_enviado_em timestamptz,
  alerta_100_enviado_em timestamptz,
  updated_at timestamptz not null default now(),
  check (gasto_usd + reservado_usd <= orcamento_criativos_usd)
);

insert into public.orion_cred_global_config(id)
values (1)
on conflict (id) do nothing;

create table if not exists public.orion_cred_daily_usage (
  dia date primary key,
  gasto_usd numeric(12,4) not null default 0 check (gasto_usd >= 0),
  reservado_usd numeric(12,4) not null default 0 check (reservado_usd >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.orion_cred_generation_locks (
  gestor_id uuid primary key references public.profiles(id) on delete cascade,
  referencia text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.orion_cred_generation_requests (
  id uuid primary key default gen_random_uuid(),
  gestor_id uuid not null references public.profiles(id) on delete cascade,
  fingerprint text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_orion_cred_requests_gestor_created
  on public.orion_cred_generation_requests(gestor_id, created_at desc);

alter table public.orion_cred_global_config enable row level security;
alter table public.orion_cred_daily_usage enable row level security;
alter table public.orion_cred_generation_locks enable row level security;
alter table public.orion_cred_generation_requests enable row level security;

drop policy if exists "equipe le limite global orion cred" on public.orion_cred_global_config;
create policy "equipe le limite global orion cred"
on public.orion_cred_global_config for select
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and tipo_usuario in ('admin', 'gestor_trafego')
  )
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
declare
  conta public.orion_cred_accounts;
  global_config public.orion_cred_global_config;
  uso_dia public.orion_cred_daily_usage;
  custo numeric(12,4);
begin
  if p_quantidade <= 0 or p_quantidade > 2 then
    raise exception 'Cada pedido pode gerar no maximo 2 imagens.';
  end if;

  update public.orion_cred_accounts
     set creditos_usados = 0,
         creditos_reservados = 0,
         ciclo_inicio = current_date,
         ciclo_fim = current_date + 20,
         alerta_60_enviado_em = null,
         alerta_80_enviado_em = null,
         alerta_90_enviado_em = null,
         alerta_100_enviado_em = null,
         updated_at = now()
   where gestor_id = p_gestor_id
     and ciclo_fim < current_date;

  select * into global_config
    from public.orion_cred_global_config
   where id = 1
   for update;

  if global_config.ciclo_fim < current_date then
    update public.orion_cred_global_config
       set gasto_usd = 0,
           reservado_usd = 0,
           ciclo_inicio = current_date,
           ciclo_fim = current_date + 20,
           alerta_60_enviado_em = null,
           alerta_80_enviado_em = null,
           alerta_90_enviado_em = null,
           alerta_100_enviado_em = null,
           updated_at = now()
     where id = 1
    returning * into global_config;
  end if;

  custo := global_config.custo_estimado_imagem_usd * p_quantidade;
  if global_config.gasto_usd + global_config.reservado_usd + custo > global_config.orcamento_criativos_usd then
    raise exception 'Limite global de US$ 12 para criativos atingido. A IA dos corretores continua ativa.';
  end if;

  insert into public.orion_cred_daily_usage(dia)
  values (current_date)
  on conflict (dia) do nothing;

  select * into uso_dia
    from public.orion_cred_daily_usage
   where dia = current_date
   for update;

  if uso_dia.gasto_usd + uso_dia.reservado_usd + custo > global_config.limite_diario_usd then
    raise exception 'Limite diario de US$ 0,60 para criativos atingido. Tente novamente no proximo dia.';
  end if;

  update public.orion_cred_accounts
     set creditos_reservados = creditos_reservados + p_quantidade,
         updated_at = now()
   where gestor_id = p_gestor_id
     and limite_creditos - creditos_usados - creditos_reservados >= p_quantidade
  returning * into conta;

  if conta.gestor_id is null then
    raise exception 'Saldo Orion Cred insuficiente ou ainda nao configurado.';
  end if;

  update public.orion_cred_global_config
     set reservado_usd = reservado_usd + custo, updated_at = now()
   where id = 1;
  update public.orion_cred_daily_usage
     set reservado_usd = reservado_usd + custo, updated_at = now()
   where dia = current_date;

  insert into public.orion_cred_ledger(
    gestor_id, tipo, quantidade, referencia, descricao, custo_estimado_usd
  ) values (
    p_gestor_id, 'reserva', p_quantidade, p_referencia,
    'Reserva para geracao final de criativo', custo
  );
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
declare
  conta public.orion_cred_accounts;
  custo_unitario numeric(12,4);
  custo numeric(12,4);
begin
  select custo_estimado_imagem_usd into custo_unitario
    from public.orion_cred_global_config where id = 1 for update;
  custo := custo_unitario * p_quantidade;

  update public.orion_cred_accounts
     set creditos_reservados = creditos_reservados - p_quantidade,
         creditos_usados = creditos_usados + p_quantidade,
         updated_at = now()
   where gestor_id = p_gestor_id
     and creditos_reservados >= p_quantidade
  returning * into conta;
  if conta.gestor_id is null then raise exception 'Reserva Orion Cred nao encontrada.'; end if;

  update public.orion_cred_global_config
     set reservado_usd = greatest(reservado_usd - custo, 0),
         gasto_usd = gasto_usd + custo,
         updated_at = now()
   where id = 1;
  update public.orion_cred_daily_usage
     set reservado_usd = greatest(reservado_usd - custo, 0),
         gasto_usd = gasto_usd + custo,
         updated_at = now()
   where dia = current_date;

  insert into public.orion_cred_ledger(
    gestor_id, tipo, quantidade, referencia, descricao, resultado, custo_estimado_usd
  ) values (
    p_gestor_id, 'consumo', p_quantidade, p_referencia,
    'Criativo final gerado com sucesso', 'concluido', custo
  );
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
  custo numeric(12,4);
begin
  select * into conta from public.orion_cred_accounts
   where gestor_id = p_gestor_id for update;
  if conta.gestor_id is null then raise exception 'Conta Orion Cred nao encontrada.'; end if;
  estornado := least(greatest(p_quantidade, 0), conta.creditos_reservados);
  select custo_estimado_imagem_usd * estornado into custo
    from public.orion_cred_global_config where id = 1 for update;

  update public.orion_cred_accounts
     set creditos_reservados = creditos_reservados - estornado, updated_at = now()
   where gestor_id = p_gestor_id returning * into conta;

  if estornado > 0 then
    update public.orion_cred_global_config
       set reservado_usd = greatest(reservado_usd - custo, 0), updated_at = now()
     where id = 1;
    update public.orion_cred_daily_usage
       set reservado_usd = greatest(reservado_usd - custo, 0), updated_at = now()
     where dia = current_date;
    insert into public.orion_cred_ledger(
      gestor_id, tipo, quantidade, referencia, descricao, resultado, custo_estimado_usd
    ) values (
      p_gestor_id, 'estorno', estornado, p_referencia,
      'Reserva devolvida por falha ou cancelamento', 'estornado', custo
    );
  end if;
  return conta;
end;
$$;

create or replace function public.orion_cred_ajustar(
  p_gestor_id uuid,
  p_quantidade integer,
  p_admin_id uuid,
  p_descricao text default null
) returns public.orion_cred_accounts
language plpgsql
security definer
set search_path = public
as $$
declare conta public.orion_cred_accounts;
begin
  if p_quantidade = 0 then raise exception 'Informe uma quantidade diferente de zero.'; end if;
  insert into public.orion_cred_accounts(gestor_id, limite_creditos, atualizado_por)
  values (p_gestor_id, greatest(p_quantidade, 0), p_admin_id)
  on conflict (gestor_id) do update
    set limite_creditos = greatest(
          public.orion_cred_accounts.creditos_usados + public.orion_cred_accounts.creditos_reservados,
          public.orion_cred_accounts.limite_creditos + p_quantidade
        ),
        atualizado_por = p_admin_id,
        updated_at = now()
  returning * into conta;
  insert into public.orion_cred_ledger(gestor_id, tipo, quantidade, descricao, criado_por)
  values (
    p_gestor_id,
    case when p_quantidade > 0 then 'credito' else 'debito' end,
    abs(p_quantidade),
    coalesce(p_descricao, case when p_quantidade > 0 then 'Creditos adicionados pelo administrador' else 'Creditos removidos pelo administrador' end),
    p_admin_id
  );
  return conta;
end;
$$;

create or replace function public.orion_cred_transferir(
  p_origem_id uuid,
  p_destino_id uuid,
  p_quantidade integer,
  p_admin_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare disponivel integer;
begin
  if p_origem_id = p_destino_id or p_quantidade <= 0 then
    raise exception 'Transferencia Orion Cred invalida.';
  end if;
  select limite_creditos - creditos_usados - creditos_reservados into disponivel
    from public.orion_cred_accounts where gestor_id = p_origem_id for update;
  if coalesce(disponivel, 0) < p_quantidade then
    raise exception 'Saldo disponivel insuficiente para transferencia.';
  end if;
  perform public.orion_cred_ajustar(p_origem_id, -p_quantidade, p_admin_id, 'Transferencia de creditos para outro gestor');
  perform public.orion_cred_ajustar(p_destino_id, p_quantidade, p_admin_id, 'Transferencia de creditos recebida de outro gestor');
  update public.orion_cred_ledger set tipo = 'transferencia_saida'
   where id = (select id from public.orion_cred_ledger where gestor_id = p_origem_id order by created_at desc limit 1);
  update public.orion_cred_ledger set tipo = 'transferencia_entrada'
   where id = (select id from public.orion_cred_ledger where gestor_id = p_destino_id order by created_at desc limit 1);
  return true;
end;
$$;

create or replace function public.orion_cred_adquirir_lock(
  p_gestor_id uuid,
  p_referencia text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare alterado integer;
begin
  delete from public.orion_cred_generation_locks where expires_at <= now();
  insert into public.orion_cred_generation_locks(gestor_id, referencia, expires_at)
  values (p_gestor_id, p_referencia, now() + interval '15 minutes')
  on conflict (gestor_id) do nothing;
  get diagnostics alterado = row_count;
  return alterado > 0;
end;
$$;

create or replace function public.orion_cred_liberar_lock(
  p_gestor_id uuid,
  p_referencia text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare alterado integer;
begin
  delete from public.orion_cred_generation_locks
   where gestor_id = p_gestor_id and referencia = p_referencia;
  get diagnostics alterado = row_count;
  return alterado > 0;
end;
$$;

create or replace function public.orion_cred_registrar_pedido(
  p_gestor_id uuid,
  p_fingerprint text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.orion_cred_generation_requests
     where gestor_id = p_gestor_id
       and fingerprint = p_fingerprint
       and created_at >= now() - interval '10 minutes'
  ) then
    return false;
  end if;
  insert into public.orion_cred_generation_requests(gestor_id, fingerprint)
  values (p_gestor_id, p_fingerprint);
  delete from public.orion_cred_generation_requests where created_at < now() - interval '30 days';
  return true;
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
  if p_percentual not in (60, 80, 90, 100) then return false; end if;
  execute format(
    'update public.orion_cred_accounts set alerta_%s_enviado_em = now(), updated_at = now() where gestor_id = $1 and alerta_%s_enviado_em is null and limite_creditos > 0 and creditos_usados::numeric / limite_creditos >= $2',
    p_percentual, p_percentual
  ) using p_gestor_id, p_percentual::numeric / 100;
  get diagnostics alterado = row_count;
  return alterado > 0;
end;
$$;

create or replace function public.orion_cred_marcar_alerta_global(
  p_percentual integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare alterado integer;
begin
  if p_percentual not in (60, 80, 90, 100) then return false; end if;
  execute format(
    'update public.orion_cred_global_config set alerta_%s_enviado_em = now(), updated_at = now() where id = 1 and alerta_%s_enviado_em is null and orcamento_criativos_usd > 0 and gasto_usd / orcamento_criativos_usd >= $1',
    p_percentual, p_percentual
  ) using p_percentual::numeric / 100;
  get diagnostics alterado = row_count;
  return alterado > 0;
end;
$$;

alter table public.criativo_assets
  drop constraint if exists criativo_assets_status_check;
update public.criativo_assets set status = 'pronto' where status = 'rascunho';
alter table public.criativo_assets
  add constraint criativo_assets_status_check
  check (status in ('pronto', 'em_aprovacao', 'aprovado', 'revisao', 'rodando'));

revoke all on function public.orion_cred_ajustar(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.orion_cred_transferir(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.orion_cred_adquirir_lock(uuid, text) from public, anon, authenticated;
revoke all on function public.orion_cred_liberar_lock(uuid, text) from public, anon, authenticated;
revoke all on function public.orion_cred_registrar_pedido(uuid, text) from public, anon, authenticated;
revoke all on function public.orion_cred_marcar_alerta_global(integer) from public, anon, authenticated;
grant execute on function public.orion_cred_ajustar(uuid, integer, uuid, text) to service_role;
grant execute on function public.orion_cred_transferir(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.orion_cred_adquirir_lock(uuid, text) to service_role;
grant execute on function public.orion_cred_liberar_lock(uuid, text) to service_role;
grant execute on function public.orion_cred_registrar_pedido(uuid, text) to service_role;
grant execute on function public.orion_cred_marcar_alerta_global(integer) to service_role;
