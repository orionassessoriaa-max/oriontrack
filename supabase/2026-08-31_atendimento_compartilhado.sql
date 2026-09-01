-- Atendimento compartilhado: um numero para toda a concessionaria.
--
-- Corretora com varios vendedores nao quer um chip por pessoa. Com a chave
-- ligada, todos enviam pelo mesmo WhatsApp e a mensagem sai assinada com o
-- primeiro nome de quem escreveu, para o cliente saber com quem fala.
--
-- Fica desligada por padrao: nenhuma corretora existente muda de comportamento.
alter table public.corretores
  add column if not exists atendimento_compartilhado boolean not null default false;

-- Perfil dono do numero compartilhado. Nulo significa "o primeiro corretor
-- responsavel da concessionaria", resolvido em tempo de envio.
alter table public.corretores
  add column if not exists numero_compartilhado_profile_id uuid references public.profiles(id) on delete set null;

comment on column public.corretores.atendimento_compartilhado is
  'Todos os integrantes enviam pelo mesmo numero, com assinatura de quem escreveu.';

notify pgrst, 'reload schema';

select id, nome_empresa, atendimento_compartilhado, numero_compartilhado_profile_id
from public.corretores
where atendimento_compartilhado is true;
