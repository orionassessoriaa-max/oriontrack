-- Um lead qualificado precisa faturar pelo menos R$ 20 mil por mes.
-- Para respostas em faixa, usa o limite inferior da faixa.

create or replace function public.comercial_is_qualified_revenue(raw_value text)
returns boolean
language plpgsql
immutable
as $$
declare
  source text := lower(trim(coalesce(raw_value, '')));
  number_match text[];
  token text;
  parsed numeric;
  minimum_revenue numeric := null;
  multiplier numeric := 1;
  number_count integer := 0;
begin
  if source = '' or source ~ '(nao informado|sem informacao)' then return false; end if;
  if source ~ '(^|[^a-z])(mil|k)([^a-z]|$)' then multiplier := 1000; end if;

  for number_match in
    select regexp_matches(source, '-?[0-9]+(?:[.,][0-9]+)*', 'g')
  loop
    token := number_match[1];
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
      parsed := token::numeric * multiplier;
      minimum_revenue := case
        when minimum_revenue is null then parsed
        else least(minimum_revenue, parsed)
      end;
    exception when others then
      continue;
    end;
  end loop;

  if number_count = 1 and source ~ '(abaixo|menos)[[:space:]]+de|(^|[^a-z])at[eé]([^a-z]|$)' then return false; end if;
  return coalesce(minimum_revenue, 0) >= 20000;
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
  new.lead_qualificado := public.comercial_is_qualified_revenue(new.faturamento_mensal);

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
set lead_qualificado = public.comercial_is_qualified_revenue(faturamento_mensal)
where lead_qualificado is distinct from public.comercial_is_qualified_revenue(faturamento_mensal);

notify pgrst, 'reload schema';
