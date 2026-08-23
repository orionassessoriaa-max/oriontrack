-- Checklist dentro da tarefa do Apollo.
--
-- Serve para as predefinicoes: "Criar funil {nome}" ja nasce com funil
-- respondido, planilha e n8n para marcar. Sem isso cada etapa viraria uma
-- tarefa solta no quadro, e o quadro deixaria de mostrar o trabalho de verdade.
create table if not exists public.apollo_task_itens (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.apollo_tasks(id) on delete cascade,
  ordem int not null default 0,
  titulo text not null,
  concluido boolean not null default false,
  concluido_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists apollo_task_itens_task_idx
  on public.apollo_task_itens(task_id, ordem);

alter table public.apollo_task_itens enable row level security;
revoke all on table public.apollo_task_itens from anon, authenticated;
grant select, insert, update, delete on table public.apollo_task_itens to service_role;

-- De qual predefinicao a tarefa nasceu. Fica registrado para depois dar para
-- medir quanto tempo leva cada tipo de demanda.
alter table public.apollo_tasks
  add column if not exists predefinicao text;

comment on column public.apollo_tasks.predefinicao is
  'Chave da predefinicao que gerou a tarefa: criar_funil, editar_video, ajuste_crm.';

notify pgrst, 'reload schema';
