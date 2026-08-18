-- Sessao da IA SDR comercial.
--
-- Substitui as duas travas frageis que existiam antes:
--   1. o Map em memoria do commercialSdrAgent, que morria a cada restart e nao
--      valia para mais de uma instancia do app;
--   2. a janela de 90s do hasRecentHumanOutbound, que devolvia a palavra para a
--      IA depois de um minuto e meio, mesmo com o SDR no meio do atendimento.
--
-- Aqui o estado e unico por lead e vive no banco: quem esta conduzindo a
-- conversa, quantas perguntas a IA ja fez e ate quando o turno esta travado.

create table if not exists public.comercial_ia_sessoes (
  lead_id uuid primary key references public.comercial_leads(id) on delete cascade,
  conversa_id uuid references public.whatsapp_conversas(id) on delete set null,
  -- ativa: a IA conduz. repassada: entregue ao SDR. humano: SDR assumiu no
  -- inbox. encerrada: lead pediu para parar. erro: falha de envio.
  status text not null default 'ativa'
    check (status in ('ativa', 'repassada', 'humano', 'encerrada', 'erro')),
  motivo text,
  perguntas_feitas integer not null default 0,
  abertura_enviada_at timestamptz,
  ultima_mensagem_ia_at timestamptz,
  ultima_mensagem_lead_at timestamptz,
  bloqueado_ate timestamptz,
  repassado_sdr_id uuid references public.profiles(id) on delete set null,
  repassado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comercial_ia_sessoes_status_idx
  on public.comercial_ia_sessoes (status, ultima_mensagem_ia_at);

-- Trava o turno da IA de forma atomica. Devolve true somente para quem pegou o
-- lock: webhooks simultaneos da UAZAPI para o mesmo lead recebem false e saem
-- sem responder, em vez de gerar duas mensagens iguais.
create or replace function public.claim_comercial_ia_turno(
  p_lead_id uuid,
  p_ttl_seconds integer default 45
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.comercial_ia_sessoes as s (lead_id, bloqueado_ate)
  values (p_lead_id, now() + make_interval(secs => p_ttl_seconds))
  on conflict (lead_id) do update
    set bloqueado_ate = now() + make_interval(secs => p_ttl_seconds),
        updated_at = now()
    where s.bloqueado_ate is null
       or s.bloqueado_ate < now();

  -- FOUND so e true quando o insert entrou ou quando o update condicional
  -- encontrou o lock expirado. Lock ainda valido nao afeta linha nenhuma.
  return found;
end;
$$;

create or replace function public.release_comercial_ia_turno(p_lead_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.comercial_ia_sessoes
  set bloqueado_ate = null, updated_at = now()
  where lead_id = p_lead_id;
$$;

revoke all on function public.claim_comercial_ia_turno(uuid, integer) from public;
revoke all on function public.release_comercial_ia_turno(uuid) from public;
grant execute on function public.claim_comercial_ia_turno(uuid, integer) to service_role;
grant execute on function public.release_comercial_ia_turno(uuid) to service_role;

alter table public.comercial_ia_sessoes enable row level security;

-- Leitura pelo mesmo escopo do lead: coordenador e closer veem tudo, SDR ve
-- apenas os leads do proprio rodizio.
drop policy if exists comercial_ia_sessoes_read on public.comercial_ia_sessoes;
create policy comercial_ia_sessoes_read on public.comercial_ia_sessoes for select using (
  public.is_admin()
  or exists (
    select 1
    from public.comercial_membros cm
    join public.comercial_leads cl on cl.id = comercial_ia_sessoes.lead_id
    where cm.profile_id = auth.uid()
      and cm.ativo = true
      and (
        cm.papel in ('coordenador', 'closer')
        or (cm.papel = 'sdr' and cl.sdr_id = auth.uid())
      )
  )
);

notify pgrst, 'reload schema';
