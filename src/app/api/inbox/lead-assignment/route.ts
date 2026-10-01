import { NextResponse } from 'next/server';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, phoneMatchKey } from '@/lib/uazapi';
import type { UserRole } from '@/types';

const ALLOWED_ROLES: UserRole[] = ['admin', 'corretor', 'corretor_admin', 'corretor_membro'];
const ACTIVE_STATUSES = ['active', 'ativo', 'Ativo'];

async function getTeam(corretorId: string) {
  const { data, error } = await supabaseAdmin
    .from('corretor_times')
    .select('id, corretor_id')
    .eq('corretor_id', corretorId)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function isUnityBrokerage(corretorId: string) {
  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.nome_empresa || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase() === 'UNITY SAUDE';
}

type InboxConversation = {
  id: string;
  corretor_id: string | null;
  lead_id: string | null;
  telefone: string | null;
  nome_contato: string | null;
};

async function findLeadByPhone(corretorId: string, telefone: string | null) {
  const matchKey = phoneMatchKey(telefone);
  if (!matchKey) return null;

  const suffix = normalizePhone(telefone).slice(-8);
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, responsavel_profile_id, telefone, updated_at, created_at')
    .eq('corretor_id', corretorId)
    .ilike('telefone', `%${suffix}%`)
    .order('updated_at', { ascending: false })
    .limit(25);

  if (error) throw error;
  return (data || []).find((lead) => phoneMatchKey(lead.telefone) === matchKey) || null;
}

async function linkOrphanConversations(
  corretorId: string,
  telefone: string | null,
  leadId: string,
  requiredConversationId: string
) {
  const matchKey = phoneMatchKey(telefone);
  const suffix = normalizePhone(telefone).slice(-8);
  const matchingIds = new Set<string>([requiredConversationId]);

  if (matchKey && suffix) {
    const { data, error } = await supabaseAdmin
      .from('whatsapp_conversas')
      .select('id, telefone')
      .eq('corretor_id', corretorId)
      .is('lead_id', null)
      .ilike('telefone', `%${suffix}%`)
      .limit(100);
    if (error) throw error;
    (data || []).forEach((conversation) => {
      if (phoneMatchKey(conversation.telefone) === matchKey) matchingIds.add(String(conversation.id));
    });
  }

  const ids = Array.from(matchingIds);
  const { error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .update({ lead_id: leadId })
    .in('id', ids)
    .eq('corretor_id', corretorId)
    .is('lead_id', null);
  if (error) throw error;
  return ids;
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ALLOWED_ROLES);
  if ('error' in guard) return guard.error;
  if (!guard.profile.corretor_id) {
    return NextResponse.json({ error: 'Conta comercial nao encontrada.' }, { status: 400 });
  }

  try {
    if (guard.profile.tipo_usuario === 'corretor_membro' && !(await isUnityBrokerage(guard.profile.corretor_id))) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }
    const team = await getTeam(guard.profile.corretor_id);
    if (!team) return NextResponse.json({ membros: [] });

    const { data, error } = await supabaseAdmin
      .from('corretor_time_membros')
      .select('id, profile_id, nome, email, status, ordem')
      .eq('time_id', team.id)
      .in('status', ACTIVE_STATUSES)
      .not('profile_id', 'is', null)
      .order('ordem', { ascending: true });
    if (error) throw error;

    return NextResponse.json({ membros: data || [] }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[Inbox assignment] Falha ao listar responsaveis:', error);
    return NextResponse.json({ error: 'Nao foi possivel carregar os responsaveis.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ALLOWED_ROLES);
  if ('error' in guard) return guard.error;
  if (!guard.profile.corretor_id) {
    return NextResponse.json({ error: 'Conta comercial nao encontrada.' }, { status: 400 });
  }

  try {
    if (guard.profile.tipo_usuario === 'corretor_membro' && !(await isUnityBrokerage(guard.profile.corretor_id))) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }
    const body = await request.json();
    const requestedLeadId = String(body.lead_id || '').trim();
    const conversationId = String(body.conversation_id || '').trim();
    const memberId = String(body.member_id || '').trim();
    if ((!requestedLeadId && !conversationId) || !memberId) {
      return NextResponse.json({ error: 'Informe a conversa e o novo responsavel.' }, { status: 400 });
    }

    const team = await getTeam(guard.profile.corretor_id);
    if (!team) return NextResponse.json({ error: 'Time comercial nao encontrado.' }, { status: 404 });

    const { data: member, error: memberError } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id, nome')
        .eq('id', memberId)
        .eq('time_id', team.id)
        .in('status', ACTIVE_STATUSES)
        .not('profile_id', 'is', null)
        .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return NextResponse.json({ error: 'Responsavel nao encontrado neste time.' }, { status: 404 });

    let conversation: InboxConversation | null = null;
    if (conversationId) {
      const { data, error } = await supabaseAdmin
        .from('whatsapp_conversas')
        .select('id, corretor_id, lead_id, telefone, nome_contato')
        .eq('id', conversationId)
        .eq('corretor_id', guard.profile.corretor_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
      conversation = data as InboxConversation;
    }

    const leadId = requestedLeadId || conversation?.lead_id || '';
    let lead = null;
    if (leadId) {
      const { data, error } = await supabaseAdmin
        .from('leads')
        .select('id, corretor_id, responsavel_profile_id, telefone')
        .eq('id', leadId)
        .eq('corretor_id', guard.profile.corretor_id)
        .maybeSingle();
      if (error) throw error;
      lead = data;
    }

    if (!lead && conversation?.telefone) {
      lead = await findLeadByPhone(guard.profile.corretor_id, conversation.telefone);
    }

    let createdLead = false;
    if (!lead && conversation) {
      if (guard.profile.tipo_usuario === 'corretor_membro') {
        return NextResponse.json({ error: 'Somente um administrador pode cadastrar e encaminhar este contato.' }, { status: 403 });
      }
      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from('leads')
        .insert({
          corretor_id: guard.profile.corretor_id,
          nome: String(conversation.nome_contato || '').trim() || 'Contato WhatsApp',
          telefone: normalizePhone(conversation.telefone),
          origem: 'WhatsApp',
          utm_source: 'WhatsApp',
          status: 'Aguardando atendimento',
          data_entrada: now,
          created_at: now,
          updated_at: now,
        })
        .select('id, corretor_id, responsavel_profile_id, telefone')
        .single();
      if (error) throw error;
      lead = data;
      createdLead = true;
    }

    if (!lead) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });

    if (guard.profile.tipo_usuario === 'corretor_membro' && lead.responsavel_profile_id !== guard.profile.id) {
      return NextResponse.json({ error: 'Voce so pode encaminhar leads atribuidos a voce.' }, { status: 403 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('leads')
      .update({
        responsavel_membro_id: member.id,
        responsavel_profile_id: member.profile_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
      .eq('corretor_id', guard.profile.corretor_id);
    if (updateError) throw updateError;

    const linkedConversationIds = conversation
      ? await linkOrphanConversations(
          guard.profile.corretor_id,
          conversation.telefone,
          lead.id,
          conversation.id
        )
      : [];

    await supabaseAdmin.from('lead_atividades').insert({
      lead_id: lead.id,
      profile_id: guard.profile.id,
      tipo: 'sistema',
      titulo: 'Responsavel alterado',
      descricao: `Encaminhado para o responsavel: ${member.nome}`,
    });

    await writeAuditLog(request, guard.profile, {
      action: 'inbox.lead.forward',
      entity_type: 'lead',
      entity_id: lead.id,
      metadata: {
        from_profile_id: lead.responsavel_profile_id,
        to_profile_id: member.profile_id,
        member_id: member.id,
        conversation_id: conversation?.id || null,
        created_lead: createdLead,
        linked_conversations: linkedConversationIds.length,
      },
    });

    return NextResponse.json({
      success: true,
      member,
      lead: { id: lead.id },
      createdLead,
      linkedConversationIds,
    });
  } catch (error) {
    console.error('[Inbox assignment] Falha ao encaminhar lead:', error);
    return NextResponse.json({ error: 'Nao foi possivel encaminhar o lead.' }, { status: 500 });
  }
}
