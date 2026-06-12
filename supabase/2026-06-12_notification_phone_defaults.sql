update public.profiles p
set telefone = c.telefone
from public.corretores c
where p.corretor_id = c.id
  and nullif(trim(coalesce(p.telefone, '')), '') is null
  and nullif(trim(coalesce(c.telefone, '')), '') is not null;

insert into public.notificacao_preferencias (
  profile_id,
  whatsapp_enabled,
  telefone,
  tipos,
  created_at,
  updated_at
)
select
  p.id,
  false,
  p.telefone,
  '{}'::jsonb,
  now(),
  now()
from public.profiles p
where nullif(trim(coalesce(p.telefone, '')), '') is not null
on conflict (profile_id) do update
set telefone = excluded.telefone,
    updated_at = now()
where nullif(trim(coalesce(public.notificacao_preferencias.telefone, '')), '') is null;
