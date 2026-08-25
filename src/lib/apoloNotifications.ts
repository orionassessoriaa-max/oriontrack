import { supabaseAdmin } from '@/lib/supabase/admin';
import { uazapiFetch, normalizePhone } from '@/lib/uazapi';

export const APOLO_MASTER_INSTANCE = 'apolo_master_sender';

export type ApoloNotificationType =
  | 'saldo_baixo'
  | 'cpl_alto'
  | 'notificacao'
  | 'novo_lead'
  | 'suporte'
  | 'demandas';

type TargetProfile = {
  id: string;
  nome: string | null;
  email?: string | null;
  tipo_usuario: string | null;
  telefone?: string | null;
};

type SendApoloOptions = {
  type: ApoloNotificationType;
  title: string;
  message: string;
  profiles: TargetProfile[];
  respectPreferences?: boolean;
};

const defaultTypeEnabled: Record<ApoloNotificationType, boolean> = {
  saldo_baixo: true,
  cpl_alto: true,
  notificacao: true,
  novo_lead: true,
  suporte: true,
  demandas: true,
};

function isTypeEnabled(rawTipos: any, type: ApoloNotificationType) {
  if (!rawTipos || typeof rawTipos !== 'object') return defaultTypeEnabled[type];
  const value = rawTipos[type];
  return value === undefined ? defaultTypeEnabled[type] : Boolean(value);
}

function firstName(nome?: string | null) {
  return String(nome || 'tudo bem').trim().split(/\s+/)[0] || 'tudo bem';
}

export async function sendApoloWhatsApp({ type, title, message, profiles, respectPreferences = true }: SendApoloOptions) {
  const uniqueProfiles = Array.from(new Map(profiles.filter((p) => p?.id).map((p) => [p.id, p])).values());
  if (uniqueProfiles.length === 0) return [];

  const { data: preferences, error } = await supabaseAdmin
    .from('notificacao_preferencias')
    .select('profile_id, whatsapp_enabled, telefone, tipos')
    .in('profile_id', uniqueProfiles.map((profile) => profile.id));

  if (error) {
    console.error('[Apolo notifications] preference lookup failed:', error);
    return [];
  }

  const prefsByProfile = new Map((preferences || []).map((pref: any) => [pref.profile_id, pref]));
  const results = [];
 
   for (const profile of uniqueProfiles) {
     const pref = prefsByProfile.get(profile.id) as any;
     if (respectPreferences && (!pref?.whatsapp_enabled || !isTypeEnabled(pref.tipos, type))) {
       results.push({ profile_id: profile.id, status: 'skipped', reason: 'Preferência desativada.' });
       continue;
     }
 
     // pref pode nao existir: quem nunca abriu a tela de notificacoes nao tem
     // linha em notificacao_preferencias. Sem o ?., o aviso de lead novo
     // estourava e ninguem recebia, nem o coordenador.
     const phone = normalizePhone(pref?.telefone || profile.telefone);
     if (!phone) {
       results.push({ profile_id: profile.id, status: 'failed', reason: 'Telefone não informado.' });
       continue;
     }
 
     const text = `*${title}*\n\nOlá, ${firstName(profile.nome)}!\n\n${message}\n\n_Apolo Notificador - Orion Track_`;
     try {
       await uazapiFetch('/send/text', {
         method: 'POST',
         body: JSON.stringify({ number: phone, text }),
       }, { instanceName: APOLO_MASTER_INSTANCE });
       results.push({ profile_id: profile.id, status: 'success', phone });
     } catch (err: any) {
       console.error('[Apolo notifications] send failed for %s:', profile.id, err);
       results.push({ profile_id: profile.id, status: 'failed', reason: err.message || 'Erro UAZAPI' });
     }
   }

  return results;
}

export async function resolveNotificationTargets(destinatarioTipo?: string | null, destinatarioProfileId?: string | null) {
  if (destinatarioProfileId) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, tipo_usuario, telefone')
      .eq('id', destinatarioProfileId)
      .maybeSingle();
    return data ? [data] : [];
  }

  let query = supabaseAdmin
    .from('profiles')
    .select('id, nome, email, tipo_usuario, telefone')
    .in('status', ['active', 'ativo', 'Ativo']);

  if (destinatarioTipo && destinatarioTipo !== 'todos') {
    query = query.eq('tipo_usuario', destinatarioTipo);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[Apolo notifications] target lookup failed:', error);
    return [];
  }

  return data || [];
}
