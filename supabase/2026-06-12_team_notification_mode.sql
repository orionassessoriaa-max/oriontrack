alter table public.corretor_times
  add column if not exists notificacao_novo_lead_modo text not null default 'responsavel_e_admin_se_integrante';

alter table public.corretor_times
  drop constraint if exists corretor_times_notificacao_novo_lead_modo_check;

alter table public.corretor_times
  add constraint corretor_times_notificacao_novo_lead_modo_check
  check (notificacao_novo_lead_modo in (
    'responsavel_apenas',
    'responsavel_e_admin_se_integrante',
    'responsavel_e_admins'
  ));
