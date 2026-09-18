-- Restaura o rodizio automatico dos leads Kripto entre Talita e Carlos (Kadu).
-- A funcao assign_next_commercial_sdr ja usa lock em comercial_config, portanto
-- duas entradas simultaneas continuam alternando de forma atomica.

update public.comercial_membros
set distribuicao_ativa = false,
    updated_at = now()
where distribuicao_ativa is distinct from false;

update public.comercial_membros cm
set distribuicao_ativa = true,
    recebe_apenas_mql = null,
    updated_at = now()
from public.profiles p
where p.id = cm.profile_id
  and cm.ativo = true
  and cm.papel = 'sdr'
  and (
    lower(trim(p.nome)) like '%talita%'
    or lower(trim(p.nome)) like '%carlos eduardo%'
  );

insert into public.comercial_config (id, distribuicao_automatica_ativa, proximo_sdr_id)
values (
  1,
  true,
  (
    select cm.profile_id
    from public.comercial_membros cm
    join public.profiles p on p.id = cm.profile_id
    where cm.ativo = true
      and cm.papel = 'sdr'
      and cm.distribuicao_ativa = true
    order by case when lower(p.nome) like '%talita%' then 0 else 1 end,
             cm.created_at,
             cm.profile_id
    limit 1
  )
)
on conflict (id) do update
set distribuicao_automatica_ativa = true,
    proximo_sdr_id = excluded.proximo_sdr_id,
    updated_at = now();

do $$
declare
  eligible_count integer;
begin
  select count(*)
  into eligible_count
  from public.comercial_membros
  where ativo = true
    and papel = 'sdr'
    and distribuicao_ativa = true;

  if eligible_count <> 2 then
    raise exception 'O rodizio Kripto precisa encontrar exatamente Talita e Carlos Eduardo; encontrou % SDR(s).', eligible_count;
  end if;

end;
$$;

notify pgrst, 'reload schema';
