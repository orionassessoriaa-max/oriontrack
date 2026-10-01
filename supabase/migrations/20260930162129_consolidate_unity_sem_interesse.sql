-- A Unity recebeu duas etapas visualmente iguais porque os IDs diferiam apenas
-- na capitalizacao: "Sem Interesse" e "Sem interesse". O restante do CRM usa
-- "Sem interesse" como valor canonico em filtros, relatorios e encerramentos.

update public.leads
set status = 'Sem interesse'
where status = 'Sem Interesse'
  and corretor_id in (
    select id
    from public.corretores
    where nome_empresa = 'UNITY SAÚDE'
  );

with etapas_unity as (
  select
    c.id,
    item,
    ord,
    lower(btrim(coalesce(item->>'id', item->>'label', ''))) as chave,
    row_number() over (
      partition by c.id, lower(btrim(coalesce(item->>'id', item->>'label', '')))
      order by ord
    ) as ocorrencia
  from public.corretores c
  cross join lateral jsonb_array_elements(c.kanban_etapas) with ordinality as etapa(item, ord)
  where c.nome_empresa = 'UNITY SAÚDE'
), funil_consolidado as (
  select
    id,
    jsonb_agg(
      case
        when chave = 'sem interesse' then jsonb_build_object(
          'id', 'Sem interesse',
          'label', 'Sem interesse',
          'desc', 'Descartado comercialmente',
          'saleEquivalent', false
        )
        else item
      end
      order by ord
    ) filter (where chave <> 'sem interesse' or ocorrencia = 1) as etapas
  from etapas_unity
  group by id
)
update public.corretores c
set kanban_etapas = f.etapas
from funil_consolidado f
where c.id = f.id;
