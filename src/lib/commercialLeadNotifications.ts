import { openaiFetch } from '@/lib/openaiUso';
import 'server-only';

import { sendApoloWhatsApp } from '@/lib/apoloNotifications';
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

function firstName(value: unknown) {
  return plain(value).split(/\s+/)[0];
}

function fallbackMotivation(name: string, outsideMql: boolean) {
  const regular = [
    `Agora e contigo, ${name}! Responda rapido e vamos buscar mais uma vitoria. \ud83d\ude80`,
    `${name}, a oportunidade chegou: energia no atendimento e foco na meta! \ud83d\udcaa`,
    `Vai pra cima, ${name}! Atendimento rapido transforma oportunidade em resultado. \ud83c\udfaf`,
    `${name}, bola no peito e conversa no ponto: essa oportunidade e sua! \ud83d\udd25`,
  ];
  const outside = [
    `${name}, vamos converter esse lead e contrariar as estatisticas. O impossivel e so questao de opiniao! \ud83d\ude4f`,
    `Agora e contigo, ${name}: fora do MQL, mas nunca fora do jogo. Vamos pra cima! \ud83d\ude4f`,
    `${name}, esse lead veio para testar a tese: bom atendimento muda qualquer placar. \ud83d\ude4f`,
  ];
  const options = outsideMql ? outside : regular;
  return options[Math.floor(Math.random() * options.length)];
}

async function generateMotivation(sdrName: string, outsideMql: boolean) {
  const name = firstName(sdrName);
  const fallback = fallbackMotivation(name, outsideMql);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  try {
    const response = await openaiFetch('motivacao_lead', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        temperature: 1.05,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content: 'Crie uma unica frase motivacional curta em portugues do Brasil para um SDR que acabou de receber um lead. Seja humano, criativo e varie sempre. Use no maximo 22 palavras, inclua o primeiro nome do SDR, no maximo um emoji e nunca invente dados do lead. Nao use aspas, titulo ou explicacao.',
          },
          {
            role: 'user',
            content: outsideMql
              ? `SDR: ${name}. O lead esta fora do MQL. Faca um trocadilho leve sobre converter o lead, use o emoji de maos orando e mantenha o incentivo respeitoso.`
              : `SDR: ${name}. Incentive resposta rapida, energia e foco na meta.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const generated = String(payload?.choices?.[0]?.message?.content || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/^['"]|['"]$/g, '')
      .trim()
      .slice(0, 240);
    return generated || fallback;
  } catch {
    return fallback;
  }
}

async function loadCommercialNotificationProfiles(sdrId: string) {
  // select('*') de proposito: recebe_notificacoes so existe depois da migration
  // de 23/08, e pedir a coluna pelo nome quebraria a notificacao antes dela.
  const { data: members, error: memberError } = await supabaseAdmin
    .from('comercial_membros')
    .select('*')
    .eq('ativo', true);
  if (memberError) throw memberError;

  // O coordenador pode acompanhar o time sem receber cada lead no WhatsApp:
  // quem responde pela operacao comercial hoje e so o Pedro.
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

/**
 * Lead novo caiu na fila comum: todos os SDRs sao avisados e quem apertar Start
 * primeiro fica com ele. Sem dono definido, nao existe "agora e sua vez".
 */
export async function notifyCommercialLeadPool(lead: CommercialLeadNotification) {
  // O objeto identifica a origem do aviso, mas nenhum dado dele entra na
  // mensagem: antes do START a oportunidade precisa permanecer anonima.
  void lead;
  const { data: membros, error } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id, papel, ativo')
    // O closer tambem trabalha lead da fila desde que o nivel S deixou de ter
    // dono fixo. Sem ele na lista, o aviso chegaria so para os SDRs e ele
    // ficaria sabendo por ultimo.
    .in('papel', ['sdr', 'closer'])
    .eq('ativo', true);
  if (error) throw error;

  const ids = (membros || []).map((membro) => membro.profile_id);
  if (!ids.length) return [];

  const { data: perfis } = await supabaseAdmin
    .from('profiles')
    .select('id,nome,email,tipo_usuario,telefone')
    .in('id', ids)
    .in('status', ['active', 'ativo', 'Ativo']);

  const mensagem = [
    'Lead novo no CRM. Quem pegar primeiro fica com a oportunidade!',
    '',
    '1, 2, 3... GO!!!!!!',
    '',
    'Abra o Kanban e aperte START para assumir.',
  ].join('\n');

  return sendApoloWhatsApp({
    type: 'novo_lead',
    title: 'Novo lead: START liberado',
    message: mensagem,
    profiles: (perfis || []) as NotificationProfile[],
    respectPreferences: false,
  });
}

export async function notifyCommercialLeadAssignment(lead: CommercialLeadNotification) {
  const sdrId = String(lead.sdr_id || '').trim();
  if (!sdrId) return { sdr: [], coordinators: [] };

  const targets = await loadCommercialNotificationProfiles(sdrId);
  if (!targets.sdr) return { sdr: [], coordinators: [] };

  const outsideMql = !isCommercialMql(lead.faturamento_mensal, lead.investimento);
  const mqlLevel = getCommercialMqlLevel(lead.faturamento_mensal, lead.investimento);
  const motivation = await generateMotivation(targets.sdr.nome || 'SDR', outsideMql);
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
    '',
    motivation,
  ].join('\n');

  const [sdrResult, coordinatorResult] = await Promise.all([
    sendApoloWhatsApp({
      type: 'novo_lead',
      title: mqlLevel === 'S' ? 'Lead MQL S' : 'Agora e sua vez',
      message: sdrMessage,
      profiles: [targets.sdr],
      respectPreferences: false,
    }),
    sendApoloWhatsApp({
      type: 'novo_lead',
      title: 'Nova oportunidade distribuida',
      message: `${targets.sdr.nome || 'O SDR responsavel'} acabou de receber uma nova oportunidade.`,
      profiles: targets.coordinators,
      respectPreferences: false,
    }),
  ]);

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: null,
    actor_email: null,
    actor_role: 'system',
    action: 'commercial.lead.assignment_notifications',
    entity_type: 'commercial_lead',
    entity_id: lead.id,
    metadata: {
      sdr_id: targets.sdr.id,
      sdr_delivery: sdrResult.map((item) => ({ profile_id: item.profile_id, status: item.status, reason: 'reason' in item ? item.reason : null })),
      coordinator_delivery: coordinatorResult.map((item) => ({ profile_id: item.profile_id, status: item.status, reason: 'reason' in item ? item.reason : null })),
      apolo_instance: 'apolo_master_sender',
    },
    ip_address: null,
    user_agent: 'Orion Track / Apolo Notificador',
  });

  if (!sdrResult.some((item) => item.status === 'success')) {
    throw new Error(`Apolo nao entregou o aviso ao SDR ${targets.sdr.nome || targets.sdr.id}.`);
  }

  return { sdr: sdrResult, coordinators: coordinatorResult };
}
