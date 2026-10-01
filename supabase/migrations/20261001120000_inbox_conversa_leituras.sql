-- Marcacao de leitura por conversa e por pessoa.
--
-- Ate agora o "nao lida" do Inbox vivia no localStorage do navegador e so era
-- escrito quando a mensagem chegava pelo Realtime com a tela aberta. Quem
-- fechava o CRM nao via nada marcado ao voltar, e quem trocava de computador
-- comecava do zero. Era a reclamacao da Unity: lead manda mensagem e ninguem
-- percebe.
--
-- Com esta tabela o nao lido passa a ser derivado do dado: conta-se quantas
-- mensagens recebidas chegaram DEPOIS do ultimo momento em que aquela pessoa
-- abriu aquela conversa.

create table if not exists public.inbox_conversa_leituras (
  conversa_id uuid not null references public.whatsapp_conversas(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  lido_ate timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversa_id, profile_id)
);

-- A consulta do Inbox busca sempre "as leituras desta pessoa nestas conversas".
create index if not exists inbox_conversa_leituras_profile_idx
  on public.inbox_conversa_leituras (profile_id, conversa_id);

-- A contagem pergunta "mensagens recebidas desta conversa depois de X".
create index if not exists whatsapp_mensagens_conversa_entrada_idx
  on public.whatsapp_mensagens (conversa_id, created_at)
  where direction = 'inbound';

alter table public.inbox_conversa_leituras enable row level security;

-- O acesso do Inbox passa pelo service role na API, que ja aplica as regras de
-- quem ve qual conversa. A policy abaixo cobre o caso de leitura direta pelo
-- cliente autenticado: cada pessoa so enxerga as proprias marcacoes.
drop policy if exists "leituras proprias" on public.inbox_conversa_leituras;
create policy "leituras proprias" on public.inbox_conversa_leituras
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

comment on table public.inbox_conversa_leituras is
  'Ate quando cada pessoa leu cada conversa do Inbox. Base do contador de nao lidas.';
