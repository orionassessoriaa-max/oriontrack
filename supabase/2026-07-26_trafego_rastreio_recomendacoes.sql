-- Rastreio de leads por concessionaria + fila de recomendacoes do gestor de trafego.
--
-- rastreio_status separa tres situacoes que hoje aparecem iguais no painel:
--   nao_configurado  -> planilha nao subiu / automacao nao ligada. Nao e problema de campanha.
--   planilha_importada -> leads historicos existem, mas o webhook ainda nao esta ligado.
--   automacao_ativa  -> lead chega sozinho. Só aqui o CPL pode ser cobrado.

-- A coluna nasce NULA de proposito. Com valor nulo o painel usa a heuristica
-- (a concessionaria ja recebeu algum lead Orion alguma vez?), entao nada muda
-- de comportamento no dia da migracao. Marcar a coluna e o passo manual do
-- admin, e so a partir dai ela passa a mandar na classificacao.
alter table public.corretores
  add column if not exists rastreio_status text,
  add column if not exists rastreio_desde date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'corretores_rastreio_status_check'
  ) then
    alter table public.corretores
      add constraint corretores_rastreio_status_check
      check (rastreio_status is null or rastreio_status in ('nao_configurado', 'planilha_importada', 'automacao_ativa'));
  end if;
end $$;

create index if not exists corretores_rastreio_status_idx
on public.corretores (rastreio_status);

create table if not exists public.trafego_recomendacoes (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid references public.corretores(id) on delete cascade,
  concessionaria_nome text,
  meta_ad_account_id text,
  nivel text not null check (nivel in ('conta', 'campanha', 'conjunto', 'anuncio')),
  alvo_id text,
  alvo_nome text,
  acao text not null check (acao in (
    'pausar_campanha',
    'pausar_conjunto',
    'pausar_anuncio',
    'trocar_criativo',
    'revisar_publico',
    'revisar_rastreio',
    'avisar_admin'
  )),
  severidade text not null default 'atencao' check (severidade in ('critico', 'atencao', 'informativo')),
  motivo text not null,
  metricas jsonb not null default '{}'::jsonb,
  periodo_inicio date,
  periodo_fim date,
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'ignorada', 'executada', 'erro')),
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_em timestamptz,
  executado_em timestamptz,
  execucao_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma recomendacao pendente por alvo e acao. Reanalises atualizam a existente
-- em vez de empilhar duplicatas na fila do gestor.
create unique index if not exists trafego_recomendacoes_alvo_pendente_idx
on public.trafego_recomendacoes (meta_ad_account_id, alvo_id, acao)
where status = 'pendente';

create index if not exists trafego_recomendacoes_status_idx
on public.trafego_recomendacoes (status, created_at desc);

create index if not exists trafego_recomendacoes_corretor_idx
on public.trafego_recomendacoes (corretor_id);

alter table public.trafego_recomendacoes enable row level security;

-- Todo acesso passa pelas rotas de API com service role. RLS fica restrita a
-- leitura administrativa para inspecao manual.
drop policy if exists "trafego_recomendacoes_admin_read" on public.trafego_recomendacoes;
create policy "trafego_recomendacoes_admin_read"
on public.trafego_recomendacoes
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
);

create table if not exists public.trafego_analises (
  id uuid primary key default gen_random_uuid(),
  gestor_id uuid references public.profiles(id) on delete set null,
  periodo_inicio date,
  periodo_fim date,
  contas_lidas integer not null default 0,
  recomendacoes_geradas integer not null default 0,
  resumo_ia text,
  created_at timestamptz not null default now()
);

create index if not exists trafego_analises_gestor_idx
on public.trafego_analises (gestor_id, created_at desc);

alter table public.trafego_analises enable row level security;

drop policy if exists "trafego_analises_admin_read" on public.trafego_analises;
create policy "trafego_analises_admin_read"
on public.trafego_analises
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.tipo_usuario = 'admin'
  )
);
