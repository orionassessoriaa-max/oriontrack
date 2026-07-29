-- Distribuicao atomica dos leads do Kripto Hunter entre os SDRs habilitados.
-- A coluna proximo_sdr_id guarda quem recebera o proximo lead e a funcao
-- avanca a fila dentro do mesmo lock, evitando dois leads para o mesmo SDR
-- quando webhooks chegam simultaneamente.

alter table if exists public.comercial_membros
  add column if not exists distribuicao_ativa boolean not null default true;

alter table if exists public.comercial_config
  add column if not exists distribuicao_automatica_ativa boolean not null default true;

alter table if exists public.comercial_config
  add column if not exists proximo_sdr_id uuid references public.profiles(id) on delete set null;

update public.comercial_membros
set distribuicao_ativa = false
where papel <> 'sdr';

create or replace function public.assign_next_commercial_sdr()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  automatic_enabled boolean;
  configured_next uuid;
  eligible uuid[];
  selected_sdr uuid;
  selected_position integer;
  following_sdr uuid;
begin
  insert into public.comercial_config (id)
  values (1)
  on conflict (id) do nothing;

  select
    coalesce(distribuicao_automatica_ativa, true),
    proximo_sdr_id
  into automatic_enabled, configured_next
  from public.comercial_config
  where id = 1
  for update;

  if automatic_enabled is not true then
    return null;
  end if;

  select array_agg(cm.profile_id order by cm.created_at, cm.profile_id)
  into eligible
  from public.comercial_membros cm
  join public.profiles p on p.id = cm.profile_id
  where cm.papel = 'sdr'
    and cm.ativo = true
    and cm.distribuicao_ativa = true
    and lower(coalesce(p.status, 'active')) in ('active', 'ativo');

  if eligible is null or array_length(eligible, 1) is null then
    update public.comercial_config
    set proximo_sdr_id = null, updated_at = now()
    where id = 1;
    return null;
  end if;

  selected_position := array_position(eligible, configured_next);
  if selected_position is null then
    selected_position := 1;
  end if;

  selected_sdr := eligible[selected_position];
  following_sdr := eligible[(selected_position % array_length(eligible, 1)) + 1];

  update public.comercial_config
  set proximo_sdr_id = following_sdr, updated_at = now()
  where id = 1;

  return selected_sdr;
end;
$$;

revoke all on function public.assign_next_commercial_sdr() from public;
grant execute on function public.assign_next_commercial_sdr() to service_role;

drop policy if exists comercial_leads_read on public.comercial_leads;
create policy comercial_leads_read on public.comercial_leads for select using (
  public.is_admin()
  or exists (
    select 1
    from public.comercial_membros cm
    where cm.profile_id = auth.uid()
      and cm.ativo = true
      and (
        cm.papel in ('coordenador', 'closer')
        or (cm.papel = 'sdr' and comercial_leads.sdr_id = auth.uid())
      )
  )
);

notify pgrst, 'reload schema';
