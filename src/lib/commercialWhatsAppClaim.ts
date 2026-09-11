import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { APOLO_MASTER_INSTANCE } from '@/lib/apoloNotifications';
import { commercialNotificationGroupId, sendCommercialGroupNotification } from '@/lib/commercialNotificationGroup';
import { leadIdFromCommercialClaimButton } from '@/lib/commercialClaimSecurity';
import { claimCommercialLead } from '@/lib/commercialLeadClaim';
import { phoneMatchKey, uazapiFetch } from '@/lib/uazapi';

type ProviderMessage = {
  id?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  chatid?: string;
  buttonOrListid?: string;
  sender?: string;
  sender_pn?: string;
  sender_lid?: string;
};
type Participant = { JID?: string; LID?: string; PhoneNumber?: string };

export async function handleCommercialWhatsAppClaim(providerId: string) {
  const groupId = commercialNotificationGroupId();
  if (!groupId || !providerId || providerId.length > 180) return { status: 'ignored' };

  // Nunca confiar no remetente ou no botao do POST: ler a mensagem na conta do Apolo.
  const payload = await uazapiFetch('/message/find', {
    method: 'POST', body: JSON.stringify({ id: providerId, limit: 1 }),
  }, { instanceName: APOLO_MASTER_INSTANCE });
  const message = (payload.messages as ProviderMessage[] | undefined)?.find(item => item.id === providerId);
  if (!message || message.fromMe !== false || message.isGroup !== true || message.chatid !== groupId) {
    return { status: 'ignored' };
  }
  const buttonId = message.buttonOrListid || '';
  if (buttonId === 'orion_claim_test_v1') return { status: 'test_received' };
  const leadId = leadIdFromCommercialClaimButton(groupId, buttonId);
  if (!leadId) return { status: 'ignored' };

  const info = await uazapiFetch('/group/info', {
    method: 'POST', body: JSON.stringify({ groupjid: groupId, force: true }),
  }, { instanceName: APOLO_MASTER_INSTANCE });
  const group = info.group || info;
  if (group.JID !== groupId) return { status: 'ignored' };
  const senderIds = [message.sender, message.sender_pn, message.sender_lid].filter(Boolean);
  const participant = (group.Participants as Participant[] | undefined)?.find(item =>
    [item.JID, item.LID, item.PhoneNumber].some(jid => jid && senderIds.includes(jid)));
  // Resolver LID pelo cadastro do grupo, nunca interpretar os digitos do LID como telefone.
  const pn = participant?.PhoneNumber || (participant?.JID?.endsWith('@s.whatsapp.net') ? participant.JID : '');
  if (!pn || !pn.endsWith('@s.whatsapp.net')) return { status: 'sender_not_identified' };
  const phoneKey = phoneMatchKey(pn.split('@')[0]);
  if (!phoneKey) return { status: 'sender_not_identified' };

  const { data: members, error: memberError } = await supabaseAdmin.from('comercial_membros')
    .select('profile_id').eq('papel', 'sdr').eq('ativo', true);
  if (memberError) throw memberError;
  const ids = (members || []).map(member => member.profile_id);
  if (!ids.length) return { status: 'not_authorized' };
  const [{ data: profiles, error: profileError }, { data: preferences, error: prefError }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id,nome,telefone').in('id', ids).in('status', ['active', 'ativo', 'Ativo']),
    supabaseAdmin.from('notificacao_preferencias').select('profile_id,telefone').in('profile_id', ids),
  ]);
  if (profileError) throw profileError;
  if (prefError) throw prefError;
  const matches = (profiles || []).filter(profile => {
    const preference = (preferences || []).find(pref => pref.profile_id === profile.id);
    // Usar o mesmo telefone efetivo do envio privado, sem aceitar cadastro antigo como alternativa.
    return phoneMatchKey(preference?.telefone || profile.telefone) === phoneKey;
  });
  if (matches.length !== 1) return { status: 'not_authorized' };
  const result = await claimCommercialLead(leadId, matches[0].id, 'whatsapp_grupo');
  if (result.status === 'previous_contact_required') {
    const previousLeadName = result.previousLeadName || 'o lead anterior';
    await sendCommercialGroupNotification(groupId, 'START bloqueado', [
      `${matches[0].nome || 'SDR'}, nao foi possivel assumir este novo lead.`,
      '',
      'Motivo: ainda falta registrar uma tentativa de contato no lead anterior.',
      `Lead pendente: ${previousLeadName}.`,
      '',
      'Registre uma ligacao, tentativa na cadencia ou mensagem pelo CRM e tente novamente.',
    ].join('\n'));
  }
  // Nao repetir o aviso quando o WhatsApp reentrega o mesmo clique.
  return {
    status: result.status,
    ...('notified' in result ? { notified: result.notified } : {}),
    ...('previousLeadName' in result ? { previousLeadName: result.previousLeadName } : {}),
  };
}
