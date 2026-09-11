-- Liga o tempo real da tela Escritorio.
--
-- A tela precisa reagir na hora em que chega notificacao e em que a IA atende um
-- lead, mas a publicacao supabase_realtime so tem whatsapp_mensagens e
-- whatsapp_conversas desde agosto. Sem as duas tabelas aqui, a assinatura
-- conecta (SUBSCRIBED) e nao recebe evento nenhum, e a tela volta a depender de
-- pesquisa em intervalo por aba aberta.
--
-- Por que isso e seguro, em volume de escrita medido:
--   notificacoes ......... ~4 escritas por hora
--   lead_ai_sessions ..... ~1 escrita por hora
--   whatsapp_mensagens ... ~34 escritas por hora (ja esta na publicacao)
-- As duas tabelas novas juntas dao ~5 por hora, cerca de dez vezes menos WAL
-- que a tabela que ja esta publicada e rodando bem desde agosto.
--
-- Sem "replica identity full", igual no realtime do inbox: a tela so precisa
-- saber que chegou ou mudou a linha, nao a versao antiga dela.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes'
  ) then
    alter publication supabase_realtime add table public.notificacoes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_ai_sessions'
  ) then
    alter publication supabase_realtime add table public.lead_ai_sessions;
  end if;
end $$;

notify pgrst, 'reload schema';

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;

-- Rollback (aplicar na mao pelo SQL Editor se precisar desfazer):
--
-- do $$
-- begin
--   if exists (
--     select 1 from pg_publication_tables
--     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes'
--   ) then
--     alter publication supabase_realtime drop table public.notificacoes;
--   end if;
--
--   if exists (
--     select 1 from pg_publication_tables
--     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_ai_sessions'
--   ) then
--     alter publication supabase_realtime drop table public.lead_ai_sessions;
--   end if;
-- end $$;
--
-- notify pgrst, 'reload schema';
