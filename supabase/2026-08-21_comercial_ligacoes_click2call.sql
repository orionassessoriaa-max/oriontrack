-- Discagem pelo Click2Call da VoIP do Brasil.
--
-- A API so origina a chamada e nao devolve identificador, atendimento nem
-- duracao. Por isso guardamos os numeros usados: quando a operadora liberar o
-- CDR, o unico jeito de casar o registro do CRM com o da central e por
-- origem + destino + janela de horario.
alter table public.comercial_ligacoes
  add column if not exists origem text not null default 'manual',
  add column if not exists numero_origem text,
  add column if not exists numero_destino text;

alter table public.comercial_ligacoes
  drop constraint if exists comercial_ligacoes_origem_check;

alter table public.comercial_ligacoes
  add constraint comercial_ligacoes_origem_check
  check (origem in ('manual', 'click2call'));

comment on column public.comercial_ligacoes.origem is
  'manual = o SDR discou no proprio aparelho; click2call = a central originou pelo CRM.';
comment on column public.comercial_ligacoes.numero_origem is
  'Numero ou ramal que a central chamou primeiro (o operador).';
comment on column public.comercial_ligacoes.numero_destino is
  'Numero do lead, no formato enviado para a central.';

-- Ramal do operador. Vazio significa que a central chama o celular dele, que o
-- manual aceita como src (numero externo).
alter table public.profiles
  add column if not exists voip_ramal text;

comment on column public.profiles.voip_ramal is
  'Ramal do operador no PABX. Regra do manual: precisa ser diferente do device_id da linha.';

create index if not exists comercial_ligacoes_cdr_idx
  on public.comercial_ligacoes(numero_destino, iniciada_at desc);

notify pgrst, 'reload schema';
