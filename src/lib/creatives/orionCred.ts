import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, uazapiFetch } from '@/lib/uazapi';
import { APOLO_MASTER_INSTANCE } from '@/lib/apoloNotifications';

export type OrionCredAccount = {
  gestor_id: string;
  limite_creditos: number;
  creditos_usados: number;
  creditos_reservados: number;
  ciclo_inicio: string;
  ciclo_fim: string;
};

export function creditSummary(account: OrionCredAccount | null) {
  const limit = Number(account?.limite_creditos || 0);
  const used = Number(account?.creditos_usados || 0);
  const reserved = Number(account?.creditos_reservados || 0);
  return {
    configured: Boolean(account),
    limit,
    used,
    reserved,
    available: Math.max(limit - used - reserved, 0),
    usage_percent: limit > 0 ? Math.min(Math.round((used / limit) * 100), 100) : 0,
    cycle_start: account?.ciclo_inicio || null,
    cycle_end: account?.ciclo_fim || null,
  };
}

async function runCreditRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as OrionCredAccount;
}

export function reserveOrionCredits(gestorId: string, quantity: number, reference: string) {
  return runCreditRpc('orion_cred_reservar', {
    p_gestor_id: gestorId,
    p_quantidade: quantity,
    p_referencia: reference,
  });
}

export async function settleOrionCredits(gestorId: string, quantity: number, reference: string) {
  const account = await runCreditRpc('orion_cred_consumir', {
    p_gestor_id: gestorId,
    p_quantidade: quantity,
    p_referencia: reference,
  });
  await notifyUsageThreshold(account).catch((error) => {
    console.error('[Orion Cred] Falha ao enviar alerta de saldo:', error);
  });
  return account;
}

export function releaseOrionCredits(gestorId: string, quantity: number, reference: string) {
  if (quantity <= 0) return Promise.resolve(null);
  return runCreditRpc('orion_cred_estornar', {
    p_gestor_id: gestorId,
    p_quantidade: quantity,
    p_referencia: reference,
  });
}

async function notifyUsageThreshold(account: OrionCredAccount) {
  const summary = creditSummary(account);
  const threshold = summary.usage_percent >= 100 ? 100 : summary.usage_percent >= 80 ? 80 : 0;
  if (!threshold) return;

  const { data: claimed, error } = await supabaseAdmin.rpc('orion_cred_marcar_alerta', {
    p_gestor_id: account.gestor_id,
    p_percentual: threshold,
  });
  if (error || !claimed) return;

  const { data: gestor } = await supabaseAdmin
    .from('profiles')
    .select('id, nome')
    .eq('id', account.gestor_id)
    .maybeSingle();
  const gestorName = gestor?.nome || 'Gestor sem nome';
  const title = threshold === 100 ? 'Orion Cred esgotado' : 'Orion Cred em 80%';
  const message = threshold === 100
    ? `O saldo de criativos de ${gestorName} chegou a zero. Novas geracoes foram bloqueadas.`
    : `${gestorName} usou ${summary.usage_percent}% do limite de criativos. Restam ${summary.available} creditos.`;

  await supabaseAdmin.from('notificacoes').insert({
    titulo: title,
    mensagem: message,
    destinatario_profile_id: account.gestor_id,
    destinatario_tipo: 'gestor_trafego',
  });

  const phone = normalizePhone('61984409328');
  if (phone) {
    await uazapiFetch('/send/text', {
      method: 'POST',
      body: JSON.stringify({
        number: phone,
        text: `*${title}*\n\n${message}\n\n_Apolo Notificador - Orion Track_`,
      }),
    }, { instanceName: APOLO_MASTER_INSTANCE });
  }
}
