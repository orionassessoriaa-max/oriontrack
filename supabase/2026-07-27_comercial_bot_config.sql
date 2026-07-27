-- Configuracao do bot de primeira mensagem da operacao comercial.
-- IA SDR e Bot sao mutuamente exclusivos.
alter table if exists public.comercial_config
  add column if not exists bot_comercial_ativo boolean not null default false;

alter table if exists public.comercial_config
  add column if not exists bot_comercial_prompt text not null default 'Ola, {primeiro_nome}! Tudo bem?\n\nVi que voce acabou de preencher nosso formulario. Vou te fazer algumas perguntas bem rapidinhas para entender seu momento e te direcionar melhor, tudo bem?';

notify pgrst, 'reload schema';
