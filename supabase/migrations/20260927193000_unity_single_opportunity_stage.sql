-- A etapa oficial usa o identificador historico "Aguardando atendimento".
-- Consolidar o alias evita duas colunas com o mesmo nome no funil da Unity.
update public.leads
set status = 'Aguardando atendimento'
where corretor_id = 'a861c65e-e124-48ba-b578-5b23c59a8b94'
  and status = 'Oportunidade';

update public.corretores
set kanban_etapas = (
  select coalesce(jsonb_agg(stage order by ordinal), '[]'::jsonb)
  from jsonb_array_elements(kanban_etapas) with ordinality as entries(stage, ordinal)
  where stage ->> 'id' <> 'Oportunidade'
)
where id = 'a861c65e-e124-48ba-b578-5b23c59a8b94'
  and upper(translate(trim(nome_empresa), 'ÁÀÃÂÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC')) = 'UNITY SAUDE';
