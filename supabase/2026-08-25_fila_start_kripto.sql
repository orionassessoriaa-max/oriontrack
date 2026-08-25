-- Fila START da Kripto Hunters.
--
-- O servidor mostra ao SDR somente um card anonimo para lead sem dono. A
-- politica direta do banco continua restrita ao dono para impedir que nome,
-- telefone ou faturamento sejam consultados antes de vencer a disputa.
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

-- Regra fixa: MQL S pertence ao Leo; qualquer outro nivel nasce sem SDR.
update public.comercial_membros
set distribuicao_ativa = true,
    recebe_apenas_mql = 'S',
    updated_at = now()
where profile_id = '97558b76-425a-42b7-900b-46830f2c28d3';

notify pgrst, 'reload schema';
