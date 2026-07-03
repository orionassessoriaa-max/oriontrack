create table if not exists public.corretora_bot_configs (
  id uuid primary key default gen_random_uuid(),
  corretora_id uuid not null references public.corretoras(id) on delete cascade,
  nome text not null default 'Primeiro atendimento',
  trigger_key text not null default 'crm',
  primeira_mensagem text not null default 'Ola, {primeiro_nome}! Tudo bem?

Voce acabou de preencher nosso formulario para planos de saude.

Logo um de nossos especialistas entrara em contato para te ajudar.',
  fluxo jsonb not null default '[
    {"id":"trigger_crm","type":"trigger","label":"Gatilho CRM","description":"Quando o lead cair no CRM"},
    {"id":"message_first","type":"message","label":"Primeiro atendimento","description":"Envia a primeira mensagem ao lead"},
    {"id":"condition_response","type":"condition","label":"Resposta do lead","description":"True/false para continuar"},
    {"id":"notify_broker","type":"action","label":"Acionar corretor","description":"Chama o responsavel quando precisar de atendimento humano"}
  ]'::jsonb,
  status text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corretora_bot_configs_status_check check (status in ('ativo', 'inativo')),
  constraint corretora_bot_configs_trigger_check check (trigger_key in ('crm')),
  unique(corretora_id)
);

create index if not exists idx_corretora_bot_configs_corretora
  on public.corretora_bot_configs(corretora_id);

alter table public.corretora_bot_configs enable row level security;

drop policy if exists "Admins can manage bot configs" on public.corretora_bot_configs;
create policy "Admins can manage bot configs"
  on public.corretora_bot_configs
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.tipo_usuario = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.tipo_usuario = 'admin'
    )
  );

drop policy if exists "Authenticated can read bot configs" on public.corretora_bot_configs;
create policy "Authenticated can read bot configs"
  on public.corretora_bot_configs
  for select
  to authenticated
  using (true);

notify pgrst, 'reload schema';
