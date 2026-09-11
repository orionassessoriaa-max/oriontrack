-- Receita, vendas e conversao passam a ser editaveis pelo coordenador na tela
-- de Metas. A meta de 100 ligacoes por SDR e o teto de 20% de no-show
-- continuam fixos no codigo: sao combinado de time, nao numero de planejamento.
--
-- ORDEM: aplicar este SQL ANTES do deploy.
--   1. O POST novo grava meta_conversao. Codigo novo sem a coluna quebra o save.
--   2. A semente evita o telao piscar: durante o rolling deploy a replica velha
--      responde com a constante e a nova com o banco. Com a linha semeada nos
--      mesmos numeros, as duas respondem igual.
--   3. O caminho inverso e inofensivo: a rota velha da Overview nem consulta
--      esta tabela, e o GET usa select('*').

-- not null default 0 de proposito: o POST da replica velha faz upsert sem citar
-- meta_conversao. Sem default, esse insert quebraria durante a janela de deploy
-- e o coordenador perderia a tela de metas. add column com default e
-- metadata-only no Postgres 11+, sem rewrite nem lock longo.
alter table public.comercial_metas
  add column if not exists meta_conversao numeric(5,2) not null default 0;

comment on column public.comercial_metas.meta_conversao is
  'Meta de conversao em % do mes comercial. Zero significa usar o padrao do codigo.';

-- Semente do mes corrente com os numeros que hoje estao fixos em
-- src/app/api/overview/route.ts. O case when > 0 preserva o que o coordenador
-- ja definiu: em 11/09/2026 setembro ja estava com meta_valor 185000, entao
-- essa linha nao altera a receita, so preenche vendas, ligacoes e conversao,
-- que estavam zeradas pelo bug do upsert destrutivo.
insert into public.comercial_metas (mes, meta_valor, meta_vendas, meta_calls, meta_conversao)
values (date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date, 185000, 25, 100, 40)
on conflict (mes) do update set
  meta_valor     = case when comercial_metas.meta_valor     > 0 then comercial_metas.meta_valor     else excluded.meta_valor     end,
  meta_vendas    = case when comercial_metas.meta_vendas    > 0 then comercial_metas.meta_vendas    else excluded.meta_vendas    end,
  meta_calls     = case when comercial_metas.meta_calls     > 0 then comercial_metas.meta_calls     else excluded.meta_calls     end,
  meta_conversao = case when comercial_metas.meta_conversao > 0 then comercial_metas.meta_conversao else excluded.meta_conversao end,
  updated_at = now();

notify pgrst, 'reload schema';
