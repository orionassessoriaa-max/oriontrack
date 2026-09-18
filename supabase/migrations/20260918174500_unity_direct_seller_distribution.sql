-- A Unity pausou a operacao de SDR temporariamente. Novos leads passam a ser
-- distribuidos diretamente entre os vendedores ativos, com peso igual.
-- Ana Julia permanece cadastrada para ser reativada como SDR posteriormente.

do $$
declare
  unity_team_id uuid := 'e35aac40-f0ba-44f4-929d-231135f0d84e';
  ana_profile_id uuid := '7a7fde6f-f36f-4334-a20a-96972d7388ea';
  seller_profile_ids uuid[] := array[
    '12578c22-5e28-47a0-bdef-7d9d62454f0d'::uuid, -- Claudecy Neres
    '118df9d4-c802-4139-98de-a5580cbb057a'::uuid, -- Alexandre Andrade
    '2e7a3193-3e76-46c8-a673-81c5cebf95c2'::uuid, -- Afonso Batista
    '882803f8-ba57-4c66-9ac1-114c81f9eac8'::uuid, -- Ullisses
    'df2b79ae-9810-417c-b5e0-3183f5feeff1'::uuid, -- Geovani Souza
    'dc17abf8-1db9-40a3-b391-0623b3d90831'::uuid, -- Afonso Neto
    '3eff01c8-b7bb-42ba-9fdd-3e830574ce62'::uuid, -- Melina Meira
    '45fed43d-c0ed-41f6-a4a9-c6fa335bf7d2'::uuid  -- Mariana
  ];
  seller_count integer;
begin
  select count(*) into seller_count
  from public.corretor_time_membros
  where time_id = unity_team_id
    and profile_id = any(seller_profile_ids)
    and status in ('ativo', 'active', 'Ativo');

  if seller_count <> cardinality(seller_profile_ids) then
    raise exception 'O rodizio direto da Unity esperava % vendedores ativos e encontrou %.', cardinality(seller_profile_ids), seller_count;
  end if;

  update public.corretor_time_membros
  set participa_rodizio = profile_id = any(seller_profile_ids),
      updated_at = now()
  where time_id = unity_team_id;

  update public.corretoras
  set distribuicao_modelo = 'rodizio',
      distribuicao_publico = 'personalizado',
      distribuicao_regras = jsonb_build_array(jsonb_build_object(
        'id', 'vendedores-unity',
        'nome', 'Distribuicao direta Unity',
        'ativo', true,
        'termos', '[]'::jsonb,
        'membros', (
          select jsonb_agg(
            jsonb_build_object('peso', 1, 'profile_id', member.profile_id)
            order by member.ordem, member.created_at
          )
          from public.corretor_time_membros member
          where member.time_id = unity_team_id
            and member.profile_id = any(seller_profile_ids)
        ),
        'fallback', true,
        'prioridade', 1
      )),
      updated_at = now()
  where id = '8923837e-36e9-4eb6-888a-1f4cf2ca42ac';

  -- Os leads ainda abertos que estavam na fila da SDR entram no mesmo rodizio
  -- dos vendedores. Cada linha recebe um vendedor diferente antes de repetir.
  with sellers as (
    select id, profile_id, row_number() over (order by ordem, created_at) as position
    from public.corretor_time_membros
    where time_id = unity_team_id
      and profile_id = any(seller_profile_ids)
  ), pending as (
    select id, row_number() over (order by coalesce(data_entrada, created_at), id) as position
    from public.leads
    where corretor_id = 'a861c65e-e124-48ba-b578-5b23c59a8b94'
      and responsavel_profile_id = ana_profile_id
      and status = 'Oportunidade'
  )
  update public.leads lead
  set responsavel_membro_id = sellers.id,
      responsavel_profile_id = sellers.profile_id,
      updated_at = now()
  from pending
  join sellers
    on sellers.position = ((pending.position - 1) % cardinality(seller_profile_ids)) + 1
  where lead.id = pending.id;
end;
$$;
