import 'server-only';

import { APOLO_MASTER_INSTANCE } from '@/lib/apoloNotifications';
import { uazapiFetch } from '@/lib/uazapi';
import { commercialClaimButtonId } from '@/lib/commercialClaimSecurity';

export function commercialNotificationGroupId() {
  const groupId = String(process.env.COMMERCIAL_LEADS_WHATSAPP_GROUP_ID || '').trim();
  if (groupId && !/^\d+(?:-\d+)?@g\.us$/.test(groupId)) {
    throw new Error('COMMERCIAL_LEADS_WHATSAPP_GROUP_ID precisa ser o JID completo do grupo (@g.us).');
  }
  return groupId;
}

export async function sendCommercialGroupNotification(groupId: string, title: string, message: string) {
  // JIDs de grupo nao sao telefones: preservar o sufixo @g.us no destinatario.
  if (!/^\d+(?:-\d+)?@g\.us$/.test(groupId)) throw new Error('Grupo comercial invalido.');
  const text = `*${title}*\n\n${message}\n\n_Apolo Notificador - Orion Track_`;
  await uazapiFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify({ number: groupId, text }),
  }, { instanceName: APOLO_MASTER_INSTANCE });
  return [{ group_id: groupId, status: 'success' as const }];
}

export async function sendCommercialGroupClaimButton(groupId: string, leadId: string) {
  const buttonId = commercialClaimButtonId(groupId, leadId);
  await uazapiFetch('/send/menu', {
    method: 'POST',
    body: JSON.stringify({
      number: groupId, type: 'button',
      text: '*Novo lead disponivel!*\n\nO primeiro SDR a assumir fica com a oportunidade. Toque no botao abaixo.',
      choices: [`ASSUMIR LEAD|${buttonId}`], footerText: 'Apolo Notificador - Orion Track',
    }),
  }, { instanceName: APOLO_MASTER_INSTANCE });
  return [{ group_id: groupId, status: 'success' as const }];
}
