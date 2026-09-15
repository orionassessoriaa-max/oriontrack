-- Presenca recente no Orion Track. Um usuario fica "ativo agora" enquanto o
-- navegador visivel envia atualizacoes periodicas de atividade.
alter table public.profiles
  add column if not exists last_active_at timestamptz;

create index if not exists profiles_last_active_at_idx
  on public.profiles (last_active_at desc);

notify pgrst, 'reload schema';
