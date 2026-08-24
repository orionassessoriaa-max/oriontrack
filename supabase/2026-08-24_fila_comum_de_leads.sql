-- Fila comum de leads.
--
-- O lead novo deixa de ter dono na entrada: fica na fila, todos os SDRs veem, e
-- quem apertar Start primeiro fica com ele. So o nivel com dono fixo escapa,
-- que hoje e o S do Leo.
--
-- A politica antiga dizia que SDR so enxerga lead onde ele e o responsavel.
-- Sem esta mudanca a fila seria invisivel e ninguem teria o que assumir.
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
        or (cm.papel = 'sdr' and (comercial_leads.sdr_id = auth.uid() or comercial_leads.sdr_id is null))
      )
  )
);

notify pgrst, 'reload schema';

select count(*) filter (where sdr_id is null) as na_fila,
       count(*) filter (where sdr_id is not null) as com_dono
from public.comercial_leads;
