-- Somente a CONEXAO CORRETORA distribui novos leads pelo menor total
-- acumulado. As demais concessionarias preservam o rodizio configurado.
-- O desempate continua respeitando quem recebeu ha mais tempo e a ordem do
-- time. Leads ja atribuidos nao sao movidos.

create index if not exists leads_responsavel_corretor_idx
  on public.leads (responsavel_profile_id, corretor_id);

create or replace function public.assign_lead_to_corretor_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  broker_record record;
  brokerage_record record;
  team_record record;
  previous_owner record;
  route_record jsonb;
  member_record record;
  attribution_text text;
  distribution_model text := 'rodizio';
  normalized_company text := '';
begin
  if new.corretor_id is null or new.responsavel_membro_id is not null or new.responsavel_profile_id is not null then
    return new;
  end if;

  select id, nome_empresa, coalesce(rodizio_ativo, true) as rodizio_ativo
    into broker_record
  from public.corretores where id = new.corretor_id;

  if broker_record.rodizio_ativo is false then return new; end if;

  -- Reentrada em outra data: mantem o responsavel anterior antes de qualquer
  -- regra de segmento ou rodizio.
  select l.responsavel_profile_id, l.responsavel_membro_id
    into previous_owner
  from public.leads l
  where l.id <> coalesce(new.id, gen_random_uuid())
    and l.corretor_id = new.corretor_id
    and l.responsavel_profile_id is not null
    and regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g') <> ''
    and regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g') = regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g')
    and lower(trim(coalesce(l.nome, ''))) = lower(trim(coalesce(new.nome, '')))
    and coalesce(l.data_entrada::date, l.created_at::date) <> coalesce(new.data_entrada::date, now()::date)
  order by coalesce(l.data_entrada, l.created_at) desc
  limit 1;

  if previous_owner.responsavel_profile_id is not null then
    new.responsavel_profile_id := previous_owner.responsavel_profile_id;
    new.responsavel_membro_id := previous_owner.responsavel_membro_id;
    return new;
  end if;

  if nullif(trim(coalesce(broker_record.nome_empresa, '')), '') is not null then
    select cr.id, cr.distribuicao_modelo, cr.distribuicao_regras
      into brokerage_record
    from public.corretoras cr
    where lower(trim(cr.nome)) = lower(trim(broker_record.nome_empresa))
    order by cr.created_at asc limit 1;
    distribution_model := coalesce(brokerage_record.distribuicao_modelo, 'rodizio');
  end if;

  if distribution_model = 'fila_compartilhada' then return new; end if;

  select t.* into team_record
  from public.corretor_times t
  join public.corretores owner on owner.id = t.corretor_id
  where t.ativo = true and (
    t.corretor_id = new.corretor_id
    or lower(trim(coalesce(owner.nome_empresa, ''))) = lower(trim(coalesce(broker_record.nome_empresa, '')))
  )
  order by owner.created_at asc, t.created_at asc limit 1;
  if not found then return new; end if;

  normalized_company := regexp_replace(
    translate(
      lower(trim(coalesce(broker_record.nome_empresa, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '\s+',
    ' ',
    'g'
  );

  if normalized_company = 'conexao corretora' then
    -- Serializa apenas a decisao da Conexao. Assim dois leads simultaneos nao
    -- escolhem o mesmo participante usando a mesma contagem.
    perform pg_advisory_xact_lock(hashtext('orion:conexao:lead-distribution'));
    perform 1
    from public.corretor_times
    where id = team_record.id
    for update;

    select m.id, m.profile_id into member_record
    from public.corretor_time_membros m
    where m.time_id = team_record.id
      and m.status in ('ativo', 'active', 'Ativo')
      and coalesce(m.participa_rodizio, true)
      and m.profile_id is not null
    order by (
      select count(*)
      from public.leads assigned
      join public.corretores assigned_broker on assigned_broker.id = assigned.corretor_id
      where assigned.responsavel_profile_id = m.profile_id
        and lower(trim(coalesce(assigned_broker.nome_empresa, ''))) = lower(trim(broker_record.nome_empresa))
    ) asc,
    m.ultimo_lead_at asc nulls first,
    m.ordem asc,
    m.created_at asc
    limit 1;
  else
    attribution_text := lower(concat_ws(' ', new.utm_campaign, new.utm_term, new.utm_content, new.operadora));

    if jsonb_array_length(coalesce(brokerage_record.distribuicao_regras, '[]'::jsonb)) > 0 then
      select rule into route_record
      from jsonb_array_elements(brokerage_record.distribuicao_regras) rule
      where coalesce((rule->>'ativo')::boolean, true)
        and (
          coalesce((rule->>'fallback')::boolean, false)
          or exists (
            select 1 from jsonb_array_elements_text(coalesce(rule->'termos', '[]'::jsonb)) term
            where attribution_text like '%' || lower(term) || '%'
          )
        )
      order by coalesce((rule->>'fallback')::boolean, false), coalesce((rule->>'prioridade')::int, 100)
      limit 1;
    end if;

    if route_record is not null and jsonb_array_length(coalesce(route_record->'membros', '[]'::jsonb)) > 0 then
      -- Menor quantidade proporcional ao peso: produz 2:1, 3:1 etc. sem
      -- depender de memoria em processo e continua correto apos reinicio.
      select m.id, m.profile_id into member_record
      from public.corretor_time_membros m
      join lateral (
        select greatest(coalesce((x->>'peso')::numeric, 1), 1) as peso
        from jsonb_array_elements(route_record->'membros') x
        where x->>'profile_id' = m.profile_id::text
        limit 1
      ) route_member on true
      where m.time_id = team_record.id
        and m.status in ('ativo', 'active', 'Ativo')
        and coalesce(m.participa_rodizio, true)
        and m.profile_id is not null
      order by (
        select count(*)::numeric / route_member.peso
        from public.leads assigned
        where assigned.responsavel_profile_id = m.profile_id
          and assigned.corretor_id = new.corretor_id
          and assigned.created_at >= now() - interval '90 days'
      ) asc, m.ultimo_lead_at asc nulls first, m.ordem asc
      limit 1;
    else
      select m.id, m.profile_id into member_record
      from public.corretor_time_membros m
      where m.time_id = team_record.id
        and m.status in ('ativo', 'active', 'Ativo')
        and coalesce(m.participa_rodizio, true)
        and m.profile_id is not null
      order by m.ultimo_lead_at asc nulls first, m.ordem asc, m.created_at asc
      limit 1;
    end if;
  end if;

  if member_record.id is null then return new; end if;
  new.responsavel_membro_id := member_record.id;
  new.responsavel_profile_id := member_record.profile_id;
  update public.corretor_time_membros set ultimo_lead_at = now() where id = member_record.id;
  return new;
end;
$$;
