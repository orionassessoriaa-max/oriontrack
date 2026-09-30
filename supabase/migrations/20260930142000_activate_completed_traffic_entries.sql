-- As entradas que ja estavam com os dados completos em 30/09/2026 tinham
-- campanhas em veiculacao. A partir desta mudanca, novas entradas so podem ser
-- salvas depois que o gestor confirmar que as campanhas estao ativas.
update public.corretores
set
  campanhas_ativas = true,
  onboarding_status = 'campanhas_ativas'
where onboarding_status = 'dados_completos';
