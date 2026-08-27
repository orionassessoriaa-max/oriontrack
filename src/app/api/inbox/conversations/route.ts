import { after, NextResponse } from 'next/server';
import { ApiProfile, requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncRecentInboxChats } from '@/lib/uazapiInboxSync';
import { UserRole } from '@/types';

const INBOX_LIST_ROLES = ['admin', 'account_manager', 'corretor', 'corretor_admin'] as const;
const INBOX_TARGET_ROLES = ['account_manager', 'corretor', 'corretor_admin'] as const;

type InboxTargetProfile = ApiProfile & {
  nome_empresa?: string | null;
};

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

async function listConversations(corretorIds: string[], assignedLeadIds: string[]) {
  const rows: any[] = [];
  const pageSize = 500;

  for (let from = 0; ; from += pageSize) {
    let query = supabaseAdmin
      .from('whatsapp_conversas')
      .select('*,leads(id,nome,status,responsavel_profile_id,responsavel_membro:responsavel_membro_id(id,nome))')
      .order('ultima_mensagem_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (assignedLeadIds.length > 0) {
      query = query.or(
        `corretor_id.in.(${corretorIds.join(',')}),lead_id.in.(${assignedLeadIds.join(',')})`
      );
    } else {
      query = query.in('corretor_id', corretorIds);
    }

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
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

export async function GET(request: Request) {
  const guard = await requireApiUser(request, INBOX_LIST_ROLES as unknown as UserRole[]);
  if ('error' in guard) return guard.error;

  try {
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

    const assignedLeadIds = await listAssignedLeadIds(target.id);
    const conversations = await listConversations(corretorIds, assignedLeadIds);
    after(async () => {
      await syncRecentInboxChats(target.id, conversations);
    });
    const leadIds = Array.from(new Set(
      conversations.map((conversation) => conversation.lead_id).filter(Boolean).map(String)
    ));
    let openFollowUpLeadIds = new Set<string>();
    try {
      openFollowUpLeadIds = await listOpenFollowUpLeadIds(leadIds);
    } catch (followUpError) {
      // A sinalizacao de tarefa e complementar. Uma falha nela nao pode
      // impedir o corretor de abrir o Inbox e acessar as mensagens.
      console.error('[Inbox conversations] Falha ao consultar follow-ups:', followUpError);
    }

    return NextResponse.json({
      conversations: conversations.map((conversation) => ({
        ...conversation,
        hasOpenFollowUp: Boolean(
          conversation.lead_id && openFollowUpLeadIds.has(String(conversation.lead_id))
        ),
      })),
      corretorIds,
      assignedLeadIds,
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
