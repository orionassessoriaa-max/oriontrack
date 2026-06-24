-- Migration: Permitir exclusao de atividades/anotacoes/ligacoes
DROP POLICY IF EXISTS "crm_lead_atividades_delete" ON public.lead_atividades;

CREATE POLICY "crm_lead_atividades_delete" ON public.lead_atividades
FOR DELETE USING (
  public.is_admin()
  OR profile_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_atividades.lead_id
    AND l.corretor_id = public.current_profile_corretor_id()
  )
);
