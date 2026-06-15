alter table public.leads
  add column if not exists cnpj text;

comment on column public.leads.cnpj is 'Numero do CNPJ informado pelo cliente, separado do campo possui_cnpj.';
