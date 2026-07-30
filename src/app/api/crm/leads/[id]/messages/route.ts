import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

const CRM_MESSAGE_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;

async function canAccessLead(profile: any, lead: any) {
  if (profile.tipo_usuario === 'admin' || profile.tipo_usuario === 'account_manager') return true;
  if (profile.tipo_usuario === 'corretor_membro') return lead.responsavel_profile_id === profile.id;
  if (!['corretor', 'corretor_admin'].includes(profile.tipo_usuario)) return false;
  if (lead.corretor_id === profile.corretor_id) return true;

  const brokerIds = [profile.corretor_id, lead.corretor_id].filter(Boolean);
  if (brokerIds.length < 2) return false;

  const { data: brokers } = await supabaseAdmin
    .from('corretores')
    .select('id,nome_empresa')
    .in('id', brokerIds);

  const ownBroker = brokers?.find((broker) => broker.id === profile.corretor_id);
  const leadBroker = brokers?.find((broker) => broker.id === lead.corretor_id);
  return Boolean(
    ownBroker?.nome_empresa
    && leadBroker?.nome_empresa
    && ownBroker.nome_empresa.trim().toLowerCase() === leadBroker.nome_empresa.trim().toLowerCase()
  );
}

function dedupeMessages(messages: any[]) {
  const providerIds = new Set<string>();
  const ids = new Set<string>();

  return messages.filter((message) => {
    const id = String(message?.id || '');
    const providerId = String(message?.provider_message_id || '').trim();
    if (id && ids.has(id)) return false;
    if (providerId && providerIds.has(providerId)) return false;
    if (id) ids.add(id);
    if (providerId) providerIds.add(providerId);
    return true;
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimit(request, 'crm:lead-messages:read', { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, [...CRM_MESSAGE_ROLES]);
    if ('error' in guard) return guard.error;

    const { id: leadId } = await context.params;
    const { data: lead, error: leadError } = await supabaseAdmin
      .from('leads')
      .select('id,telefone,corretor_id,responsavel_profile_id')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!lead) {
      return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });
    }
    if (!(await canAccessLead(guard.profile, lead))) {
      return NextResponse.json({ error: 'Acesso negado para este lead.' }, { status: 403 });
    }

    const phoneDigits = String(lead.telefone || '').replace(/\D/g, '');
    const last8 = phoneDigits.length >= 8 ? phoneDigits.slice(-8) : '';
    let conversationsQuery = supabaseAdmin
      .from('whatsapp_conversas')
      .select('id')
      .eq('corretor_id', lead.corretor_id);

    conversationsQuery = last8
      ? conversationsQuery.or(`lead_id.eq.${lead.id},telefone.ilike.%${last8}`)
      : conversationsQuery.eq('lead_id', lead.id);

    const { data: conversations, error: conversationsError } = await conversationsQuery.limit(100);
    if (conversationsError) throw conversationsError;

    const conversationIds = (conversations || []).map((conversation) => conversation.id);
    if (!conversationIds.length) {
      return NextResponse.json(
        { messages: [], total: 0 },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('id,conversa_id,direction,remetente,mensagem,created_at,provider_message_id,metadata')
      .in('conversa_id', conversationIds)
      .order('created_at', { ascending: true })
      .limit(2000);

    if (messagesError) throw messagesError;
    const completeHistory = dedupeMessages(messages || []);

    return NextResponse.json(
      { messages: completeHistory, total: completeHistory.length },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Nao foi possivel carregar a conversa.' },
      { status: 500 }
    );
  }
}
