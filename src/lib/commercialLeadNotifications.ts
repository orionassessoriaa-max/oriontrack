import 'server-only';

import { getCommercialMqlLevel, isCommercialMql } from '@/lib/commercialQualification';
import { supabaseAdmin } from '@/lib/supabase/admin';

type CommercialLeadNotification = {
  id: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  empresa?: string | null;
  status?: string | null;
  faturamento_mensal?: string | null;
  investimento?: string | null;
  prioridade?: string | null;
  vidas?: string | null;
  sdr_id?: string | null;
};

type NotificationProfile = {
  id: string;
  nome: string | null;
  email: string | null;
  tipo_usuario: string | null;
  telefone: string | null;
};

function plain(value: unknown) {
  const text = String(value || '').trim();
  return text || 'Nao informado';
}

async function loadCommercialNotificationProfiles(sdrId: string) {
  const { data: members, error: memberError } = await supabaseAdmin
    .from('comercial_membros')
    .select('*')
    .eq('ativo', true);
  if (memberError) throw memberError;

  const coordinatorIds = (members || [])
    .filter((member) => member.papel === 'coordenador' && member.recebe_notificacoes !== false)
    .map((member) => member.profile_id);
  const profileIds = Array.from(new Set([sdrId, ...coordinatorIds]));
  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id,nome,email,tipo_usuario,telefone')
    .in('id', profileIds)
    .in('status', ['active', 'ativo', 'Ativo']);
  if (profileError) throw profileError;

  const byId = new Map((profiles || []).map((profile) => [profile.id, profile as NotificationProfile]));
  return {
    sdr: byId.get(sdrId) || null,
    coordinators: coordinatorIds.map((id) => byId.get(id)).filter(Boolean) as NotificationProfile[],
  };
}

export async function notifyCommercialLeadAssignment(lead: CommercialLeadNotification) {
  const sdrId = String(lead.sdr_id || '').trim();
  if (!sdrId) return { sdr: [], coordinators: [] };

  const targets = await loadCommercialNotificationProfiles(sdrId);
  if (!targets.sdr) return { sdr: [], coordinators: [] };

  const outsideMql = !isCommercialMql(lead.faturamento_mensal, lead.investimento, lead.prioridade);
  const mqlLevel = getCommercialMqlLevel(lead.faturamento_mensal, lead.investimento, lead.prioridade);
  const sdrMessage = [
    mqlLevel === 'S' ? 'Um novo Lead MQL S foi direcionado para voce.' : 'Um novo lead entrou no seu rodizio.',
    '',
    `Nome: ${plain(lead.nome)}`,
    `Telefone: ${plain(lead.telefone)}`,
    `E-mail: ${plain(lead.email)}`,
    `Empresa: ${plain(lead.empresa)}`,
    `Etapa: ${plain(lead.status)}`,
    `Faturamento: ${plain(lead.faturamento_mensal)}`,
    `Investimento: ${plain(lead.investimento)}`,
    `Prioridade: ${plain(lead.prioridade)}`,
    `Vidas: ${plain(lead.vidas)}`,
    outsideMql ? 'Classificacao: fora do MQL atual.' : 'Classificacao: dentro do MQL atual.',
  ].join('\n');

  const title = mqlLevel === 'S' ? 'Lead MQL S' : 'Agora e sua vez';
  const notifications = [
    {
      titulo: title,
      mensagem: sdrMessage,
      destinatario_profile_id: targets.sdr.id,
      lida: false,
    },
    ...targets.coordinators.map((profile) => ({
      titulo: 'Nova oportunidade distribuida',
      mensagem: `${targets.sdr?.nome || 'O SDR responsavel'} acabou de receber uma nova oportunidade: ${plain(lead.nome)}.`,
      destinatario_profile_id: profile.id,
      lida: false,
    })),
  ];

  const { error: notificationError } = await supabaseAdmin.from('notificacoes').insert(notifications);
  if (notificationError) throw notificationError;

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: null,
    actor_email: null,
    actor_role: 'system',
    action: 'commercial.lead.assignment_notifications',
    entity_type: 'commercial_lead',
    entity_id: lead.id,
    metadata: {
      sdr_id: targets.sdr.id,
      channel: 'in_app',
      sdr_notified: true,
      coordinator_profile_ids: targets.coordinators.map((profile) => profile.id),
    },
    ip_address: null,
    user_agent: 'Orion Track / Apolo',
  });

  return {
    sdr: [{ profile_id: targets.sdr.id, status: 'success', channel: 'in_app' }],
    coordinators: targets.coordinators.map((profile) => ({ profile_id: profile.id, status: 'success', channel: 'in_app' })),
  };
}
