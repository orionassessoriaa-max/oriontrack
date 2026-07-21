create table if not exists public.comercial_config (
  id integer primary key,
  etapas jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.comercial_config (id, etapas)
values (1, '[
  {"id":"Oportunidade","label":"Oportunidade","protected":true},
  {"id":"1º dia","label":"1º dia"},
  {"id":"Tentando contato","label":"Tentando contato"},
  {"id":"Plano de saúde","label":"Plano de saúde"},
  {"id":"Fora do ICP com recurso","label":"Fora do ICP com recurso"},
  {"id":"Dentro do ICP sem recurso","label":"Dentro do ICP sem recurso"},
  {"id":"Reuniões agendadas","label":"Reuniões agendadas"},
  {"id":"No-show","label":"No-show"},
  {"id":"Outros seguros","label":"Outros seguros"},
  {"id":"Fora do MQL","label":"Fora do MQL"},
  {"id":"Carrossel holandês","label":"Carrossel holandês"},
  {"id":"Follow TCV","label":"Follow TCV"},
  {"id":"Follow MRR","label":"Follow MRR"},
  {"id":"Stand-by","label":"Stand-by"},
  {"id":"Desqualificado","label":"Desqualificado"},
  {"id":"Perdido","label":"Perdido"},
  {"id":"Negócio fechado","label":"Negócio fechado","protected":true},
  {"id":"Em negociação","label":"Em negociação","protected":true},
  {"id":"Sem interesse","label":"Sem interesse","protected":true}
]'::jsonb)
on conflict (id) do nothing;
