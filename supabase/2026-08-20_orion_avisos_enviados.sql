-- Controle de avisos operacionais ja enviados, para o cron nao repetir a mesma
-- mensagem a cada rodada. A chave carrega o dia, entao o aviso sai uma vez por
-- dia enquanto a condicao continuar valendo.
create table if not exists public.orion_avisos_enviados (
  chave text primary key,
  enviado_em timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists orion_avisos_enviados_enviado_em_idx
  on public.orion_avisos_enviados (enviado_em desc);

alter table public.orion_avisos_enviados enable row level security;

-- Somente o service role escreve e le. Nenhum cliente precisa desta tabela.
drop policy if exists orion_avisos_enviados_admin_read on public.orion_avisos_enviados;
create policy orion_avisos_enviados_admin_read on public.orion_avisos_enviados
  for select using (public.is_admin());

notify pgrst, 'reload schema';
