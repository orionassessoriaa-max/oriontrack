-- Realtime para a sala imersiva do comercial.
--
-- Sem isso a sala continua funcionando, mas so atualiza pelo polling de 20s.
-- Com a publicacao ligada, o lead novo aparece na tela em menos de um segundo.
--
-- A politica de leitura de comercial_leads ja existente (admin, dono do lead ou
-- coordenador) continua valendo: o Realtime respeita RLS, entao cada usuario so
-- recebe evento dos leads que ja podia ler.
-- Cole este arquivo no SQL Editor do Supabase. O guard deixa rodar de novo sem
-- quebrar: `alter publication ... add table` puro daria erro se a tabela ja
-- estivesse na publicacao.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comercial_leads'
  ) then
    alter publication supabase_realtime add table public.comercial_leads;
  end if;
end $$;

-- Necessario para o payload de UPDATE trazer os campos usados na animacao de
-- chegada (status, sdr_id, telefone) e nao so a chave primaria.
alter table public.comercial_leads replica identity full;
