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
const OUT = path.resolve(process.cwd(), 'tmp', 'pdfs', 'octavita-service-analysis.json');
const TEST_RE = /(^|\s)(teste?|cvbt)(\s|$)/i;
const SALE_STATUSES = new Set(['documentação', '1º pagamento', 'venda realizada']);

const fold = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const asTime = (value) => new Date(value).getTime();
const minutes = (a, b) => (asTime(b) - asTime(a)) / 60000;
const rate = (num, den) => den ? num / den : null;
const avg = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function monthKey(value) {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

function maskedName(name) {
  const bits = String(name || 'Lead sem nome').trim().split(/\s+/).filter(Boolean);
  if (bits.length < 2) return bits[0] || 'Lead sem nome';
  return `${bits[0]} ${bits.at(-1)[0]}.`;
}

function senderKind(message) {
  if (message.direction !== 'outbound') return 'lead';
  const sender = fold(message.remetente);
  const meta = fold(message.metadata?.sender_name || message.metadata?.ai_agent || message.metadata?.sender_type);
  if (sender.includes('aline') || meta.includes('aline') || meta === 'ai') return 'Aline';
  if (sender.includes('sandro') || meta.includes('sandro')) return 'Sandro';
  if (sender.includes('henrique') || meta.includes('henrique')) return 'Henrique';
  if (sender.includes('danilo') || meta.includes('danilo')) return 'Danilo';
  return message.remetente || 'Outro humano';
}

function questionCategory(text, position = 0) {
  const t = fold(text);
  if (/dia e hor|qual horario|que horario|agend|ligacao|conversar/.test(t)) return ['agendamento', 'Agendamento / melhor horário'];
  if (/e-?mail/.test(t)) return ['email', 'E-mail'];
  if (/motivo|buscar um novo|reducao de custo|necessidade especifica|preventiv|urgente/.test(t)) return ['motivo', 'Motivo da busca'];
  if (/hospital|clinica|rede|regiao|cobertura/.test(t)) return ['rede', 'Hospital, rede ou cobertura'];
  if (/investimento|faixa de valor|orcamento|quanto pretende|valor mensal/.test(t)) return ['investimento', 'Investimento / orçamento'];
  if (/plano atual|operadora|tem plano|possui plano/.test(t)) return ['plano_atual', 'Plano atual / operadora'];
  if (/cnpj|mei|cpf|empresarial|pessoa fisica/.test(t)) return ['cnpj', 'CNPJ, MEI ou CPF'];
  if (/idade|quantas pessoas|quantidade de pessoas|quem vai usar/.test(t)) return ['idades', 'Idades / número de vidas'];
  if (/cidade|qual bairro|onde mora/.test(t)) return ['cidade', 'Cidade / localidade'];
  if (position === 1 || /gostaria de receber uma cotacao|preencheu o formulario|clicou em um anuncio|sou a aline/.test(t)) return ['abertura', 'Abertura e confirmação de interesse'];
  if (/especialista|encaminh|vou chamar|responsavel/.test(t)) return ['handoff', 'Encaminhamento ao especialista'];
  return ['outra', 'Outra pergunta / confirmação'];
}

function normalizeTemplate(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b\d{2,}\b/g, '[n]')
    .replace(/\s+/g, ' ').trim().slice(0, 260);
}

async function fetchPaged(table, select, configure) {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db.from(table).select(select).range(offset, offset + 999);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

async function fetchMessages(conversationIds) {
  const rows = [];
  const ids = [...conversationIds];
  for (let start = 0; start < ids.length; start += 40) {
    const chunk = ids.slice(start, start + 40);
    const part = await fetchPaged(
      'whatsapp_mensagens',
      'id,conversa_id,direction,remetente,mensagem,created_at,metadata',
      (q) => q.in('conversa_id', chunk).order('created_at', { ascending: true }),
    );
    rows.push(...part);
  }
  return rows.sort((a, b) => asTime(a.created_at) - asTime(b.created_at));
}

function buildAiTurns(messages) {
  const turns = [];
  let current = null;
  for (const message of messages) {
    const kind = senderKind(message);
    if (kind === 'Aline') {
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
  return turns.map((turn, index) => {
    const text = turn.messages.map((m) => m.mensagem || '').join(' ');
    const [category, label] = questionCategory(text, index + 1);
    const nextKind = turn.next ? senderKind(turn.next) : null;
    return {
      position: index + 1,
      firstAt: turn.firstAt,
      lastAt: turn.lastAt,
      text,
      template: normalizeTemplate(text),
      category,
      categoryLabel: label,
      responded: nextKind === 'lead',
      responseAt: nextKind === 'lead' ? turn.next.created_at : null,
      responseMinutes: nextKind === 'lead' ? minutes(turn.lastAt, turn.next.created_at) : null,
      endedBy: nextKind || 'fim da conversa',
      messageCount: turn.messages.length,
    };
  });
}

function firstInboundAfter(messages, timestamp, deadlineMinutes = null) {
  const start = asTime(timestamp);
  return messages.find((m) => {
    if (m.direction !== 'inbound' || asTime(m.created_at) <= start) return false;
    return deadlineMinutes == null || minutes(timestamp, m.created_at) <= deadlineMinutes;
  }) || null;
}

function summarizeSeller(seller, rows, leads) {
  const touched = rows.filter((row) => row.messages.some((m) => senderKind(m) === seller));
  const firstSellerContacts = [];
  const afterAi = [];
  for (const row of touched) {
    const sellerMessage = row.messages.find((m) => senderKind(m) === seller);
    const reply = sellerMessage ? firstInboundAfter(row.messages, sellerMessage.created_at) : null;
    if (sellerMessage) firstSellerContacts.push({ row, sellerMessage, reply });
    const firstAi = row.messages.find((m) => senderKind(m) === 'Aline');
    const sellerAfterAi = firstAi
      ? row.messages.find((m) => senderKind(m) === seller && asTime(m.created_at) > asTime(firstAi.created_at))
      : null;
    if (sellerAfterAi) afterAi.push({ row, sellerMessage: sellerAfterAi, reply: firstInboundAfter(row.messages, sellerAfterAi.created_at) });
  }
  const responseTimes = firstSellerContacts.filter((x) => x.reply).map((x) => minutes(x.sellerMessage.created_at, x.reply.created_at));
  const assigned = leads.filter((lead) => fold(lead.responsavel_nome) === fold(`${seller} Corretor`) || fold(lead.responsavel_nome).includes(fold(seller)));
  const statusMap = new Map();
  for (const lead of assigned) statusMap.set(lead.status || 'Sem status', (statusMap.get(lead.status || 'Sem status') || 0) + 1);
  return {
    seller,
    conversationsTouched: touched.length,
    firstContacts: firstSellerContacts.length,
    firstContactResponseRate: rate(firstSellerContacts.filter((x) => x.reply).length, firstSellerContacts.length),
    firstContactResponseWithin24h: rate(firstSellerContacts.filter((x) => x.reply && minutes(x.sellerMessage.created_at, x.reply.created_at) <= 1440).length, firstSellerContacts.length),
    medianResponseMinutes: percentile(responseTimes, 0.5),
    afterAiContacts: afterAi.length,
    afterAiResponseRate: rate(afterAi.filter((x) => x.reply).length, afterAi.length),
    afterAiResponseWithin24h: rate(afterAi.filter((x) => x.reply && minutes(x.sellerMessage.created_at, x.reply.created_at) <= 1440).length, afterAi.length),
    assignedLeads: assigned.length,
    assignedSales: assigned.filter((lead) => SALE_STATUSES.has(fold(lead.status))).length,
    assignedSaleRate: rate(assigned.filter((lead) => SALE_STATUSES.has(fold(lead.status))).length, assigned.length),
    statusDistribution: [...statusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
  };
}

async function main() {
  const [profiles, conversations, rawLeads, sessions] = await Promise.all([
    fetchPaged('profiles', 'id,nome,email,tipo_usuario,status,corretor_id,nome_empresa', (q) => q.eq('corretor_id', CORRETOR_ID)),
    fetchPaged('whatsapp_conversas', 'id,lead_id,telefone,nome_contato,status,ultima_mensagem_at,created_at,updated_at', (q) => q.eq('corretor_id', CORRETOR_ID).order('created_at', { ascending: true })),
    fetchPaged('leads', 'id,nome,telefone,status,data_entrada,created_at,updated_at,responsavel_profile_id,origem,utm_source,utm_campaign,idades,possui_cnpj,tem_plano_ativo,plano_atual,investimento,cidade,email,motivo_busca,hospital_preferencia', (q) => q.eq('corretor_id', CORRETOR_ID).order('created_at', { ascending: true })),
    fetchPaged('lead_ai_sessions', 'id,lead_id,admin_profile_id,responsavel_profile_id,persona,status,summary,last_customer_message_at,last_ai_message_at,created_at,updated_at', (q) => q.eq('corretor_id', CORRETOR_ID).order('created_at', { ascending: true })),
  ]);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const leads = rawLeads.map((lead) => ({ ...lead, responsavel_nome: profileById.get(lead.responsavel_profile_id)?.nome || null }));
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const messages = await fetchMessages(new Set(conversations.map((c) => c.id)));
  const messagesByConversation = new Map();
  for (const message of messages) {
    if (!messagesByConversation.has(message.conversa_id)) messagesByConversation.set(message.conversa_id, []);
    messagesByConversation.get(message.conversa_id).push(message);
  }

  const rows = conversations.map((conversation) => {
    const conversationMessages = messagesByConversation.get(conversation.id) || [];
    const aiTurns = buildAiTurns(conversationMessages);
    const firstOutbound = conversationMessages.find((m) => m.direction === 'outbound');
    const firstAi = conversationMessages.find((m) => senderKind(m) === 'Aline');
    const firstLeadAfterAi = firstAi ? firstInboundAfter(conversationMessages, firstAi.created_at) : null;
    const firstHumanAfterAi = firstAi
      ? conversationMessages.find((m) => m.direction === 'outbound' && senderKind(m) !== 'Aline' && asTime(m.created_at) > asTime(firstAi.created_at))
      : null;
    const firstLeadAfterHuman = firstHumanAfterAi ? firstInboundAfter(conversationMessages, firstHumanAfterAi.created_at) : null;
    const lead = leadById.get(conversation.lead_id);
    let duplicateAiMessages = 0;
    for (let i = 1; i < conversationMessages.length; i += 1) {
      const prev = conversationMessages[i - 1];
      const curr = conversationMessages[i];
      if (senderKind(prev) === 'Aline' && senderKind(curr) === 'Aline' && fold(prev.mensagem) === fold(curr.mensagem) && minutes(prev.created_at, curr.created_at) <= 2) duplicateAiMessages += 1;
    }
    return {
      id: conversation.id,
      leadId: conversation.lead_id,
      name: conversation.nome_contato || lead?.nome || 'Lead sem nome',
      createdAt: conversation.created_at,
      messages: conversationMessages,
      aiTurns,
      firstOutboundKind: firstOutbound ? senderKind(firstOutbound) : null,
      aiInitiated: Boolean(firstAi && firstOutbound && firstAi.id === firstOutbound.id),
      firstAiAt: firstAi?.created_at || null,
      firstLeadAfterAiAt: firstLeadAfterAi?.created_at || null,
      firstAiResponseMinutes: firstAi && firstLeadAfterAi ? minutes(firstAi.created_at, firstLeadAfterAi.created_at) : null,
      firstHumanAfterAiKind: firstHumanAfterAi ? senderKind(firstHumanAfterAi) : null,
      firstHumanAfterAiAt: firstHumanAfterAi?.created_at || null,
      firstLeadAfterHumanAt: firstLeadAfterHuman?.created_at || null,
      firstHumanResponseMinutes: firstHumanAfterAi && firstLeadAfterHuman ? minutes(firstHumanAfterAi.created_at, firstLeadAfterHuman.created_at) : null,
      duplicateAiMessages,
      status: lead?.status || null,
      responsible: lead?.responsavel_nome || null,
      lead,
    };
  });

  const operational = rows.filter((row) => row.messages.length && !TEST_RE.test(row.name));
  const aiRows = operational.filter((row) => row.aiInitiated);
  const aiResponded = aiRows.filter((row) => row.firstLeadAfterAiAt);
  const handoffs = aiRows.filter((row) => row.firstHumanAfterAiAt);
  const handoffResponded = handoffs.filter((row) => row.firstLeadAfterHumanAt);
  const firstResponseTimes = aiResponded.map((row) => row.firstAiResponseMinutes);
  const handoffTimes = handoffResponded.map((row) => row.firstHumanResponseMinutes);

  const categoryMap = new Map();
  const stageMap = new Map();
  const templateMap = new Map();
  for (const row of aiRows) {
    for (const turn of row.aiTurns) {
      if (!categoryMap.has(turn.category)) categoryMap.set(turn.category, { key: turn.category, label: turn.categoryLabel, reached: 0, responded: 0, responseTimes: [], dropoffs: 0 });
      const category = categoryMap.get(turn.category);
      category.reached += 1;
      if (turn.responded) { category.responded += 1; category.responseTimes.push(turn.responseMinutes); }
      else category.dropoffs += 1;
      if (!stageMap.has(turn.position)) stageMap.set(turn.position, { stage: turn.position, reached: 0, responded: 0, responseTimes: [] });
      const stage = stageMap.get(turn.position);
      stage.reached += 1;
      if (turn.responded) { stage.responded += 1; stage.responseTimes.push(turn.responseMinutes); }
      const templateKey = `${turn.category}|${turn.template}`;
      if (!templateMap.has(templateKey)) templateMap.set(templateKey, { category: turn.categoryLabel, text: turn.template, sent: 0, responded: 0 });
      const template = templateMap.get(templateKey);
      template.sent += 1;
      if (turn.responded) template.responded += 1;
    }
  }
  const questionFunnel = [...categoryMap.values()].map((x) => ({ ...x, responseRate: rate(x.responded, x.reached), medianResponseMinutes: percentile(x.responseTimes, 0.5), responseTimes: undefined })).sort((a, b) => b.reached - a.reached);
  const stageFunnel = [...stageMap.values()].map((x) => ({ ...x, responseRate: rate(x.responded, x.reached), medianResponseMinutes: percentile(x.responseTimes, 0.5), responseTimes: undefined })).sort((a, b) => a.stage - b.stage);
  const topQuestionTemplates = [...templateMap.values()].map((x) => ({ ...x, responseRate: rate(x.responded, x.sent) })).sort((a, b) => b.sent - a.sent).slice(0, 30);

  const monthMap = new Map();
  for (const row of aiRows) {
    const month = monthKey(row.firstAiAt || row.createdAt);
    if (!monthMap.has(month)) monthMap.set(month, []);
    monthMap.get(month).push(row);
  }
  const monthly = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, items]) => {
    const responded = items.filter((x) => x.firstLeadAfterAiAt);
    const passed = items.filter((x) => x.firstHumanAfterAiAt);
    const passedResponded = passed.filter((x) => x.firstLeadAfterHumanAt);
    const sold = items.filter((x) => SALE_STATUSES.has(fold(x.status)));
    return {
      month,
      aiStarts: items.length,
      firstResponses: responded.length,
      firstResponseRate: rate(responded.length, items.length),
      responseWithin15m: rate(responded.filter((x) => x.firstAiResponseMinutes <= 15).length, items.length),
      medianFirstResponseMinutes: percentile(responded.map((x) => x.firstAiResponseMinutes), 0.5),
      handoffs: passed.length,
      handoffRate: rate(passed.length, items.length),
      sellerResponses: passedResponded.length,
      sellerResponseRate: rate(passedResponded.length, passed.length),
      sellerResponseWithin24h: rate(passedResponded.filter((x) => x.firstHumanResponseMinutes <= 1440).length, passed.length),
      sales: sold.length,
      saleRate: rate(sold.length, items.length),
      avgAiTurns: avg(items.map((x) => x.aiTurns.length)),
    };
  });

  const sessionsByStatus = new Map();
  for (const session of sessions) sessionsByStatus.set(session.status || 'sem status', (sessionsByStatus.get(session.status || 'sem status') || 0) + 1);
  const statuses = new Map();
  for (const lead of leads) statuses.set(lead.status || 'Sem status', (statuses.get(lead.status || 'Sem status') || 0) + 1);

  const examples = aiRows.map((row) => {
    const answeredTurns = row.aiTurns.filter((turn) => turn.responded).length;
    const lastTurn = row.aiTurns.at(-1);
    return {
      lead: maskedName(row.name),
      month: monthKey(row.firstAiAt),
      responsible: row.responsible,
      status: row.status || 'Sem status',
      aiTurns: row.aiTurns.length,
      answeredTurns,
      firstResponseMinutes: row.firstAiResponseMinutes,
      handoffSeller: row.firstHumanAfterAiKind,
      respondedToSeller: Boolean(row.firstLeadAfterHumanAt),
      dropout: lastTurn && !lastTurn.responded ? lastTurn.categoryLabel : null,
      sale: SALE_STATUSES.has(fold(row.status)),
      engagementScore: answeredTurns * 3 + (row.firstLeadAfterAiAt ? 2 : 0) + (row.firstLeadAfterHumanAt ? 3 : 0) + (SALE_STATUSES.has(fold(row.status)) ? 6 : 0),
    };
  });

  const sellers = ['Sandro', 'Henrique'].map((seller) => summarizeSeller(seller, operational, leads));
  const totalAiMessages = aiRows.reduce((sum, row) => sum + row.messages.filter((m) => senderKind(m) === 'Aline').length, 0);
  const duplicateAiMessages = aiRows.reduce((sum, row) => sum + row.duplicateAiMessages, 0);
  const result = {
    generatedAt: new Date().toISOString(),
    scope: {
      brokerage: 'OCTAVITA CORRETORA',
      owner: 'Danilo Iacovone',
      corretorId: CORRETOR_ID,
      firstOperationalConversation: operational[0]?.createdAt || null,
      lastOperationalConversation: operational.at(-1)?.createdAt || null,
      totalConversations: conversations.length,
      operationalConversations: operational.length,
      totalMessages: operational.reduce((sum, row) => sum + row.messages.length, 0),
      totalLeads: leads.length,
      aiSessions: sessions.length,
      exclusionRule: 'Foram excluídas conversas sem mensagens e contatos identificados como teste. As taxas são observacionais e usam eventos registrados no Orion Track.',
    },
    headline: {
      aiInitiated: aiRows.length,
      firstResponses: aiResponded.length,
      firstResponseRate: rate(aiResponded.length, aiRows.length),
      noFirstResponse: aiRows.length - aiResponded.length,
      responseWithin15m: rate(aiResponded.filter((x) => x.firstAiResponseMinutes <= 15).length, aiRows.length),
      responseWithin60m: rate(aiResponded.filter((x) => x.firstAiResponseMinutes <= 60).length, aiRows.length),
      responseWithin24h: rate(aiResponded.filter((x) => x.firstAiResponseMinutes <= 1440).length, aiRows.length),
      medianFirstResponseMinutes: percentile(firstResponseTimes, 0.5),
      p90FirstResponseMinutes: percentile(firstResponseTimes, 0.9),
      handoffs: handoffs.length,
      handoffRate: rate(handoffs.length, aiRows.length),
      handoffResponses: handoffResponded.length,
      handoffResponseRate: rate(handoffResponded.length, handoffs.length),
      handoffResponseWithin24h: rate(handoffResponded.filter((x) => x.firstHumanResponseMinutes <= 1440).length, handoffs.length),
      medianHandoffResponseMinutes: percentile(handoffTimes, 0.5),
      aiMessages: totalAiMessages,
      duplicateAiMessages,
      duplicateAiMessageRate: rate(duplicateAiMessages, totalAiMessages),
      reachedThreeAiTurns: aiRows.filter((x) => x.aiTurns.length >= 3).length,
      reachedThreeAiTurnsRate: rate(aiRows.filter((x) => x.aiTurns.length >= 3).length, aiRows.length),
    },
    monthly,
    questionFunnel,
    stageFunnel,
    topQuestionTemplates,
    sellers,
    sessionStatus: [...sessionsByStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    leadStatus: [...statuses.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    strongLeadExamples: [...examples].sort((a, b) => b.engagementScore - a.engagementScore).slice(0, 12),
    weakLeadExamples: [...examples].filter((x) => !x.respondedToSeller || x.dropout).sort((a, b) => a.engagementScore - b.engagementScore).slice(0, 12),
    methodology: {
      firstAiResponse: 'Existe qualquer mensagem recebida após a primeira mensagem da Aline na conversa.',
      questionResponse: 'Uma etapa é respondida quando o próximo turno após o bloco de mensagens da Aline é do lead.',
      handoff: 'Existe mensagem de Sandro, Henrique, Danilo ou outro atendente humano após a primeira mensagem da Aline.',
      sellerResponse: 'Existe mensagem recebida depois do primeiro contato humano posterior à Aline.',
      monthCohort: 'Mês da primeira mensagem da Aline, no fuso America/Sao_Paulo.',
      privacy: 'Nomes de leads são abreviados no relatório; telefones e conteúdo integral das conversas não são exibidos.',
    },
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ output: OUT, scope: result.scope, headline: result.headline, monthly: result.monthly, sellers: result.sellers, questionFunnel: result.questionFunnel }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
