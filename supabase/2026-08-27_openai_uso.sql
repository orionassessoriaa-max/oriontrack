-- Contabilidade das chamadas à OpenAI.
--
-- A fatura subiu sem ninguem saber de onde: imagem de criativo dava para contar
-- pela tabela de assets, resposta de IA pela mensagem gravada, mas chamada que
-- falha ou que nao vira registro nenhum era invisivel. Sem origem e tokens,
-- cortar gasto vira chute.
create table if not exists public.openai_uso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  origem text not null,
  modelo text not null,
  tokens_entrada integer,
  tokens_saida integer,
  imagens integer,
  ok boolean not null default true,
  erro text
);

create index if not exists openai_uso_created_at_idx on public.openai_uso (created_at desc);
create index if not exists openai_uso_origem_idx on public.openai_uso (origem, created_at desc);

alter table public.openai_uso enable row level security;

-- Só administrador lê; a gravação é sempre pela service role do servidor.
drop policy if exists openai_uso_admin_read on public.openai_uso;
create policy openai_uso_admin_read on public.openai_uso for select using (public.is_admin());

notify pgrst, 'reload schema';
