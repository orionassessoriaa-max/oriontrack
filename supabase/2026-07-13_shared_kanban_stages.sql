alter table public.corretores
  add column if not exists kanban_etapas jsonb not null default '[]'::jsonb;

alter table public.leads
  add column if not exists conta_como_venda boolean not null default false;

update public.leads
set conta_como_venda = (status = 'Venda realizada');

update public.corretores
set kanban_etapas = '[
  {"id":"Aguardando atendimento","label":"Oportunidade","desc":"Entrou e precisa de primeiro contato"},
  {"id":"Inicio","label":"Início","desc":"Primeira abordagem realizada"},
  {"id":"Contato feito","label":"Contato feito","desc":"Em atendimento"},
  {"id":"Cotação enviada","label":"Cotação enviada","desc":"Proposta enviada ao lead"},
  {"id":"Em negociação","label":"Em negociação","desc":"Acompanhamento comercial ativo"},
  {"id":"Não tive retorno","label":"Sem retorno","desc":"Precisa de nova tentativa"},
  {"id":"Venda realizada","label":"Venda realizada","desc":"Conversão concluída","saleEquivalent":true},
  {"id":"DOCUMENTAÇÃO","label":"IMPLANTAÇÃO","desc":"Venda em implantação","saleEquivalent":true},
  {"id":"1º PAGAMENTO","label":"1º PAGAMENTO","desc":"Aguardando o primeiro pagamento","saleEquivalent":true},
  {"id":"Sem interesse","label":"Sem interesse","desc":"Descartado comercialmente"}
]'::jsonb
where id = '25c175c6-4bfc-41cd-8735-10fe91c53fe2';

update public.leads
set conta_como_venda = true
where corretor_id = '25c175c6-4bfc-41cd-8735-10fe91c53fe2'
  and status in ('Venda realizada', 'DOCUMENTAÇÃO', '1º PAGAMENTO');
