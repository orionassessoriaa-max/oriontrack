alter table public.comercial_leads
  add column if not exists modelo_pagamento text,
  add column if not exists valor_pago numeric(14, 2),
  add column if not exists reuniao_link text,
  add column if not exists onboarding_briefing text,
  add column if not exists briefing_gerado_at timestamptz;

do $$
begin
  alter table public.comercial_leads
    add constraint comercial_leads_modelo_pagamento_check
    check (modelo_pagamento is null or modelo_pagamento in ('tcv', 'mrr', 'mesclado'));
exception
  when duplicate_object then null;
end $$;

update public.comercial_leads
set valor_pago = valor_fechado
where valor_pago is null
  and coalesce(valor_fechado, 0) > 0;

notify pgrst, 'reload schema';
