-- Regras centrais do Comercial CRM:
-- 1. contabiliza cada entrada em No-show;
-- 2. ao sair de Reunioes agendadas, marca a reuniao como realizada (exceto No-show);
-- 3. detecta MQL por faturamento > R$ 20 mil e investimento >= R$ 1.500;
-- 4. amplia as interacoes para funcionarem como timeline do lead.

alter table public.comercial_leads
  add column if not exists no_show_count integer not null default 0;

update public.comercial_leads
set no_show_count = 1
where (no_show is true or lower(coalesce(status, '')) in ('no-show', 'no show'))
  and no_show_count = 0;

alter table public.comercial_lead_interacoes
  add column if not exists tipo text not null default 'comentario',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public.comercial_parse_money(raw_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  source text := lower(trim(coalesce(raw_value, '')));
  cleaned text;
  multiplier numeric := 1;
  parsed numeric;
begin
  if source = '' then return 0; end if;
  if source ~ '(^|[^a-z])(mil|k)([^a-z]|$)' then multiplier := 1000; end if;
  cleaned := regexp_replace(source, '[^0-9,.-]', '', 'g');
  if cleaned = '' then return 0; end if;

  if position('.' in cleaned) > 0 and position(',' in cleaned) > 0 then
    if strpos(reverse(cleaned), ',') < strpos(reverse(cleaned), '.') then
      cleaned := replace(replace(cleaned, '.', ''), ',', '.');
    else
      cleaned := replace(cleaned, ',', '');
    end if;
  elsif position(',' in cleaned) > 0 then
    cleaned := replace(cleaned, ',', '.');
  elsif cleaned ~ '^-?[0-9]{1,3}(\.[0-9]{3})+$' then
    cleaned := replace(cleaned, '.', '');
  end if;

  begin
    parsed := cleaned::numeric;
  exception when others then
    parsed := 0;
  end;
  return coalesce(parsed, 0) * multiplier;
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
  new.lead_qualificado := public.comercial_parse_money(new.faturamento_mensal) > 20000
    and public.comercial_parse_money(new.investimento) >= 1500;

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

drop trigger if exists comercial_apply_lead_rules_trigger on public.comercial_leads;
create trigger comercial_apply_lead_rules_trigger
before insert or update of status, faturamento_mensal, investimento, no_show_count
on public.comercial_leads
for each row execute function public.comercial_apply_lead_rules();

-- Recalcula a base atual sem alterar a etapa dos leads.
update public.comercial_leads
set lead_qualificado = public.comercial_parse_money(faturamento_mensal) > 20000
  and public.comercial_parse_money(investimento) >= 1500;

notify pgrst, 'reload schema';
