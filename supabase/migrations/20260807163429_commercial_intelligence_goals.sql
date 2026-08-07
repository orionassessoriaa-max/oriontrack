alter table public.comercial_metas
  add column if not exists meta_vendas integer not null default 0,
  add column if not exists meta_calls integer not null default 0,
  add column if not exists ticket_medio numeric(14, 2) not null default 0;

comment on column public.comercial_metas.meta_vendas is 'Quantidade de vendas planejada para o mes comercial.';
comment on column public.comercial_metas.meta_calls is 'Quantidade de ligacoes planejada para o mes comercial.';
comment on column public.comercial_metas.ticket_medio is 'Ticket medio planejado para o mes comercial.';
