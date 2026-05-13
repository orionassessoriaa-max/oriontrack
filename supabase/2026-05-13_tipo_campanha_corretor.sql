alter table public.corretores
add column if not exists tipo_campanha text not null default 'ambos'
check (tipo_campanha in ('pme', 'adesao', 'ambos'));
