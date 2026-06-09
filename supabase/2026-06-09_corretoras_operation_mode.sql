alter table public.corretoras
  add column if not exists modo_operacao text not null default 'individual';

alter table public.corretoras
  drop constraint if exists corretoras_modo_operacao_check;

alter table public.corretoras
  add constraint corretoras_modo_operacao_check
  check (modo_operacao in ('individual', 'grupo_rodizio', 'grupo_rodizio_admin'));

create index if not exists corretoras_modo_operacao_idx
on public.corretoras (modo_operacao);
