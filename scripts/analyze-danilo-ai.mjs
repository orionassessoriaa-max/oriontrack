import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const DANILO_CORRETOR_ID = '25c175c6-4bfc-41cd-8735-10fe91c53fe2';
const AI_SENDERS = new Set(['Aline']);
const TEST_RE = /teste|test|^cvbt$/i;

async function fetchAllMessages(conversationIds) {
  const result = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data, error } = await supabase
      .from('whatsapp_mensagens')
      .select('conversa_id,direction,remetente,mensagem,created_at')
      .order('created_at', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    result.push(...(data || []).filter((message) => conversationIds.has(message.conversa_id)));
    if (!data || data.length < 1000) break;
  }
  return result;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function minutesBetween(start, end) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60000;
}

async function main() {
  const { data: conversations, error: conversationError } = await supabase
    .from('whatsapp_conversas')
    .select('id,lead_id,telefone,nome_contato,created_at,ultima_mensagem_at,status')
    .eq('corretor_id', DANILO_CORRETOR_ID)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (conversationError) throw conversationError;

  const conversationIds = new Set((conversations || []).map((item) => item.id));
  const messages = await fetchAllMessages(conversationIds);
  const byConversation = new Map();
  for (const message of messages) {
    if (!byConversation.has(message.conversa_id)) byConversation.set(message.conversa_id, []);
    byConversation.get(message.conversa_id).push(message);
  }

  const rows = (conversations || []).map((conversation) => {
    const conversationMessages = (byConversation.get(conversation.id) || [])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const firstOutbound = conversationMessages.find((message) => message.direction === 'outbound');
    const aiFirstOutbound = conversationMessages.find(
      (message) => message.direction === 'outbound' && AI_SENDERS.has(message.remetente),
    );
    const aiInitiated = Boolean(aiFirstOutbound && (!firstOutbound || aiFirstOutbound.created_at === firstOutbound.created_at));
    const firstInboundAfterAi = aiFirstOutbound
      ? conversationMessages.find((message) => message.direction === 'inbound' && new Date(message.created_at) > new Date(aiFirstOutbound.created_at))
      : null;
    const firstInboundAfterOutbound = firstOutbound
      ? conversationMessages.find((message) => message.direction === 'inbound' && new Date(message.created_at) > new Date(firstOutbound.created_at))
      : null;
    const responseMinutes = aiFirstOutbound && firstInboundAfterAi
      ? minutesBetween(aiFirstOutbound.created_at, firstInboundAfterAi.created_at)
      : null;
    return {
      id: conversation.id,
      leadId: conversation.lead_id,
      name: conversation.nome_contato || 'Sem nome',
      phone: conversation.telefone,
      createdAt: conversation.created_at,
      messages: conversationMessages.length,
      inboundCount: conversationMessages.filter((message) => message.direction === 'inbound').length,
      outboundCount: conversationMessages.filter((message) => message.direction === 'outbound').length,
      aiMessageCount: conversationMessages.filter((message) => message.direction === 'outbound' && AI_SENDERS.has(message.remetente)).length,
      aiInitiated,
      responded: Boolean(firstInboundAfterAi),
      responseMinutes,
      firstOutboundSender: firstOutbound?.remetente || null,
      firstOutboundAt: firstOutbound?.created_at || null,
      firstLeadAfterOutboundAt: firstInboundAfterOutbound?.created_at || null,
      respondedAfterAnyOutbound: Boolean(firstInboundAfterOutbound),
      responseAfterAnyOutboundMinutes: firstOutbound && firstInboundAfterOutbound
        ? minutesBetween(firstOutbound.created_at, firstInboundAfterOutbound.created_at)
        : null,
      firstAiMessage: aiFirstOutbound?.mensagem || null,
      firstLeadMessage: firstInboundAfterAi?.mensagem || null,
      firstAiAt: aiFirstOutbound?.created_at || null,
      firstLeadAt: firstInboundAfterAi?.created_at || null,
      lastMessage: conversationMessages.at(-1)?.mensagem || null,
    };
  });

  const operational = rows.filter((row) => !TEST_RE.test(row.name) && row.messages > 0);
  const aiCohort = operational.filter((row) => row.aiInitiated);
  const responseRows = aiCohort.filter((row) => row.responded && row.responseMinutes != null);
  const responseTimes = responseRows.map((row) => row.responseMinutes);
  const respondedAfterAi = aiCohort.filter((row) => row.responded);
  const withAiMessages = operational.filter((row) => row.aiMessageCount > 0);
  const aiOnly = aiCohort.filter((row) => row.outboundCount === row.aiMessageCount);
  const handoffRows = aiCohort.filter((row) => row.outboundCount > row.aiMessageCount);
  const humanCohort = operational.filter((row) => !row.aiInitiated && row.firstOutboundAt);
  const humanResponded = humanCohort.filter((row) => row.respondedAfterAnyOutbound);
  const within15 = aiCohort.filter((row) => row.responseMinutes != null && row.responseMinutes <= 15);
  const within60 = aiCohort.filter((row) => row.responseMinutes != null && row.responseMinutes <= 60);
  const within24h = aiCohort.filter((row) => row.responseMinutes != null && row.responseMinutes <= 1440);

  const dayMap = new Map();
  for (const row of aiCohort) {
    const day = row.createdAt.slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, { date: day, total: 0, responded: 0 });
    const item = dayMap.get(day);
    item.total += 1;
    if (row.responded) item.responded += 1;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    scope: {
      corretor: 'Danilo Iacovone',
      corretorId: DANILO_CORRETOR_ID,
      totalConversations: rows.length,
      operationalConversations: operational.length,
      firstConversation: operational[0]?.createdAt || null,
      lastConversation: operational.at(-1)?.createdAt || null,
      exclusionRule: 'Conversas sem mensagens e nomes de teste/test foram excluidos da coorte operacional.',
    },
    headline: {
      aiInitiated: aiCohort.length,
      aiInitiatedRate: operational.length ? aiCohort.length / operational.length : null,
      leadsResponded: respondedAfterAi.length,
      responseRate: aiCohort.length ? respondedAfterAi.length / aiCohort.length : null,
      noResponse: aiCohort.length - respondedAfterAi.length,
      responseRateAllOperational: operational.length ? respondedAfterAi.length / operational.length : null,
      responseWithin15Minutes: aiCohort.length ? within15.length / aiCohort.length : null,
      responseWithin60Minutes: aiCohort.length ? within60.length / aiCohort.length : null,
      responseWithin24Hours: aiCohort.length ? within24h.length / aiCohort.length : null,
      humanInitiated: humanCohort.length,
      humanResponseRate: humanCohort.length ? humanResponded.length / humanCohort.length : null,
      observedDifferenceVsHuman: aiCohort.length && humanCohort.length
        ? respondedAfterAi.length / aiCohort.length - humanResponded.length / humanCohort.length
        : null,
      avgResponseMinutes: responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null,
      medianResponseMinutes: percentile(responseTimes, 0.5),
      p90ResponseMinutes: percentile(responseTimes, 0.9),
      fastestResponseMinutes: responseTimes.length ? Math.min(...responseTimes) : null,
      slowestResponseMinutes: responseTimes.length ? Math.max(...responseTimes) : null,
      aiOnlyConversations: aiOnly.length,
      handoffConversations: handoffRows.length,
      aiMessages: withAiMessages.reduce((total, row) => total + row.aiMessageCount, 0),
      inboundMessagesAfterAi: aiCohort.reduce((total, row) => total + row.inboundCount, 0),
    },
    byDay: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    rows,
    aiCohort,
  };

  const outputPath = path.resolve(process.cwd(), 'tmp', 'danilo-ai-analysis.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ outputPath, scope: result.scope, headline: result.headline, byDay: result.byDay }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
