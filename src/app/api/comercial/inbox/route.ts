import { NextResponse } from 'next/server';
import { applyCommercialLeadScope, requireCommercialUser, type CommercialGuard } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cachedPayload } from '@/lib/api/responseCache';

function digits(value: unknown) { return String(value || '').replace(/\D/g, '').slice(-11); }

// A tela do inbox recarrega em laco. Sem cache, cada aba aberta multiplica a
// varredura de leads e conversas em cima do banco.
const INBOX_CACHE_MS = 12_000;

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  return cachedPayload(
    `comercial:inbox:${guard.commercialRole}:${guard.profile.id}`,
    INBOX_CACHE_MS,
    () => buildInboxPayload(guard),
  ).then((payload) => NextResponse.json(payload));
}

async function buildInboxPayload(guard: CommercialGuard) {
  let leadQuery = supabaseAdmin
    .from('comercial_leads')
    .select('id,nome,telefone,email,empresa,estado,origem,campanha,sdr_id,closer_id,status,prioridade,vidas,ja_investiu_trafego,faturamento_mensal,investimento,data_entrada,ultimo_contato_at,utm_source,utm_campaign,updated_at')
    .limit(5000);
  leadQuery = applyCommercialLeadScope(leadQuery, guard.commercialRole, guard.profile.id);
  const { data: leads, error: leadError } = await leadQuery;
  if (leadError) throw new Error(leadError.message);
  const phoneMap = new Map<string, any>();
  for (const lead of leads || []) { const phone = digits(lead.telefone); if (phone) phoneMap.set(phone, lead); }
  if (!phoneMap.size) return { conversations: [], role: guard.commercialRole };
  const { data: conversations, error } = await supabaseAdmin.from('whatsapp_conversas').select('id,lead_id,corretor_id,telefone,nome_contato,status,ultima_mensagem_at,updated_at').order('ultima_mensagem_at', { ascending: false, nullsFirst: false }).limit(3000);
  if (error) throw new Error(error.message);
  const result = (conversations || []).map((conversation) => ({ ...conversation, commercial_lead: phoneMap.get(digits(conversation.telefone)) || null })).filter((conversation) => conversation.commercial_lead);
  return { conversations: result, role: guard.commercialRole };
}
