-- Centraliza a distribuicao de leads na concessionaria.
alter table public.corretoras
  add column if not exists distribuicao_modelo text not null default 'rodizio',
  add column if not exists distribuicao_publico text not null default 'todos';

-- Cadastros anteriores mantêm exatamente os participantes já definidos em
-- Meu Time. Novas concessionárias sempre enviam a escolha explícita da tela.
update public.corretoras
set distribuicao_publico = 'personalizado'
where distribuicao_publico = 'todos'
  and exists (
    select 1 from public.corretores c
    where lower(trim(coalesce(c.nome_empresa, ''))) = lower(trim(public.corretoras.nome))
  );

alter table public.corretoras
  drop constraint if exists corretoras_distribuicao_modelo_check;
alter table public.corretoras
  add constraint corretoras_distribuicao_modelo_check
  check (distribuicao_modelo in ('rodizio', 'fila_compartilhada'));

alter table public.corretoras
  drop constraint if exists corretoras_distribuicao_publico_check;
alter table public.corretoras
  add constraint corretoras_distribuicao_publico_check
  check (distribuicao_publico in ('todos', 'admins', 'integrantes', 'personalizado'));

create index if not exists corretoras_distribuicao_idx
  on public.corretoras (distribuicao_modelo, distribuicao_publico);

-- No modo compartilhado o lead permanece sem responsavel ate a primeira
-- resposta humana. No rodizio, escolhe o participante ha mais tempo sem lead.
create or replace function public.assign_lead_to_corretor_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_record public.corretor_times%rowtype;
  member_record record;
  broker_record record;
  distribution_model text := 'rodizio';
begin
  if new.corretor_id is null or new.responsavel_membro_id is not null or new.responsavel_profile_id is not null then
    return new;
  end if;

  select id, nome_empresa, coalesce(rodizio_ativo, true) as rodizio_ativo
    into broker_record
  from public.corretores
  where id = new.corretor_id;

  if broker_record.rodizio_ativo is false then
    return new;
  end if;

  if nullif(trim(coalesce(broker_record.nome_empresa, '')), '') is not null then
    select coalesce(c.distribuicao_modelo, 'rodizio')
      into distribution_model
    from public.corretoras c
    where lower(trim(c.nome)) = lower(trim(broker_record.nome_empresa))
    order by c.created_at asc
    limit 1;
  end if;

  if coalesce(distribution_model, 'rodizio') = 'fila_compartilhada' then
    return new;
  end if;

  select t.*
    into team_record
  from public.corretor_times t
  join public.corretores owner on owner.id = t.corretor_id
  where t.ativo = true
    and (
      t.corretor_id = new.corretor_id
      or (
        nullif(trim(coalesce(broker_record.nome_empresa, '')), '') is not null
        and lower(trim(coalesce(owner.nome_empresa, ''))) = lower(trim(broker_record.nome_empresa))
      )
    )
  order by owner.created_at asc, t.created_at asc
  limit 1;

  if not found then return new; end if;

  select m.id, m.profile_id
    into member_record
  from public.corretor_time_membros m
  where m.time_id = team_record.id
    and m.status in ('ativo', 'active', 'Ativo')
    and coalesce(m.participa_rodizio, true) = true
    and m.profile_id is not null
  order by m.ultimo_lead_at asc nulls first, m.ordem asc, m.created_at asc
  limit 1;

  if member_record.id is null then return new; end if;

  new.responsavel_membro_id := member_record.id;
  new.responsavel_profile_id := member_record.profile_id;

  update public.corretor_time_membros
  set ultimo_lead_at = now()
  where id = member_record.id;

  return new;
end;
$$;

-- Atribuicao atomica da fila compartilhada. Duas respostas simultaneas nunca
-- conseguem assumir o mesmo lead.
create or replace function public.claim_shared_lead(
  target_lead_id uuid,
  claimant_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_record record;
  claimant record;
  member_record record;
  distribution_model text;
begin
  select l.id, l.corretor_id, l.responsavel_profile_id, l.responsavel_membro_id,
         c.nome_empresa
    into lead_record
  from public.leads l
  join public.corretores c on c.id = l.corretor_id
  where l.id = target_lead_id
  for update of l;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'lead_not_found');
  end if;

  if lead_record.responsavel_profile_id is not null then
    return jsonb_build_object(
      'claimed', lead_record.responsavel_profile_id = claimant_profile_id,
      'reason', case when lead_record.responsavel_profile_id = claimant_profile_id then 'already_mine' else 'already_claimed' end,
      'responsavel_profile_id', lead_record.responsavel_profile_id
    );
  end if;

  select p.id, p.tipo_usuario, p.status
    into claimant
  from public.profiles p
  where p.id = claimant_profile_id
    and p.tipo_usuario in ('corretor', 'corretor_admin', 'corretor_membro')
    and p.status in ('active', 'ativo', 'Ativo');

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'profile_not_allowed');
  end if;

  select coalesce(cr.distribuicao_modelo, 'rodizio')
    into distribution_model
  from public.corretoras cr
  where lower(trim(cr.nome)) = lower(trim(coalesce(lead_record.nome_empresa, '')))
  limit 1;

  if coalesce(distribution_model, 'rodizio') <> 'fila_compartilhada' then
    return jsonb_build_object('claimed', false, 'reason', 'not_shared_queue');
  end if;

  select m.id, m.profile_id
    into member_record
  from public.corretor_time_membros m
  join public.corretor_times t on t.id = m.time_id and t.ativo = true
  join public.corretores owner on owner.id = t.corretor_id
  where m.profile_id = claimant_profile_id
    and m.status in ('active', 'ativo', 'Ativo')
    and coalesce(m.participa_rodizio, true) = true
    and (
      owner.id = lead_record.corretor_id
      or lower(trim(coalesce(owner.nome_empresa, ''))) = lower(trim(coalesce(lead_record.nome_empresa, '')))
    )
  order by owner.created_at asc, m.created_at asc
  limit 1;

  if member_record.id is null then
    return jsonb_build_object('claimed', false, 'reason', 'not_participant');
  end if;

  update public.leads
  set responsavel_membro_id = member_record.id,
      responsavel_profile_id = claimant_profile_id,
      updated_at = now()
  where id = target_lead_id
    and responsavel_profile_id is null;

  if not found then
    select responsavel_profile_id into lead_record.responsavel_profile_id
    from public.leads where id = target_lead_id;
    return jsonb_build_object(
      'claimed', false,
      'reason', 'already_claimed',
      'responsavel_profile_id', lead_record.responsavel_profile_id
    );
  end if;

  update public.corretor_time_membros
  set ultimo_lead_at = now()
  where id = member_record.id;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'claimed_now',
    'responsavel_profile_id', claimant_profile_id,
    'responsavel_membro_id', member_record.id
  );
end;
$$;

revoke all on function public.claim_shared_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_shared_lead(uuid, uuid) to service_role;

-- Integrantes leem somente seus leads e a fila compartilhada da qual participam.
-- Administradores mantem a capacidade de supervisao da concessionaria; a tela
-- inicia em "Meus leads" ou "Todos" conforme sua participacao.
create or replace function public.current_user_can_access_lead(
  target_corretor_id uuid,
  target_responsavel_profile_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.corretores lead_corretor on lead_corretor.id = target_corretor_id
    where p.id = auth.uid()
      and (
        p.tipo_usuario = 'admin'
        or (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and (
            target_corretor_id = p.corretor_id
            or (
              public.current_profile_brokerage_name() is not null
              and lower(public.current_profile_brokerage_name()) = lower(nullif(trim(coalesce(lead_corretor.nome_empresa, '')), ''))
            )
          )
        )
        or (
          p.tipo_usuario = 'corretor_membro'
          and (
            target_responsavel_profile_id = p.id
            or (
              target_responsavel_profile_id is null
              and exists (
                select 1
                from public.corretoras cr
                join public.corretor_times t on t.ativo = true
                join public.corretores owner on owner.id = t.corretor_id
                join public.corretor_time_membros m on m.time_id = t.id
                where lower(trim(cr.nome)) = lower(trim(coalesce(lead_corretor.nome_empresa, '')))
                  and cr.distribuicao_modelo = 'fila_compartilhada'
                  and lower(trim(coalesce(owner.nome_empresa, ''))) = lower(trim(coalesce(lead_corretor.nome_empresa, '')))
                  and m.profile_id = p.id
                  and m.status in ('active', 'ativo', 'Ativo')
                  and coalesce(m.participa_rodizio, true) = true
              )
            )
          )
        )
      )
  )
$$;

create or replace function public.current_user_can_update_lead(
  target_corretor_id uuid,
  target_responsavel_profile_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.corretores lead_corretor on lead_corretor.id = target_corretor_id
    where p.id = auth.uid()
      and (
        p.tipo_usuario = 'admin'
        or (
          p.tipo_usuario in ('corretor', 'corretor_admin')
          and (
            target_corretor_id = p.corretor_id
            or lower(public.current_profile_brokerage_name()) = lower(nullif(trim(coalesce(lead_corretor.nome_empresa, '')), ''))
          )
        )
        or (p.tipo_usuario = 'corretor_membro' and target_responsavel_profile_id = p.id)
      )
  )
$$;

drop policy if exists "Corretores can read own leads" on public.leads;
create policy "Corretores can read own leads"
on public.leads for select to authenticated
using (public.current_user_can_access_lead(leads.corretor_id, leads.responsavel_profile_id));

drop policy if exists "Corretores can update own leads" on public.leads;
create policy "Corretores can update own leads"
on public.leads for update to authenticated
using (public.current_user_can_update_lead(leads.corretor_id, leads.responsavel_profile_id))
with check (public.current_user_can_update_lead(leads.corretor_id, leads.responsavel_profile_id));
