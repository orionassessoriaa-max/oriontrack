create or replace function public.lead_exact_dedupe_key(
  p_corretor_id uuid,
  p_data_entrada timestamptz,
  p_nome text,
  p_telefone text,
  p_idades text,
  p_possui_cnpj text,
  p_tem_plano_ativo text,
  p_plano_atual text,
  p_custo_plano_atual text,
  p_investimento text,
  p_cidade text,
  p_operadora text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_utm_term text,
  p_utm_content text,
  p_status text
)
returns text
language sql
immutable
as $$
  select concat_ws('|',
    coalesce(p_corretor_id::text, ''),
    coalesce(p_data_entrada::date::text, ''),
    lower(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')),
    regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'),
    lower(regexp_replace(coalesce(p_idades, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_possui_cnpj, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_tem_plano_ativo, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_plano_atual, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_custo_plano_atual, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_investimento, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_cidade, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_operadora, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_utm_source, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_utm_medium, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_utm_campaign, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_utm_term, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_utm_content, ''), '\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(p_status, ''), '\s+', ' ', 'g'))
  )
$$;

with ranked_duplicates as (
  select
    id,
    row_number() over (
      partition by public.lead_exact_dedupe_key(
        corretor_id,
        data_entrada,
        nome,
        telefone,
        idades,
        possui_cnpj,
        tem_plano_ativo,
        plano_atual,
        custo_plano_atual,
        investimento,
        cidade,
        operadora,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        status
      )
      order by created_at asc nulls last, id asc
    ) as duplicate_rank
  from public.leads
)
delete from public.leads l
using ranked_duplicates d
where l.id = d.id
  and d.duplicate_rank > 1;

create unique index if not exists leads_exact_dedupe_idx
on public.leads (
  public.lead_exact_dedupe_key(
    corretor_id,
    data_entrada,
    nome,
    telefone,
    idades,
    possui_cnpj,
    tem_plano_ativo,
    plano_atual,
    custo_plano_atual,
    investimento,
    cidade,
    operadora,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    status
  )
);
