-- Tudo que o admin faz na conta de uma corretora (apagar lead, mover card,
-- trocar as etapas) so aparecia para o corretor depois de um F5: as telas /crm
-- e /leads nao tinham nem realtime nem polling, e as tabelas nunca entraram na
-- publicacao. Teste de 21/08/2026: canal assinado, update disparado, nenhum
-- evento recebido em leads nem em corretores.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'corretores'
  ) then
    alter publication supabase_realtime add table public.corretores;
  end if;
end $$;

-- Sem replica identity full o evento de DELETE chega so com a chave primaria,
-- o filtro de RLS nao consegue avaliar a linha e o evento e descartado. Como a
-- queixa principal e justamente lead apagado que continua na tela do outro,
-- aqui isso e obrigatorio.
alter table public.leads replica identity full;

notify pgrst, 'reload schema';

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
