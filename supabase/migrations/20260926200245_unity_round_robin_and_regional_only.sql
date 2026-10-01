-- A Unity distribui um lead por vez para cada vendedor ativo, preservando a
-- ordem justa mantida por ultimo_lead_at.
do $$
declare
  unity_config_id uuid := '8923837e-36e9-4eb6-888a-1f4cf2ca42ac';
  unity_team_id uuid := 'e35aac40-f0ba-44f4-929d-231135f0d84e';
  active_participants integer;
begin
  select count(*) into active_participants
  from public.corretor_time_membros member
  join public.profiles profile on profile.id = member.profile_id
  where member.time_id = unity_team_id
    and member.status in ('active', 'ativo', 'Ativo')
    and profile.status in ('active', 'ativo', 'Ativo')
    and coalesce(member.participa_rodizio, true) = true;

  if active_participants = 0 then
    raise exception 'O rodizio da Unity precisa de ao menos um vendedor ativo.';
  end if;

  update public.corretoras
  set distribuicao_modelo = 'rodizio',
      updated_at = now()
  where id = unity_config_id
    and lower(trim(nome)) = lower('UNITY SAÚDE');

  if not found then
    raise exception 'A configuracao esperada da Unity nao foi encontrada.';
  end if;
end;
$$;

-- A cobertura regional e uma regra fixa da Unity. Retirar a pergunta do
-- prompt reduz ambiguidade, enquanto a protecao no codigo bloqueia regressao.
update public.corretora_ai_configs
set system_prompt = regexp_replace(
      system_prompt,
      E'(?im)^\\s*-?\\s*(cobertura\\s+)?nacional\\s+ou\\s+regional\\s*\\?\\s*$',
      '',
      'g'
    ),
    updated_at = now()
where corretora_id = '8923837e-36e9-4eb6-888a-1f4cf2ca42ac';
