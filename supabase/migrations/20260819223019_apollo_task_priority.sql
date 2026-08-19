alter table public.apollo_tasks
  add column if not exists prioridade text not null default 'normal';

alter table public.apollo_tasks
  drop constraint if exists apollo_tasks_prioridade_check;

alter table public.apollo_tasks
  add constraint apollo_tasks_prioridade_check
  check (prioridade in ('baixa', 'normal', 'alta', 'urgente'));

create index if not exists apollo_tasks_status_prioridade_prazo_idx
  on public.apollo_tasks (status, prioridade, prazo);
