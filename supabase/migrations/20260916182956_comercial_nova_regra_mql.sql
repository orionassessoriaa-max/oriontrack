-- Nova classificacao comercial aprovada em 16/09/2026.
-- Ordem: S -> A -> B -> C -> FMQL (Fora do MQL).

create or replace function public.comercial_revenue_floor(raw_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  source text := lower(trim(coalesce(raw_value, '')));
  number_match text[];
  token text;
  unit text;
  parsed numeric;
  minimum_revenue numeric := null;
  number_count integer := 0;
begin
  if source = '' or source ~ '(nao informado|não informado|sem informacao|sem informação)' then return 0; end if;
  if source ~ '(abaixo|menos)[[:space:]]+de' then return 0; end if;

  for number_match in
    select regexp_matches(source, '(-?[0-9]+(?:[.,][0-9]+)*)[[:space:]]*(milh[aã]o|milh[oõ]es|mil|k)?', 'g')
  loop
    token := number_match[1];
    unit := coalesce(number_match[2], '');
    number_count := number_count + 1;

    if position('.' in token) > 0 and position(',' in token) > 0 then
      if strpos(reverse(token), ',') < strpos(reverse(token), '.') then
        token := replace(replace(token, '.', ''), ',', '.');
      else
        token := replace(token, ',', '');
      end if;
    elsif position(',' in token) > 0 then
      token := replace(token, ',', '.');
    elsif token ~ '^-?[0-9]{1,3}(\.[0-9]{3})+$' then
      token := replace(token, '.', '');
    end if;

    begin
      parsed := token::numeric;
      if unit ~ '^milh' then parsed := parsed * 1000000;
      elsif unit in ('mil', 'k') then parsed := parsed * 1000;
      end if;
      minimum_revenue := case when minimum_revenue is null then parsed else least(minimum_revenue, parsed) end;
    exception when others then
      continue;
    end;
  end loop;

  if number_count = 1 and source ~ '(^|[^a-zà-ú])at[eé]([^a-zà-ú]|$)' then return 0; end if;
  return coalesce(minimum_revenue, 0);
end;
$$;

create or replace function public.comercial_has_investment(raw_value text)
returns boolean
language sql
immutable
as $$
  select case
    when trim(coalesce(raw_value, '')) = '' then false
    when lower(raw_value) ~ '(^|[^a-zà-ú])(nao|não|sem|nenhum|nenhuma|nunca)([^a-zà-ú]|$)' then false
    else true
  end;
$$;

create or replace function public.comercial_is_high_priority(raw_value text)
returns boolean
language sql
immutable
as $$
  select lower(trim(coalesce(raw_value, ''))) like '%alta%'
    and lower(trim(coalesce(raw_value, ''))) like '%quero crescer agora%';
$$;

create or replace function public.comercial_mql_level(
  raw_revenue text,
  raw_investment text,
  raw_priority text
)
returns text
language plpgsql
immutable
as $$
declare
  revenue_floor numeric := public.comercial_revenue_floor(raw_revenue);
  has_investment boolean := public.comercial_has_investment(raw_investment);
begin
  if revenue_floor >= 30000 and has_investment and public.comercial_is_high_priority(raw_priority) then return 'S'; end if;
  if revenue_floor >= 20000 and has_investment then return 'A'; end if;
  if revenue_floor >= 20000 then return 'B'; end if;
  if revenue_floor >= 10000 or has_investment then return 'C'; end if;
  return 'FMQL';
end;
$$;

create or replace function public.comercial_apply_lead_rules()
returns trigger
language plpgsql
as $$
declare
  old_stage text;
  new_stage text;
  old_scheduled boolean;
  new_scheduled boolean;
  new_no_show boolean;
begin
  new_stage := lower(coalesce(new.status, ''));
  new.no_show_count := greatest(coalesce(new.no_show_count, 0), 0);
  new.lead_qualificado := public.comercial_mql_level(
    new.faturamento_mensal,
    new.investimento,
    new.prioridade
  ) <> 'FMQL';

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    old_stage := lower(coalesce(old.status, ''));
    old_scheduled := old_stage like '%reuni%agend%';
    new_scheduled := new_stage like '%reuni%agend%';
    new_no_show := replace(replace(new_stage, '-', ' '), '_', ' ') like '%no show%';

    if new_no_show and replace(replace(old_stage, '-', ' '), '_', ' ') not like '%no show%' then
      new.no_show_count := coalesce(old.no_show_count, 0) + 1;
      new.no_show := true;
    elsif new_scheduled then
      new.no_show := false;
    elsif old_scheduled then
      new.reuniao_realizada_at := coalesce(new.reuniao_realizada_at, now());
      new.no_show := false;
    end if;
  end if;
  return new;
end;
$$;

update public.comercial_leads
set lead_qualificado = public.comercial_mql_level(
  faturamento_mensal,
  investimento,
  prioridade
) <> 'FMQL'
where lead_qualificado is distinct from (
  public.comercial_mql_level(faturamento_mensal, investimento, prioridade) <> 'FMQL'
);

notify pgrst, 'reload schema';
