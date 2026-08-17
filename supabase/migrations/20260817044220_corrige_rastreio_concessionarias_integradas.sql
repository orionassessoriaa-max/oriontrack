-- O painel de trafego precisa saber se ao menos um corretor da concessionaria
-- ja recebeu lead Orion. A consulta antiga baixava no maximo 10.000 linhas e
-- podia omitir concessionarias quando a base crescia.
create index if not exists leads_corretor_orion_history_idx
  on public.leads (corretor_id)
  where lower(btrim(origem)) = 'orion';

create or replace function public.get_corretores_com_historico_orion(
  p_corretor_ids uuid[]
)
returns table (corretor_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct l.corretor_id
  from public.leads l
  where l.corretor_id = any(p_corretor_ids)
    and lower(btrim(l.origem)) = 'orion';
$$;

revoke all on function public.get_corretores_com_historico_orion(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_corretores_com_historico_orion(uuid[])
  to service_role;

-- As cinco concessionarias abaixo ja possuem leads Orion no CRM. Fixar o
-- status evita que uma falha temporaria da heuristica volte a apresenta-las
-- como se nunca tivessem sido integradas.
with integradas as (
  select
    c.id,
    min((l.data_entrada at time zone 'America/Sao_Paulo')::date) as primeiro_lead_orion
  from public.corretores c
  join public.leads l on l.corretor_id = c.id
  where lower(btrim(l.origem)) = 'orion'
    and upper(btrim(coalesce(c.nome_empresa, c.nome))) in (
      'CONEXAO CORRETORA',
      'CONEXÃO CORRETORA',
      'OASYS CORRETORA',
      'INOVARE PLANOS',
      'PAULO E SAULO CORRETORA',
      'WL CONSULTORIA'
    )
  group by c.id
)
update public.corretores c
set
  rastreio_status = 'automacao_ativa',
  rastreio_desde = coalesce(c.rastreio_desde, i.primeiro_lead_orion)
from integradas i
where c.id = i.id;

-- Todos os corretores do mesmo grupo compartilham a integracao da
-- concessionaria, mesmo que um deles ainda nao tenha recebido lead.
with grupos_integrados as (
  select
    upper(btrim(coalesce(c.nome_empresa, c.nome))) as grupo,
    min((l.data_entrada at time zone 'America/Sao_Paulo')::date) as primeiro_lead_orion
  from public.corretores c
  join public.leads l on l.corretor_id = c.id
  where lower(btrim(l.origem)) = 'orion'
    and upper(btrim(coalesce(c.nome_empresa, c.nome))) in (
      'CONEXAO CORRETORA',
      'CONEXÃO CORRETORA',
      'OASYS CORRETORA',
      'INOVARE PLANOS',
      'PAULO E SAULO CORRETORA',
      'WL CONSULTORIA'
    )
  group by upper(btrim(coalesce(c.nome_empresa, c.nome)))
)
update public.corretores c
set
  rastreio_status = 'automacao_ativa',
  rastreio_desde = coalesce(c.rastreio_desde, g.primeiro_lead_orion)
from grupos_integrados g
where upper(btrim(coalesce(c.nome_empresa, c.nome))) = g.grupo;
