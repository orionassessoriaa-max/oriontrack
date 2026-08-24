-- Leo entra no rodizio, mas so recebe lead S.
--
-- Ate aqui o rodizio olhava so o papel: quem nao era 'sdr' ficava de fora. O
-- Leo e closer e precisa continuar closer, entao a participacao passa a ser
-- governada por distribuicao_ativa, e a restricao de nivel vive em
-- recebe_apenas_mql. Nulo significa "recebe qualquer lead", como todos os SDRs.
alter table public.comercial_membros
  add column if not exists recebe_apenas_mql text;

alter table public.comercial_membros
  drop constraint if exists comercial_membros_recebe_apenas_mql_check;

alter table public.comercial_membros
  add constraint comercial_membros_recebe_apenas_mql_check
  check (recebe_apenas_mql is null or recebe_apenas_mql in ('S', 'A', 'B', 'C'));

comment on column public.comercial_membros.recebe_apenas_mql is
  'Nulo recebe qualquer lead. Com valor, o membro so entra no rodizio dos leads daquele nivel.';

-- A funcao antiga nao recebia parametro; a nova precisa saber o nivel do lead.
-- Duas versoes conviveriam como sobrecarga ambigua no PostgREST, entao a antiga
-- sai antes.
drop function if exists public.assign_next_commercial_sdr();

create or replace function public.assign_next_commercial_sdr(p_nivel text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  automatic_enabled boolean;
  configured_next uuid;
  eligible uuid[];
  selected_sdr uuid;
  selected_position integer;
  following_sdr uuid;
begin
  insert into public.comercial_config (id)
  values (1)
  on conflict (id) do nothing;

  select
    coalesce(distribuicao_automatica_ativa, true),
    proximo_sdr_id
  into automatic_enabled, configured_next
  from public.comercial_config
  where id = 1
  for update;

  if automatic_enabled is not true then
    return null;
  end if;

  select array_agg(cm.profile_id order by cm.created_at, cm.profile_id)
  into eligible
  from public.comercial_membros cm
  join public.profiles p on p.id = cm.profile_id
  where cm.ativo = true
    and cm.distribuicao_ativa = true
    and (cm.recebe_apenas_mql is null or cm.recebe_apenas_mql = p_nivel)
    and lower(coalesce(p.status, 'active')) in ('active', 'ativo');

  if eligible is null or array_length(eligible, 1) is null then
    update public.comercial_config
    set proximo_sdr_id = null, updated_at = now()
    where id = 1;
    return null;
  end if;

  selected_position := array_position(eligible, configured_next);
  if selected_position is null then
    selected_position := 1;
  end if;

  selected_sdr := eligible[selected_position];
  following_sdr := eligible[(selected_position % array_length(eligible, 1)) + 1];

  update public.comercial_config
  set proximo_sdr_id = following_sdr, updated_at = now()
  where id = 1;

  return selected_sdr;
end;
$$;

revoke all on function public.assign_next_commercial_sdr(text) from public;
grant execute on function public.assign_next_commercial_sdr(text) to service_role;

-- Leo assume os leads do Renan, que saiu do time.
update public.comercial_leads
set sdr_id = '97558b76-425a-42b7-900b-46830f2c28d3',
    updated_at = now()
where sdr_id = (
  select profile_id from public.comercial_membros cm
  join public.profiles p on p.id = cm.profile_id
  where p.nome ilike '%renan%' limit 1
);

-- Leo passa a receber lead S pelo rodizio, sem deixar de ser closer.
update public.comercial_membros
set distribuicao_ativa = true,
    recebe_apenas_mql = 'S'
where profile_id = '97558b76-425a-42b7-900b-46830f2c28d3';

-- Renan sai da fila de vez.
update public.comercial_membros cm
set ativo = false, distribuicao_ativa = false
from public.profiles p
where p.id = cm.profile_id and p.nome ilike '%renan%';

-- O WhatsApp que atende pelo Leo e o final 4328, ja conectado no inbox.
update public.profiles
set telefone = '(61)9575-4328'
where id = '97558b76-425a-42b7-900b-46830f2c28d3';

notify pgrst, 'reload schema';

select p.nome, cm.papel, cm.ativo, cm.distribuicao_ativa, cm.recebe_apenas_mql, p.telefone
from public.comercial_membros cm
join public.profiles p on p.id = cm.profile_id
order by cm.papel, p.nome;
