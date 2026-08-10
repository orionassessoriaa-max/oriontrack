alter table public.trafego_estrategias_criativos
  add column if not exists creative_prompt text;

comment on column public.trafego_estrategias_criativos.creative_prompt is
  'Prompt editavel usado como diretriz de copy e arte para esta operadora e regiao.';

