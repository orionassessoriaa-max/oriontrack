import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const CORRETOR_ID = '25c175c6-4bfc-41cd-8735-10fe91c53fe2';
const OUTPUT = path.resolve(process.cwd(), 'tmp', 'sandro-henrique-complete-analysis.json');
const TEST_RE = /(^|\s)(teste?|cvbt)(\s|$)/i;
const SALE_RE = /documenta|1.? pagamento|venda realizada/i;
const ACTIVE_RE = /cota[cç][aã]o enviada|negocia|stand.?by|documenta|pagamento|venda/i;

const fold = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const time = (value) => new Date(value).getTime();
const minutes = (a, b) => (time(b) - time(a)) / 60000;
const rate = (n, d) => d ? n / d : null;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function localDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}

function monthKey(value) {
  return localDay(value).slice(0, 7);
}

function senderKind(message) {
  if (message.direction !== 'outbound') return 'Lead';
  const sender = fold(message.remetente);
  const metadata = fold([
    message.metadata?.sender_name,
    message.metadata?.ai_agent,
    message.metadata?.sender_type,
    message.metadata?.sent_by_name,
  ].filter(Boolean).join(' '));
  const combined = `${sender} ${metadata}`;
  if (combined.includes('sandro')) return 'Sandro';
  if (combined.includes('henrique')) return 'Henrique';
  if (combined.includes('aline') || metadata === 'ai' || metadata.includes('assistente')) return 'Aline';
  if (combined.includes('danilo')) return 'Danilo';
  return message.remetente ? `Outro: ${message.remetente}` : 'Outro sem identificação';
}

function maskName(value) {
  const parts = String(value || 'Lead').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || 'Lead';
  return `${parts[0]} ${parts.at(-1)[0]}.`;
}

function normalizeTemplate(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b\d{2,}[\d./-]*\b/g, '[n]')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function fetchPaged(table, select, configure) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db.from(table).select(select).range(offset, offset + 999);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchMessages(conversationIds) {
  const ids = [...conversationIds];
  const rows = [];
  let exactCount = 0;
  for (let start = 0; start < ids.length; start += 30) {
    const chunk = ids.slice(start, start + 30);
    const { count, error: countError } = await db
      .from('whatsapp_mensagens')
      .select('id', { count: 'exact', head: true })
      .in('conversa_id', chunk);
    if (countError) throw new Error(`whatsapp_mensagens count: ${countError.message}`);
    exactCount += count || 0;
    const part = await fetchPaged(
      'whatsapp_mensagens',
      'id,conversa_id,direction,remetente,mensagem,created_at,metadata',
      (query) => query.in('conversa_id', chunk).order('created_at', { ascending: true }).order('id', { ascending: true }),
    );
    rows.push(...part);
  }
  return { rows, exactCount };
}

function sellerTurns(messages, seller) {
  const turns = [];
  let current = null;
  for (const message of messages) {
    const kind = senderKind(message);
    if (kind === seller) {
      if (!current) current = { messages: [], firstAt: message.created_at, lastAt: message.created_at };
      current.messages.push(message);
      current.lastAt = message.created_at;
      continue;
    }
    if (current) {
      current.next = message;
      turns.push(current);
      current = null;
    }
  }
  if (current) turns.push(current);
  return turns.map((turn) => {
    const reply = turn.next?.direction === 'inbound' ? turn.next : null;
    return {
      firstAt: turn.firstAt,
      lastAt: turn.lastAt,
      messages: turn.messages.length,
      characters: turn.messages.reduce((sum, message) => sum + String(message.mensagem || '').length, 0),
      replied: Boolean(reply),
      responseMinutes: reply ? minutes(turn.lastAt, reply.created_at) : null,
    };
  });
}

function conversationFeatures(row, seller) {
  const messages = row.messages;
  const sellerMessages = messages.filter((message) => senderKind(message) === seller);
  if (!sellerMessages.length) return null;
  const firstSellerIndex = messages.findIndex((message) => senderKind(message) === seller);
  const firstSeller = messages[firstSellerIndex];
  const leadReply = messages.slice(firstSellerIndex + 1).find((message) => message.direction === 'inbound') || null;
  const previous = messages.slice(0, firstSellerIndex).at(-1) || null;
  const previousAi = messages.slice(0, firstSellerIndex).reverse().find((message) => senderKind(message) === 'Aline') || null;
  const turns = sellerTurns(messages, seller);
  const texts = sellerMessages.map((message) => String(message.mensagem || '').trim()).filter(Boolean);
  const text = fold(texts.join(' '));
  const consecutiveUnanswered = [];
  let unanswered = 0;
  for (const turn of turns) {
    if (turn.replied) {
      if (unanswered) consecutiveUnanswered.push(unanswered);
      unanswered = 0;
    } else unanswered += 1;
  }
  if (unanswered) consecutiveUnanswered.push(unanswered);
  const last = messages.at(-1);
  const elapsedFromAi = previousAi ? minutes(previousAi.created_at, firstSeller.created_at) : null;
  const duplicateCount = sellerMessages.reduce((count, message, index) => {
    if (!index) return count;
    const prior = sellerMessages[index - 1];
    return count + (fold(prior.mensagem) && fold(prior.mensagem) === fold(message.mensagem) && minutes(prior.created_at, message.created_at) <= 2 ? 1 : 0);
  }, 0);
  return {
    id: row.id,
    code: `${seller[0]}-${row.id.slice(0, 6)}`,
    lead: maskName(row.name),
    status: row.status || 'Sem status',
    responsible: row.responsible,
    firstAt: firstSeller.created_at,
    lastAt: sellerMessages.at(-1).created_at,
    messageCount: sellerMessages.length,
    inboundCount: messages.filter((message) => message.direction === 'inbound').length,
    firstReply: Boolean(leadReply),
    firstReplyMinutes: leadReply ? minutes(firstSeller.created_at, leadReply.created_at) : null,
    firstReplyWithin15m: Boolean(leadReply && minutes(firstSeller.created_at, leadReply.created_at) <= 15),
    firstReplyWithin24h: Boolean(leadReply && minutes(firstSeller.created_at, leadReply.created_at) <= 1440),
    afterAi: Boolean(previousAi),
    handoffMinutes: elapsedFromAi,
    contextInFirstMessage: /aline|assistente|falou|conversou|interesse|cota[cç][aã]o|plano/.test(fold(firstSeller.mensagem)),
    firstMessageChars: String(firstSeller.mensagem || '').length,
    turns: turns.length,
    turnResponseRate: rate(turns.filter((turn) => turn.replied).length, turns.length),
    maxUnansweredSequence: Math.max(0, ...consecutiveUnanswered),
    lastDirection: last?.direction || null,
    lastKind: last ? senderKind(last) : null,
    duplicateCount,
    questionRate: rate(texts.filter((value) => value.includes('?')).length, texts.length),
    avgChars: mean(texts.map((value) => value.length)),
    hasScheduling: /horario|horário|agend|ligar|liga[cç][aã]o|reuni[aã]o/.test(text),
    hasProposal: /cota[cç][aã]o|proposta|arquivo|pdf|plano|operadora|valor/.test(text),
    hasEmpathy: /entendo|compreendo|tranquil|pode contar|preocupa[cç][aã]o|espero que esteja bem|sinto muito/.test(text),
    hasPressure: /preciso.*retorno|me responde|qual.*defini[cç][aã]o|seguiremos|posso contar|decidiu|decis[aã]o/.test(text),
    sale: SALE_RE.test(fold(row.status)),
    activePipeline: ACTIVE_RE.test(fold(row.status)),
    firstMessage: normalizeTemplate(firstSeller.mensagem),
  };
}

function sellerSummary(seller, operationalRows, leads) {
  const conversations = operationalRows.map((row) => conversationFeatures(row, seller)).filter(Boolean);
  const messages = operationalRows.flatMap((row) => row.messages).filter((message) => senderKind(message) === seller);
  const replies = conversations.filter((row) => row.firstReply);
  const handoffs = conversations.filter((row) => row.afterAi && row.handoffMinutes != null && row.handoffMinutes >= 0);
  const assigned = leads.filter((lead) => fold(lead.responsibleName).includes(fold(seller)));
  const statusDistribution = new Map();
  for (const lead of assigned) statusDistribution.set(lead.status || 'Sem status', (statusDistribution.get(lead.status || 'Sem status') || 0) + 1);
  const monthDistribution = new Map();
  for (const conversation of conversations) {
    const month = monthKey(conversation.firstAt);
    if (!monthDistribution.has(month)) monthDistribution.set(month, []);
    monthDistribution.get(month).push(conversation);
  }
  const monthly = [...monthDistribution.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => ({
    month,
    conversations: rows.length,
    replyRate: rate(rows.filter((row) => row.firstReply).length, rows.length),
    replyWithin24h: rate(rows.filter((row) => row.firstReplyWithin24h).length, rows.length),
    medianReplyMinutes: percentile(rows.filter((row) => row.firstReplyMinutes != null).map((row) => row.firstReplyMinutes), 0.5),
    handoffMedianMinutes: percentile(rows.filter((row) => row.handoffMinutes != null && row.handoffMinutes >= 0).map((row) => row.handoffMinutes), 0.5),
  }));

  const firstTemplates = new Map();
  for (const conversation of conversations) {
    const key = conversation.firstMessage;
    if (!firstTemplates.has(key)) firstTemplates.set(key, { text: key, sent: 0, replied: 0, within24h: 0 });
    const item = firstTemplates.get(key);
    item.sent += 1;
    if (conversation.firstReply) item.replied += 1;
    if (conversation.firstReplyWithin24h) item.within24h += 1;
  }

  const strong = [...conversations]
    .sort((a, b) => (Number(b.sale) * 20 + b.inboundCount + Number(b.firstReplyWithin15m) * 5) - (Number(a.sale) * 20 + a.inboundCount + Number(a.firstReplyWithin15m) * 5))
    .slice(0, 12);
  const weak = [...conversations]
    .sort((a, b) => (Number(!b.firstReply) * 20 + b.maxUnansweredSequence * 3 + b.messageCount) - (Number(!a.firstReply) * 20 + a.maxUnansweredSequence * 3 + a.messageCount))
    .slice(0, 12);

  return {
    seller,
    dateRange: { first: messages[0]?.created_at || null, last: messages.at(-1)?.created_at || null },
    conversations: conversations.length,
    outboundMessages: messages.length,
    activeDays: new Set(messages.map((message) => localDay(message.created_at))).size,
    replyRate: rate(replies.length, conversations.length),
    replyWithin15m: rate(conversations.filter((row) => row.firstReplyWithin15m).length, conversations.length),
    replyWithin24h: rate(conversations.filter((row) => row.firstReplyWithin24h).length, conversations.length),
    medianReplyMinutes: percentile(replies.map((row) => row.firstReplyMinutes), 0.5),
    p75ReplyMinutes: percentile(replies.map((row) => row.firstReplyMinutes), 0.75),
    handoffConversations: handoffs.length,
    medianHandoffMinutes: percentile(handoffs.map((row) => row.handoffMinutes), 0.5),
    handoffWithin15m: rate(handoffs.filter((row) => row.handoffMinutes <= 15).length, handoffs.length),
    contextRate: rate(conversations.filter((row) => row.contextInFirstMessage).length, conversations.length),
    medianFirstMessageChars: percentile(conversations.map((row) => row.firstMessageChars), 0.5),
    averageMessageChars: mean(conversations.map((row) => row.avgChars)),
    questionMessageRate: mean(conversations.map((row) => row.questionRate)),
    turnResponseRate: mean(conversations.map((row) => row.turnResponseRate)),
    awaitingLeadRate: rate(conversations.filter((row) => row.lastDirection === 'outbound').length, conversations.length),
    repeatedMessageRate: rate(conversations.reduce((sum, row) => sum + row.duplicateCount, 0), messages.length),
    schedulingRate: rate(conversations.filter((row) => row.hasScheduling).length, conversations.length),
    proposalRate: rate(conversations.filter((row) => row.hasProposal).length, conversations.length),
    empathyRate: rate(conversations.filter((row) => row.hasEmpathy).length, conversations.length),
    pressureLanguageRate: rate(conversations.filter((row) => row.hasPressure).length, conversations.length),
    assignedLeads: assigned.length,
    assignedSales: assigned.filter((lead) => SALE_RE.test(fold(lead.status))).length,
    assignedActivePipeline: assigned.filter((lead) => ACTIVE_RE.test(fold(lead.status))).length,
    assignedSaleRate: rate(assigned.filter((lead) => SALE_RE.test(fold(lead.status))).length, assigned.length),
    statusDistribution: [...statusDistribution.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    monthly,
    topFirstMessageTemplates: [...firstTemplates.values()].map((item) => ({
      ...item,
      replyRate: rate(item.replied, item.sent),
      within24hRate: rate(item.within24h, item.sent),
    })).sort((a, b) => b.sent - a.sent).slice(0, 20),
    strongExamples: strong,
    weakExamples: weak,
    conversationDetails: conversations,
  };
}

async function main() {
  const [profiles, conversations, rawLeads] = await Promise.all([
    fetchPaged('profiles', 'id,nome,email,tipo_usuario,status,corretor_id,nome_empresa', (query) => query.eq('corretor_id', CORRETOR_ID).order('id')),
    fetchPaged('whatsapp_conversas', 'id,lead_id,telefone,nome_contato,status,ultima_mensagem_at,created_at,updated_at', (query) => query.eq('corretor_id', CORRETOR_ID).order('created_at').order('id')),
    fetchPaged('leads', 'id,nome,status,data_entrada,created_at,updated_at,responsavel_profile_id,origem,utm_source,utm_campaign', (query) => query.eq('corretor_id', CORRETOR_ID).order('created_at').order('id')),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const leads = rawLeads.map((lead) => ({ ...lead, responsibleName: profileById.get(lead.responsavel_profile_id)?.nome || null }));
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const { rows: messages, exactCount } = await fetchMessages(new Set(conversations.map((conversation) => conversation.id)));
  const messagesByConversation = new Map();
  for (const message of messages) {
    if (!messagesByConversation.has(message.conversa_id)) messagesByConversation.set(message.conversa_id, []);
    messagesByConversation.get(message.conversa_id).push(message);
  }
  const rows = conversations.map((conversation) => {
    const conversationMessages = messagesByConversation.get(conversation.id) || [];
    const lead = leadById.get(conversation.lead_id);
    return {
      id: conversation.id,
      name: conversation.nome_contato || lead?.nome || 'Lead sem nome',
      createdAt: conversation.created_at,
      latestAt: conversation.ultima_mensagem_at,
      status: lead?.status || conversation.status || null,
      responsible: lead?.responsibleName || null,
      messages: conversationMessages,
    };
  });
  const operationalRows = rows.filter((row) => row.messages.length && !TEST_RE.test(row.name));
  const duplicateIds = messages.length - new Set(messages.map((message) => message.id)).size;
  const latestMismatches = rows.filter((row) => {
    if (!row.latestAt || !row.messages.length) return false;
    return Math.abs(time(row.latestAt) - time(row.messages.at(-1).created_at)) > 1000;
  });
  const registeredLaterThanMessage = latestMismatches.filter((row) => time(row.latestAt) > time(row.messages.at(-1).created_at));
  const registeredEarlierThanMessage = latestMismatches.filter((row) => time(row.latestAt) < time(row.messages.at(-1).created_at));
  const senderCounts = new Map();
  for (const message of messages) senderCounts.set(senderKind(message), (senderCounts.get(senderKind(message)) || 0) + 1);

  const result = {
    generatedAt: new Date().toISOString(),
    scope: {
      brokerage: 'OCTAVITA CORRETORA',
      corretorId: CORRETOR_ID,
      firstConversation: conversations[0]?.created_at || null,
      lastConversation: conversations.at(-1)?.created_at || null,
      firstMessage: messages[0]?.created_at || null,
      lastMessage: messages.at(-1)?.created_at || null,
      conversations: conversations.length,
      operationalConversations: operationalRows.length,
      testOrEmptyExcluded: conversations.length - operationalRows.length,
      leads: leads.length,
      messagesFetched: messages.length,
      messagesExactCount: exactCount,
    },
    completeness: {
      countMatches: messages.length === exactCount,
      duplicateMessageIds: duplicateIds,
      zeroMessageConversations: rows.filter((row) => !row.messages.length).length,
      latestTimestampMismatches: latestMismatches.length,
      registeredLatestLaterThanFetchedMessage: registeredLaterThanMessage.length,
      registeredLatestEarlierThanFetchedMessage: registeredEarlierThanMessage.length,
      maximumRegisteredLaterGapMinutes: Math.max(0, ...registeredLaterThanMessage.map((row) => minutes(row.messages.at(-1).created_at, row.latestAt))),
      maximumRegisteredEarlierGapMinutes: Math.max(0, ...registeredEarlierThanMessage.map((row) => minutes(row.latestAt, row.messages.at(-1).created_at))),
      latestMismatchConversationIds: latestMismatches.slice(0, 20).map((row) => row.id),
      allSellerMessagesClassified: [...senderCounts.entries()].filter(([key]) => key.startsWith('Outro')),
      note: 'A extração percorreu todas as conversas da corretora sem data inicial arbitrária. Mensagens foram paginadas em blocos, comparadas com contagem exata do banco e verificadas contra a última mensagem registrada em cada conversa.',
    },
    senderCounts: [...senderCounts.entries()].map(([sender, count]) => ({ sender, count })).sort((a, b) => b.count - a.count),
    sellers: {
      Sandro: sellerSummary('Sandro', operationalRows, leads),
      Henrique: sellerSummary('Henrique', operationalRows, leads),
    },
    methodology: {
      conversation: 'Conversa operacional com pelo menos uma mensagem e sem nome identificado como teste.',
      touched: 'Conversa com ao menos uma mensagem de saída atribuída ao vendedor pelo remetente ou metadados.',
      firstReply: 'Primeira mensagem recebida após a primeira mensagem do vendedor na conversa.',
      handoff: 'Tempo entre a última mensagem anterior da Aline e a primeira mensagem do vendedor.',
      sale: 'Lead atribuído em etapa contendo documentação, primeiro pagamento ou venda realizada.',
      caveat: 'Áudios, imagens e arquivos entram nas contagens, mas não tiveram conteúdo semântico transcrito. As comparações são observacionais e refletem carteiras, campanhas e horários diferentes.',
    },
  };
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output: OUTPUT, scope: result.scope, completeness: result.completeness, senderCounts: result.senderCounts }, null, 2));
}

await main();
