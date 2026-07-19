alter table public.corretora_ai_configs
  add column if not exists sender_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists corretora_ai_configs_sender_profile_idx
  on public.corretora_ai_configs(sender_profile_id);
