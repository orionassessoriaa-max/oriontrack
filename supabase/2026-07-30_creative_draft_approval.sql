alter table public.criativo_assets
  drop constraint if exists criativo_assets_status_check;

alter table public.criativo_assets
  add constraint criativo_assets_status_check
  check (status in ('rascunho', 'em_aprovacao', 'aprovado', 'revisao', 'rodando'));

alter table public.criativo_assets
  alter column status set default 'rascunho';
