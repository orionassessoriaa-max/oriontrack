-- Remove o contato fake recorrente do CRM e do Inbox, inclusive historico e midias
-- vinculados as conversas. A normalizacao cobre "Joao" com ou sem acento.
delete from public.whatsapp_conversas
where lower(
  regexp_replace(
    translate(trim(coalesce(nome_contato, '')), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
    '[[:space:]]+',
    ' ',
    'g'
  )
) = 'joao silva'
or lead_id in (
  select id
  from public.leads
  where lower(
    regexp_replace(
      translate(trim(coalesce(nome, '')), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  ) = 'joao silva'
);

delete from public.leads
where lower(
  regexp_replace(
    translate(trim(coalesce(nome, '')), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
    '[[:space:]]+',
    ' ',
    'g'
  )
) = 'joao silva';

create or replace function public.block_known_fake_lead()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(
    regexp_replace(
      translate(trim(coalesce(new.nome, '')), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  ) = 'joao silva' then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists block_known_fake_lead_before_insert on public.leads;

create trigger block_known_fake_lead_before_insert
before insert on public.leads
for each row
execute function public.block_known_fake_lead();
