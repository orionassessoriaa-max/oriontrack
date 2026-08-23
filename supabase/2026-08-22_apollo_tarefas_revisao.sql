-- Acompanhamento das tarefas do time Apollo.
--
-- iniciada_em guarda quando a tarefa entrou em "fazendo" pela primeira vez. E
-- com ela que sai a duracao da entrega no aviso de conclusao: sem isso o unico
-- horario disponivel era o da criacao, que inclui o tempo em que a tarefa ficou
-- parada na fila.
alter table public.apollo_tasks
  add column if not exists iniciada_em timestamptz;

comment on column public.apollo_tasks.iniciada_em is
  'Primeira vez que a tarefa foi movida para fazendo. Base da duracao da entrega.';

-- Quem pediu a tarefa pode devolver com uma revisao em vez de reabrir no
-- escuro. Fica o historico: cada pedido de revisao vira uma linha.
create table if not exists public.apollo_task_revisoes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.apollo_tasks(id) on delete cascade,
  autor_profile_id uuid references public.profiles(id) on delete set null,
  titulo text not null,
  comentario text,
  created_at timestamptz not null default now()
);

create index if not exists apollo_task_revisoes_task_idx
  on public.apollo_task_revisoes(task_id, created_at desc);

alter table public.apollo_task_revisoes enable row level security;
revoke all on table public.apollo_task_revisoes from anon, authenticated;
grant select, insert, update, delete on table public.apollo_task_revisoes to service_role;

notify pgrst, 'reload schema';
