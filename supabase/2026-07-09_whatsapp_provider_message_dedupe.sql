with ranked as (
  select
    id,
    row_number() over (
      partition by conversa_id, provider_message_id
      order by created_at asc, id asc
    ) as rn
  from public.whatsapp_mensagens
  where provider_message_id is not null
    and provider_message_id <> ''
)
delete from public.whatsapp_mensagens m
using ranked r
where m.id = r.id
  and r.rn > 1;

create unique index if not exists whatsapp_mensagens_conversa_provider_message_uidx
on public.whatsapp_mensagens (conversa_id, provider_message_id)
where provider_message_id is not null
  and provider_message_id <> '';
