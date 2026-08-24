-- Uma linha por operador.
--
-- O device_id nao diz quem ligou: ele diz de qual linha a chamada sai e quem
-- paga. Quem ligou continua vindo do src e do registro em comercial_ligacoes.
-- O motivo de separar e capacidade: cada linha atende uma chamada por vez,
-- entao com Talita e Cadu discando juntos um travaria o outro.
alter table public.profiles
  add column if not exists voip_device_id text;

comment on column public.profiles.voip_device_id is
  'Linha da central usada por esta pessoa. Vazio cai na linha padrao do ambiente.';

-- 12291 = linha 61 2017-6871 | 12292 = linha 61 4042-7075
update public.profiles p
set voip_device_id = '12291'
where p.nome ilike '%talita%';

update public.profiles p
set voip_device_id = '12292'
where p.nome ilike '%carlos eduardo%';

notify pgrst, 'reload schema';

select nome, telefone, voip_ramal, voip_device_id
from public.profiles
where voip_device_id is not null
order by nome;
