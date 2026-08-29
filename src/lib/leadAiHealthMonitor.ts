import { sendApoloWhatsApp } from '@/lib/apoloNotifications';
import { handoffLeadAiToResponsible } from '@/lib/leadAiAgent';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  configureUazapiWebhook,
  ensureUazapiWebhookConfigured,
  getUazapiInstanceConnection,
  uazapiAiInstanceName,
  uazapiFetch,
  uazapiInstanceName,
} from '@/lib/uazapi';

type AiConfigRow = {
  id: string;
  corretora_id: string;
  status: string;
  sender_mode: string | null;
  sender_profile_id: string | null;
  dedicated_instance_name: string | null;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  nome: string | null;
  email: string | null;
  tipo_usuario: string | null;
  corretor_id: string | null;
  telefone: string | null;
  status: string | null;
  created_at: string;
};

type MonitorOptions = {
  notify?: boolean;
  reconnect?: boolean;
  mutate?: boolean;
};

const DISCONNECT_PENDING_STATUS = 'desconexao_pendente';
const DISCONNECTED_STATUS = 'desconectado';
const DEFAULT_DISCONNECT_CONFIRM_MS = 2 * 60 * 1000;

function disconnectConfirmMs() {
  const configured = Number(process.env.LEAD_AI_DISCONNECT_CONFIRM_MS || '');
  return Number.isFinite(configured) && configured >= 60_000
    ? configured
    : DEFAULT_DISCONNECT_CONFIRM_MS;
}

function activeProfile(profile: ProfileRow) {
  return ['active', 'ativo', 'Ativo'].includes(String(profile.status || ''));
}

function selectSenderProfile(config: AiConfigRow, profiles: ProfileRow[]) {
  const active = profiles.filter(activeProfile).sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
  return (
    active.find((profile) => profile.id === config.sender_profile_id) ||
    active.find((profile) => profile.tipo_usuario === 'corretor_admin' && profile.telefone) ||
    active.find((profile) => profile.tipo_usuario === 'corretor' && profile.telefone) ||
    active.find((profile) => profile.tipo_usuario === 'corretor_admin') ||
    active[0] ||
    null
  );
}

async function handoffBrokerageSessions(brokerIds: string[]) {
  if (!brokerIds.length) return 0;
  const { data: sessions, error } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('lead_id')
    .in('corretor_id', brokerIds)
    .eq('status', 'active');
  if (error) throw error;

  const results = await Promise.allSettled((sessions || []).map((session) =>
    handoffLeadAiToResponsible(
      session.lead_id,
      'WhatsApp da IA desconectou. O atendimento foi encaminhado para uma pessoa para o lead nao ficar sem resposta.'
    )
  ));
  return results.filter((result) => result.status === 'fulfilled').length;
}

export async function checkLeadAiInstanceHealth(options: MonitorOptions = {}) {
  const notify = options.notify !== false;
  const reconnect = options.reconnect !== false;
  const mutate = options.mutate !== false;
  const { data: configs, error: configError } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('id, corretora_id, status, sender_mode, sender_profile_id, dedicated_instance_name, updated_at')
    .in('status', ['ativo', 'aguardando_conexao', DISCONNECT_PENDING_STATUS, DISCONNECTED_STATUS]);
  if (configError) throw configError;
  if (!configs?.length) return { checked: 0, connected: 0, disconnected: 0, recovered: 0, alerts: 0, handoffs: 0, details: [] };

  const corretoraIds = configs.map((config) => config.corretora_id);
  const { data: companies, error: companyError } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .in('id', corretoraIds);
  if (companyError) throw companyError;

  const companyNames = (companies || []).map((company) => company.nome).filter(Boolean);
  const { data: brokers, error: brokerError } = companyNames.length
    ? await supabaseAdmin.from('corretores').select('id, nome_empresa').in('nome_empresa', companyNames)
    : { data: [], error: null };
  if (brokerError) throw brokerError;

  const brokerIds = (brokers || []).map((broker) => broker.id);
  const { data: profiles, error: profileError } = brokerIds.length
    ? await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, tipo_usuario, corretor_id, telefone, status, created_at')
        .in('corretor_id', brokerIds)
        .in('tipo_usuario', ['corretor_admin', 'corretor'])
    : { data: [], error: null };
  if (profileError) throw profileError;

  const companyById = new Map((companies || []).map((company) => [company.id, company]));
  const summary = { checked: 0, connected: 0, disconnected: 0, recovered: 0, alerts: 0, handoffs: 0 };
  const details: Array<{ company: string; instance: string | null; state: string; action: string }> = [];

  for (const rawConfig of configs) {
    const config = rawConfig as AiConfigRow;
    const company = companyById.get(config.corretora_id);
    if (!company?.nome) continue;
    const companyBrokerIds = (brokers || [])
      .filter((broker) => broker.nome_empresa === company.nome)
      .map((broker) => broker.id);
    const companyProfiles = (profiles || []).filter((profile) => companyBrokerIds.includes(profile.corretor_id));
    const sender = selectSenderProfile(config, companyProfiles as ProfileRow[]);
    const instance = config.sender_mode === 'dedicated'
      ? config.dedicated_instance_name || uazapiAiInstanceName(config.corretora_id)
      : sender ? uazapiInstanceName(sender.id) : null;
    summary.checked += 1;

    if (!instance) {
      summary.disconnected += 1;
      details.push({ company: company.nome, instance: null, state: 'missing_sender', action: 'waiting' });
      if (mutate && config.status === 'ativo') {
        await supabaseAdmin.from('corretora_ai_configs').update({ status: 'aguardando_conexao', updated_at: new Date().toISOString() }).eq('id', config.id);
      }
      continue;
    }

    let connection = await getUazapiInstanceConnection(instance).catch(() => ({ found: false, connected: false, state: 'check_failed' }));
    let recovered = false;
    // Reconectar sozinho so vale para sessao que ja funcionou e caiu. Enquanto
    // a configuracao esta em "aguardando_conexao", quem precisa agir e a pessoa
    // com o celular na mao: cada /instance/connect automatico gera um QR novo e
    // invalida o que ela esta lendo na tela. Era isso que fazia a IA da Evo Seg
    // conectar e cair, com o monitor disparando de minuto em minuto.
    if (
      !connection.connected
      && connection.found
      && reconnect
      && ['ativo', DISCONNECT_PENDING_STATUS].includes(config.status)
    ) {
      try {
        await uazapiFetch('/instance/connect', { method: 'POST', body: '{}' }, { instanceName: instance });
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        connection = await getUazapiInstanceConnection(instance);
        recovered = connection.connected;
      } catch (error) {
        console.warn('[lead_ai_health] Automatic reconnect failed for %s:', instance, error);
      }
    }

    if (connection.connected) {
      summary.connected += 1;
      if (recovered) summary.recovered += 1;
      await ensureUazapiWebhookConfigured(instance).catch((webhookError) => {
        console.error('[lead_ai_health] Failed refreshing webhook for %s:', instance, webhookError);
      });
      if (mutate && config.status !== 'ativo') {
        await supabaseAdmin.from('corretora_ai_configs').update({ status: 'ativo', updated_at: new Date().toISOString() }).eq('id', config.id);
      }
      details.push({ company: company.nome, instance, state: connection.state, action: recovered ? 'recovered' : 'healthy' });
      continue;
    }

    summary.disconnected += 1;

    // A primeira leitura negativa apenas inicia a janela de confirmacao. Isso
    // evita encerrar atendimentos por oscilacoes curtas do provedor.
    if (config.status === 'ativo') {
      if (mutate) {
        await supabaseAdmin
          .from('corretora_ai_configs')
          .update({ status: DISCONNECT_PENDING_STATUS, updated_at: new Date().toISOString() })
          .eq('id', config.id)
          .eq('status', 'ativo');
      }
      details.push({ company: company.nome, instance, state: connection.state, action: mutate ? 'confirming_disconnect' : 'would_confirm_disconnect' });
      continue;
    }

    if (config.status !== DISCONNECT_PENDING_STATUS) {
      details.push({ company: company.nome, instance, state: connection.state, action: 'waiting' });
      continue;
    }

    const pendingSince = new Date(config.updated_at).getTime();
    if (!Number.isFinite(pendingSince) || Date.now() - pendingSince < disconnectConfirmMs()) {
      details.push({ company: company.nome, instance, state: connection.state, action: 'confirming_disconnect' });
      continue;
    }

    // Confere uma ultima vez imediatamente antes de assumir a queda.
    const finalConnection = await getUazapiInstanceConnection(instance).catch(() => ({ found: false, connected: false, state: 'check_failed' }));
    if (finalConnection.connected) {
      summary.connected += 1;
      summary.disconnected -= 1;
      if (mutate) {
        await configureUazapiWebhook(instance);
        await supabaseAdmin
          .from('corretora_ai_configs')
          .update({ status: 'ativo', updated_at: new Date().toISOString() })
          .eq('id', config.id);
      }
      details.push({ company: company.nome, instance, state: finalConnection.state, action: 'recovered_before_alert' });
      continue;
    }

    if (!mutate) {
      details.push({ company: company.nome, instance, state: finalConnection.state, action: 'would_alert' });
      continue;
    }

    // A troca condicional funciona como um claim entre replicas: somente uma
    // delas consegue confirmar a queda e enviar a notificacao.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('corretora_ai_configs')
      .update({ status: DISCONNECTED_STATUS, updated_at: new Date().toISOString() })
      .eq('id', config.id)
      .eq('status', DISCONNECT_PENDING_STATUS)
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      details.push({ company: company.nome, instance, state: finalConnection.state, action: 'claimed_by_another_worker' });
      continue;
    }

    summary.handoffs += await handoffBrokerageSessions(companyBrokerIds);

    if (notify) {
      const recipients = (companyProfiles as ProfileRow[]).filter(
        (profile) => activeProfile(profile) && profile.tipo_usuario === 'corretor_admin'
      );
      const targets = recipients.length ? recipients : sender ? [sender] : [];
      if (targets.length) {
        const usesDedicatedNumber = config.sender_mode === 'dedicated';
        const notificationTitle = usesDedicatedNumber
          ? 'IA desconectada'
          : 'WhatsApp do Inbox desconectado';
        const notificationMessage = usesDedicatedNumber
          ? `O WhatsApp exclusivo da IA da ${company.nome} desconectou. A tentativa automatica de reconexao nao funcionou. Abra a pagina IA e escaneie um novo QR Code. Os atendimentos ativos foram encaminhados para o time.`
          : `O WhatsApp de ${sender?.nome || 'um integrante'}, usado pela IA da ${company.nome}, desconectou do Inbox. A tentativa automatica de reconexao nao funcionou. Abra o Inbox e reconecte o proprio numero. Os atendimentos ativos foram encaminhados para o time.`;
        await sendApoloWhatsApp({
          type: 'notificacao',
          title: notificationTitle,
          message: notificationMessage,
          profiles: targets,
          respectPreferences: false,
        });
        summary.alerts += targets.length;
      }
    }
    details.push({ company: company.nome, instance, state: finalConnection.state, action: 'alerted' });
  }

  return { ...summary, details };
}
