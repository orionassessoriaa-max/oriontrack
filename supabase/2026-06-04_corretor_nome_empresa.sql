alter table public.corretores
  add column if not exists nome_empresa text;

update public.corretores c
set nome_empresa = p.nome_empresa
from public.profiles p
where p.corretor_id = c.id
  and p.tipo_usuario = 'corretor'
  and c.nome_empresa is null
  and p.nome_empresa is not null;
