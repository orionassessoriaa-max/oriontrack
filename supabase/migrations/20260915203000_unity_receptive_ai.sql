-- Atendimento receptivo: conversas que chegam ao WhatsApp sem formulario
-- continuam no Inbox e so viram lead quando a origem for anuncio.
alter table public.corretora_ai_configs
  add column if not exists receptive_enabled boolean not null default false;

create table if not exists public.whatsapp_receptive_sessions (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null unique references public.whatsapp_conversas(id) on delete cascade,
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  telefone text not null,
  origem text,
  state text not null default 'origin_pending',
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_receptive_sessions_corretor_phone_idx
  on public.whatsapp_receptive_sessions (corretor_id, telefone);

update public.corretora_ai_configs config
set receptive_enabled = true,
    updated_at = now()
from public.corretoras corretora
where config.corretora_id = corretora.id
  and (corretora.nome ilike 'UNITY SAÚDE' or corretora.nome ilike 'UNITY SAUDE');

notify pgrst, 'reload schema';
