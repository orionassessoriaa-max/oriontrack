-- Liga o tempo real do inbox.
--
-- A tela ja assinava postgres_changes em whatsapp_mensagens e whatsapp_conversas
-- desde sempre, mas as tabelas nunca entraram na publicacao: o teste de
-- assinatura conecta (SUBSCRIBED) e nao recebe evento nenhum. Sem isso, o que
-- mantinha a conversa atualizada era pesquisa de 8 em 8 segundos por aba
-- aberta, e foi assim que o CRM chegou a 756 mil requisicoes em 24 horas.
--
-- Sem "replica identity full" de proposito: a assinatura de mensagens e so de
-- INSERT, e mandar a linha antiga inteira no WAL levaria junto a coluna
-- metadata a cada alteracao.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_mensagens'
  ) then
    alter publication supabase_realtime add table public.whatsapp_mensagens;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_conversas'
  ) then
    alter publication supabase_realtime add table public.whatsapp_conversas;
  end if;
end $$;

notify pgrst, 'reload schema';

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
