-- O alerta de rastreio quebrado depende do ultimo lead Orion real da conta.
-- Retornar o agregado no banco evita baixar milhares de leads para a API.
create or replace function public.get_corretores_rastreio_orion(
  p_corretor_ids uuid[]
)
returns table (
  corretor_id uuid,
  ultimo_lead_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.corretor_id,
    max(l.data_entrada) as ultimo_lead_at
  from public.leads l
  where l.corretor_id = any(p_corretor_ids)
    and lower(btrim(l.origem)) = 'orion'
  group by l.corretor_id;
$$;

revoke all on function public.get_corretores_rastreio_orion(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_corretores_rastreio_orion(uuid[])
  to service_role;
