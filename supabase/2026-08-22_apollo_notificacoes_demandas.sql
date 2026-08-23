-- Notificacao de tarefa para o time Apollo.
--
-- Diagnostico de 22/08: das 6 pessoas do time, so o Matheus conseguia receber.
-- O Ewertton estava com o tipo "demandas" desligado e os outros quatro nao
-- tinham registro de preferencia nenhum.
--
-- Mexe SOMENTE em admin, gestor_trafego, designer e account_manager, que sao os
-- papeis do Apollo. Corretor, corretor_admin e corretor_membro ficam intactos.
insert into public.notificacao_preferencias (profile_id, whatsapp_enabled, telefone, tipos)
select p.id,
       true,
       nullif(p.telefone, ''),
       jsonb_build_object(
         'saldo_baixo', true,
         'cpl_alto', true,
         'notificacao', true,
         'novo_lead', true,
         'suporte', true,
         'demandas', true
       )
from public.profiles p
where p.tipo_usuario in ('admin', 'gestor_trafego', 'designer', 'account_manager')
  and p.status in ('active', 'ativo', 'Ativo')
on conflict (profile_id) do update
set whatsapp_enabled = true,
    telefone = coalesce(nullif(public.notificacao_preferencias.telefone, ''), excluded.telefone),
    tipos = coalesce(public.notificacao_preferencias.tipos, '{}'::jsonb) || jsonb_build_object('demandas', true),
    updated_at = now();

-- Quem ainda nao consegue receber: sem telefone nao ha para onde mandar.
select p.nome,
       p.tipo_usuario,
       coalesce(nullif(n.telefone, ''), p.telefone) as telefone,
       n.whatsapp_enabled,
       n.tipos->>'demandas' as demandas
from public.profiles p
left join public.notificacao_preferencias n on n.profile_id = p.id
where p.tipo_usuario in ('admin', 'gestor_trafego', 'designer', 'account_manager')
  and p.status in ('active', 'ativo', 'Ativo')
order by p.tipo_usuario, p.nome;
