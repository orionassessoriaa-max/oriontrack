-- Sincronizacao do relatorio de gravacoes da VoIP do Brasil.
--
-- O Click2Call apenas aceita a solicitacao. O endpoint /api/recording e a
-- fonte oficial para confirmar se houve conversa, duracao e arquivo de audio.
alter table public.comercial_ligacoes
  alter column lead_id drop not null,
  add column if not exists voip_record_id bigint,
  add column if not exists voip_clid text,
  add column if not exists voip_source text,
  add column if not exists voip_destination text,
  add column if not exists voip_recording_size text,
  add column if not exists voip_sincronizada_at timestamptz;

alter table public.comercial_ligacoes
  drop constraint if exists comercial_ligacoes_origem_check;

alter table public.comercial_ligacoes
  add constraint comercial_ligacoes_origem_check
  check (origem in ('manual', 'click2call', 'voip_cdr'));

create unique index if not exists comercial_ligacoes_voip_record_id_uidx
  on public.comercial_ligacoes(voip_record_id)
  where voip_record_id is not null;

create index if not exists comercial_ligacoes_voip_source_date_idx
  on public.comercial_ligacoes(voip_source, iniciada_at desc);

comment on column public.comercial_ligacoes.voip_record_id is
  'Identificador unico devolvido pela API /api/recording da VoIP do Brasil.';
comment on column public.comercial_ligacoes.voip_source is
  'Origem devolvida pelo CDR/gravaracao, usada para identificar o SDR.';
comment on column public.comercial_ligacoes.voip_destination is
  'Destino bruto devolvido pela operadora.';

-- Cruzamento validado em 26/08/2026 pelos destinos das gravacoes com os donos
-- dos leads no CRM: 22 de 24 registros do dia tiveram correspondencia.
update public.profiles
set voip_ramal = '9171026'
where lower(trim(nome)) = 'talita vargas';

update public.profiles
set voip_ramal = '9171025'
where lower(trim(nome)) = 'carlos eduardo';

notify pgrst, 'reload schema';
