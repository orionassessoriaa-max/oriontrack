update public.whatsapp_conversas c
set nome_contato = l.nome,
    updated_at = now()
from public.leads l
where c.lead_id = l.id
  and nullif(trim(coalesce(l.nome, '')), '') is not null;
