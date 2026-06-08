alter table public.leads
  add column if not exists comissao_percentual numeric(6,2);

update public.leads
set comissao_percentual = 2.5
where comissao_percentual is null
  and valor_negociacao is not null
  and valor_comissao is not null;
