with ranked as (
  select
    id,
    lead_id,
    corretor_id,
    row_number() over (
      partition by lead_id, corretor_id
      order by coalesce(ultima_mensagem_at, updated_at, created_at) desc, created_at desc
    ) as rn,
    first_value(id) over (
      partition by lead_id, corretor_id
      order by coalesce(ultima_mensagem_at, updated_at, created_at) desc, created_at desc
    ) as keep_id
  from public.whatsapp_conversas
  where lead_id is not null
    and corretor_id is not null
),
duplicates as (
  select id, keep_id
  from ranked
  where rn > 1
)
update public.whatsapp_mensagens m
set conversa_id = d.keep_id
from duplicates d
where m.conversa_id = d.id;

with ranked as (
  select
    id,
    lead_id,
    corretor_id,
    row_number() over (
      partition by lead_id, corretor_id
      order by coalesce(ultima_mensagem_at, updated_at, created_at) desc, created_at desc
    ) as rn
  from public.whatsapp_conversas
  where lead_id is not null
    and corretor_id is not null
)
delete from public.whatsapp_conversas c
using ranked r
where c.id = r.id
  and r.rn > 1;

update public.whatsapp_conversas c
set ultima_mensagem_at = latest.last_message_at,
    updated_at = now()
from (
  select conversa_id, max(created_at) as last_message_at
  from public.whatsapp_mensagens
  group by conversa_id
) latest
where c.id = latest.conversa_id;
