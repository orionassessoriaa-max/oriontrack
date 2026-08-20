alter table public.apollo_tasks
  add column if not exists descricao text not null default '',
  add column if not exists anexo_path text,
  add column if not exists anexo_nome text;

alter table public.apollo_tasks
  drop constraint if exists apollo_tasks_descricao_length_check;

alter table public.apollo_tasks
  add constraint apollo_tasks_descricao_length_check
  check (char_length(descricao) <= 4000);

comment on column public.apollo_tasks.descricao is
  'Detalhes e orientacoes da entrega.';

comment on column public.apollo_tasks.anexo_path is
  'Caminho privado do print no bucket apollo-task-assets.';
