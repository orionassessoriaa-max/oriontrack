alter table public.corretora_bot_configs
  add column if not exists sender_mode text not null default 'automatic',
  add column if not exists sender_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists dedicated_instance_name text;

alter table public.corretora_bot_configs
  drop constraint if exists corretora_bot_configs_sender_mode_check;

alter table public.corretora_bot_configs
  add constraint corretora_bot_configs_sender_mode_check
  check (sender_mode in ('automatic', 'profile', 'dedicated'));

create index if not exists corretora_bot_configs_sender_profile_idx
  on public.corretora_bot_configs (sender_profile_id)
  where sender_profile_id is not null;

comment on column public.corretora_bot_configs.sender_mode is
  'automatic preserva bots legados; profile usa o WhatsApp do Inbox; dedicated usa a instancia exclusiva da pagina IA.';
