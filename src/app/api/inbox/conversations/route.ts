import { after, NextResponse } from 'next/server';
import { ApiProfile, requireApiUser } from '@/lib/api/security';
import { isIgnoredInboxContact } from '@/lib/inboxIgnoredContacts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { phoneMatchKey } from '@/lib/uazapi';
import { syncRecentInboxChats } from '@/lib/uazapiInboxSync';
import { UserRole } from '@/types';

const INBOX_LIST_ROLES = ['admin', 'account_manager', 'corretor', 'corretor_admin', 'corretor_membro'] as const;
const INBOX_TARGET_ROLES = ['account_manager', 'corretor', 'corretor_admin', 'corretor_membro'] as const;
const UNREAD_TRACKING_STARTED_AT = '2026-10-01T20:48:14.000Z';

type InboxTargetProfile = ApiProfile & {
  nome_empresa?: string | null;
};

function normalizedCompanyName(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function canViewTarget(actor: ApiProfile, target: InboxTargetProfile) {
  if (actor.id === target.id) return true;
  if (actor.tipo_usuario === 'admin') return true;
  return Boolean(
    actor.tipo_usuario === 'account_manager'
    && actor.corretor_id
    && actor.corretor_id === target.corretor_id
  );
}

async function resolveTargetProfile(request: Request, actor: ApiProfile) {
  const targetProfileId = request.headers.get('x-orion-view-profile-id');
  if (!targetProfileId || targetProfileId === actor.id) {
    return actor as InboxTargetProfile;
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,email_real,nome,tipo_usuario,corretor_id,telefone,status,is_admin_master,equipe_orion,nome_empresa')
    .eq('id', targetProfileId)
    .in('tipo_usuario', INBOX_TARGET_ROLES as unknown as string[])
    .maybeSingle();

  if (error) throw error;
  if (!data || !canViewTarget(actor, data as InboxTargetProfile)) {
    throw new Error('Voce nao tem permissao para visualizar este Inbox.');
  }

  return data as InboxTargetProfile;
}

async function listAssignedLeadIds(profileId: string) {
  const ids: string[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('responsavel_profile_id', profileId)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    ids.push(...(data || []).map((lead) => String(lead.id)).filter(Boolean));
    if (!data || data.length < pageSize) break;
  }

  return ids;
}

async function listConversations(
  corretorIds: string[],
  assignedLeadIds: string[],
  offset: number,
  limit: number,
  responsibleFilter: string | null
) {
  let query = supabaseAdmin
    .from('whatsapp_conversas')
    .select(responsibleFilter
      ? '*,leads!inner(id,nome,status,etiqueta,responsavel_profile_id,responsavel_membro:responsavel_membro_id(id,nome))'
      : '*,leads(id,nome,status,etiqueta,responsavel_profile_id,responsavel_membro:responsavel_membro_id(id,nome))')
    .order('ultima_mensagem_at', { ascending: false })
    .order('id', { ascending: true })
    // Busca um item extra para informar se existe historico a carregar, sem
    // fazer uma contagem cara a cada atualizacao do Inbox.
    .range(offset, offset + limit);

  if (responsibleFilter === 'sem_responsavel') {
    query = query.is('leads.responsavel_profile_id', null);
  } else if (responsibleFilter) {
    // O filtro acontece no banco, antes da paginacao. Filtrar somente no
    // navegador faria um responsavel com conversas mais antigas desaparecer
    // quando elas nao estivessem entre as 100 primeiras da fila geral.
    query = query.eq('leads.responsavel_profile_id', responsibleFilter);
  } else if (assignedLeadIds.length > 0) {
    query = query.or(
      `corretor_id.in.(${corretorIds.join(',')}),lead_id.in.(${assignedLeadIds.join(',')})`
    );
  } else {
    query = query.in('corretor_id', corretorIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  // Numeros internos nunca pertencem ao funil e nao podem reaparecer mesmo
  // se algum provedor ou importacao gravar uma conversa fora do webhook.
  const rawPage = data || [];
  const page = rawPage.filter((conversation) => !isIgnoredInboxContact(conversation.telefone));
  const conversations = Array.from(page.reduce((byPhone: Map<string, any>, conversation: any) => {
    const key = phoneMatchKey(conversation.telefone) || `conversation:${conversation.id}`;
    const current = byPhone.get(key);
    // A lista preserva uma unica entrada por contato. Quando ha uma conversa
    // antiga sem lead e outra ja vinculada, a vinculada representa o contato;
    // as mensagens continuam sendo reunidas pelo telefone ao abrir o chat.
    if (!current || (!current.lead_id && conversation.lead_id)) byPhone.set(key, conversation);
    return byPhone;
  }, new Map<string, any>()).values());
  return {
    conversations: conversations.slice(0, limit),
    hasMore: rawPage.length > limit,
    nextOffset: rawPage.length > limit ? offset + limit : null,
  };
}

async function listOpenFollowUpLeadIds(leadIds: string[]) {
  const ids = new Set<string>();
  const batchSize = 200;

  for (let from = 0; from < leadIds.length; from += batchSize) {
    const batch = leadIds.slice(from, from + batchSize);
    const { data, error } = await supabaseAdmin
      .from('lead_tarefas')
      .select('lead_id')
      .in('lead_id', batch)
      .eq('status', 'pendente');

    if (error) throw error;
    (data || []).forEach((task) => {
      if (task.lead_id) ids.add(String(task.lead_id));
    });
  }

  return ids;
}

async function listHumanReplyConversationIds(conversationIds: string[]) {
  const ids = new Set<string>();
  if (!conversationIds.length) return ids;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('conversa_id')
      .in('conversa_id', conversationIds)
      .eq('direction', 'outbound')
      .contains('metadata', { sender_type: 'human' })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    (data || []).forEach((message) => ids.add(String(message.conversa_id)));
    if (!data || data.length < pageSize) break;
  }
  return ids;
}

/**
 * Quantas mensagens recebidas chegaram depois da ultima vez que ESTA pessoa
 * abriu cada conversa.
 *
 * Antes isso vivia no localStorage e so era escrito pelo Realtime com a tela
 * aberta: quem fechava o CRM nao via nada marcado ao voltar. Agora e derivado
 * do dado, entao sobrevive a recarregar, trocar de maquina e ficar offline.
 *
 * Se a tabela de leitura ainda nao existir no banco, devolve vazio em vez de
 * estourar — o Inbox precisa abrir mesmo com a migracao pendente.
 */
async function countUnreadByConversation(conversationIds: string[], profileId: string) {
  const unread = new Map<string, { count: number; lastAt: string | null }>();
  if (!conversationIds.length) return unread;

  const { data: leituras, error: leiturasError } = await supabaseAdmin
    .from('inbox_conversa_leituras')
    .select('conversa_id, lido_ate')
    .eq('profile_id', profileId)
    .in('conversa_id', conversationIds);

  const lidoAte = new Map<string, string>();
  if (leiturasError) {
    console.warn('[Inbox conversations] Tabela de leituras indisponivel, usando auditoria:', leiturasError.message);
  } else {
    (leituras || []).forEach((row) => lidoAte.set(String(row.conversa_id), String(row.lido_ate)));
  }

  // Compatibilidade imediata enquanto a migration da tabela dedicada nao
  // estiver disponivel. O marcador vive em audit_logs e continua valido
  // depois que a migration for aplicada, evitando que conversas ja abertas
  // reaparecam como nao lidas na troca de armazenamento.
  const semLeitura = conversationIds.filter((id) => !lidoAte.has(id));
  if (semLeitura.length) {
    const { data: marcadores, error: marcadoresError } = await supabaseAdmin
      .from('audit_logs')
      .select('entity_id,created_at')
      .eq('actor_profile_id', profileId)
      .eq('action', 'inbox.conversation.read')
      .eq('entity_type', 'whatsapp_conversa')
      .in('entity_id', semLeitura)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (marcadoresError) {
      console.error('[Inbox conversations] Marcadores alternativos indisponiveis:', marcadoresError.message);
    } else {
      (marcadores || []).forEach((row) => {
        const conversaId = String(row.entity_id || '');
        if (conversaId && !lidoAte.has(conversaId)) {
          lidoAte.set(conversaId, String(row.created_at));
        }
      });
    }
  }

  // Uma consulta so para todas as conversas da pagina, filtrando pelo corte
  // mais antigo; o resto e separado em memoria, como ja faz o human reply.
  const cortes = conversationIds.map((id) => lidoAte.get(id) || UNREAD_TRACKING_STARTED_AT);
  const corteMaisAntigo = cortes.sort()[0];

  let query = supabaseAdmin
    .from('whatsapp_mensagens')
    .select('conversa_id, created_at')
    .in('conversa_id', conversationIds)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (corteMaisAntigo) query = query.gt('created_at', corteMaisAntigo);

  const { data: mensagens, error: mensagensError } = await query;
  if (mensagensError) {
    console.error('[Inbox conversations] Contagem de nao lidas indisponivel:', mensagensError.message);
    return unread;
  }

  (mensagens || []).forEach((mensagem) => {
    const conversaId = String(mensagem.conversa_id);
    const corte = lidoAte.get(conversaId) || UNREAD_TRACKING_STARTED_AT;
    if (String(mensagem.created_at) <= corte) return;
    const atual = unread.get(conversaId) || { count: 0, lastAt: null };
    atual.count += 1;
    if (!atual.lastAt || String(mensagem.created_at) > atual.lastAt) atual.lastAt = String(mensagem.created_at);
    unread.set(conversaId, atual);
  });

  return unread;
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, INBOX_LIST_ROLES as unknown as UserRole[]);
  if ('error' in guard) return guard.error;

  try {
    const url = new URL(request.url);
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const limit = Math.min(200, Math.max(25, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100));
    const target = await resolveTargetProfile(request, guard.profile);
    if (!target.corretor_id) {
      return NextResponse.json({ conversations: [], corretorIds: [], assignedLeadIds: [] });
    }

    const { data: baseBroker, error: baseBrokerError } = await supabaseAdmin
      .from('corretores')
      .select('id,nome_empresa')
      .eq('id', target.corretor_id)
      .maybeSingle();

    if (baseBrokerError) throw baseBrokerError;

    let corretorIds = [target.corretor_id];
    const companyName = String(baseBroker?.nome_empresa || target.nome_empresa || '').trim();
    if (companyName) {
      const { data: companyBrokers, error: companyBrokersError } = await supabaseAdmin
        .from('corretores')
        .select('id')
        .eq('nome_empresa', companyName);

      if (companyBrokersError) throw companyBrokersError;
      if (companyBrokers?.length) {
        corretorIds = companyBrokers.map((broker) => String(broker.id)).filter(Boolean);
      }
    }

    const requestedResponsibleProfileId = String(
      url.searchParams.get('responsible_profile_id') || ''
    ).trim();
    let responsibleProfileId = target.tipo_usuario === 'corretor_membro'
      ? target.id
      : null;

    if (!responsibleProfileId && requestedResponsibleProfileId === 'sem_responsavel') {
      responsibleProfileId = 'sem_responsavel';
    } else if (!responsibleProfileId && requestedResponsibleProfileId) {
      const { data: responsibleProfile, error: responsibleProfileError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', requestedResponsibleProfileId)
        .in('corretor_id', corretorIds)
        .maybeSingle();

      if (responsibleProfileError) throw responsibleProfileError;
      if (!responsibleProfile) {
        return NextResponse.json({ error: 'Responsavel fora desta corretora.' }, { status: 403 });
      }
      responsibleProfileId = responsibleProfile.id;
    }

    const assignedLeadIds = target.tipo_usuario === 'corretor_membro'
      ? []
      : await listAssignedLeadIds(target.id);
    const page = await listConversations(
      corretorIds,
      assignedLeadIds,
      offset,
      limit,
      responsibleProfileId
    );
    const conversations = page.conversations;
    after(async () => {
      await syncRecentInboxChats(target.id, conversations);
    });
    const leadIds = Array.from(new Set(
      conversations.map((conversation) => conversation.lead_id).filter(Boolean).map(String)
    ));
    let openFollowUpLeadIds = new Set<string>();
    let humanReplyConversationIds = new Set<string>();
    let unreadByConversation = new Map<string, { count: number; lastAt: string | null }>();
    try {
      [openFollowUpLeadIds, humanReplyConversationIds, unreadByConversation] = await Promise.all([
        listOpenFollowUpLeadIds(leadIds),
        normalizedCompanyName(companyName) === 'UNITY SAUDE'
          ? listHumanReplyConversationIds(conversations.map((conversation) => String(conversation.id)))
          : Promise.resolve(new Set<string>()),
        countUnreadByConversation(conversations.map((conversation) => String(conversation.id)), guard.profile.id),
      ]);
    } catch (followUpError) {
      // A sinalizacao de tarefa e complementar. Uma falha nela nao pode
      // impedir o corretor de abrir o Inbox e acessar as mensagens.
      console.error('[Inbox conversations] Falha ao consultar follow-ups:', followUpError);
    }

    return NextResponse.json({
      conversations: conversations.map((conversation) => {
        const lead = conversation.leads as unknown as { etiqueta?: string | null } | null;
        const etiqueta = String(lead?.etiqueta || '').trim();
        return {
          ...conversation,
          tags: etiqueta ? [etiqueta] : [],
          hasOpenFollowUp: Boolean(
            conversation.lead_id && openFollowUpLeadIds.has(String(conversation.lead_id))
          ),
          hasHumanReply: humanReplyConversationIds.has(String(conversation.id)),
          unreadCount: unreadByConversation.get(String(conversation.id))?.count || 0,
          unreadLastAt: unreadByConversation.get(String(conversation.id))?.lastAt || null,
        };
      }),
      corretorIds,
      assignedLeadIds,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[Inbox conversations] Falha ao listar conversas:', error);
    const message = error instanceof Error ? error.message : 'Nao foi possivel carregar as conversas.';
    const status = message.includes('permissao') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
