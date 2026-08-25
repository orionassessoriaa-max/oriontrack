import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';
import { rateLimit, writeAuditLog } from '@/lib/api/security';
import { buildLeadContactKey, buildLeadDuplicateKey, buildLeadIdentityKey } from '@/lib/leadDuplicate';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';
import { startLeadAiIfEligible } from '@/lib/leadAiAgent';
import { ensureLeadAiTimeoutScheduler } from '@/lib/leadAiTimeoutScheduler';
import { startLeadBotIfEligible } from '@/lib/leadBot';
import { isMissingLeadOriginColumn, resolveLeadOrigin } from '@/lib/leadOrigin';
import { getLeadSpamReason } from '@/lib/leadSpam';

function normalizeText(value: unknown, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }
  return String(value).trim();
}

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function flattenPayload(input: any) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const nested = [
    source.body,
    source.data,
    source.lead,
    source.cliente,
    source.customer,
    source.contato,
    source.contact,
    source.form,
    source.payload,
    source.json,
    source.respondent?.answers,
    source.answers,
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));

  return Object.assign({}, source, ...nested);
}

function collectPayloadEntries(input: any, entries: Array<[string, unknown]> = [], prefix = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return entries;

  Object.entries(input).forEach(([key, value]) => {
    const path = prefix ? `${prefix}_${key}` : key;
    entries.push([key, value]);
    entries.push([path, value]);

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectPayloadEntries(value, entries, path);
    }
  });

  return entries;
}

function field(body: Record<string, any>, aliases: string[]) {
  const entries = collectPayloadEntries(body || {});

  for (const alias of aliases) {
    const direct = body[alias];
    if (direct !== undefined && direct !== null && normalizeText(direct)) return direct;

    const normalizedAlias = normalizeKey(alias);
    const match = entries.find(([key, value]) => (
      normalizeKey(key) === normalizedAlias
      && value !== undefined
      && value !== null
      && Boolean(normalizeText(value))
    ));
    if (match) return match[1];
  }

  return '';
}

function parseCurrencyValue(value: unknown) {
  const raw = normalizeText(value);
  if (!raw || raw === '-') return null;
  const numeric = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLeadDate(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return new Date().toISOString();

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const brazilian = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?)?/);
  if (brazilian) {
    const [, day, month, year, hour = '0', minute = '0'] = brazilian;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const parsed = new Date(Number(fullYear), Number(month) - 1, Number(day), Number(hour), Number(minute));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

function isBlankStored(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (!text || text === '-') return true;
  return ['nao informado', 'não informado', 'sem aba'].includes(text);
}

function buildEnrichmentUpdate(existing: any, incoming: any) {
  const update: Record<string, string | number | null> = {};
  const fields = [
    'idades',
    'possui_cnpj',
    'cnpj',
    'tem_plano_ativo',
    'plano_atual',
    'custo_plano_atual',
    'investimento',
    'cidade',
    'operadora',
    'origem',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'valor_negociacao',
    'operadora_negociacao',
  ];

  fields.forEach((field) => {
    const value = incoming[field];
    if (value === undefined || value === null || value === '') return;
    if (isBlankStored(existing[field])) {
      update[field] = value;
    }
  });

  return update;
}

function normalizeBooleanLabel(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (['sim', 's', 'true', '1', 'yes'].includes(text)) return 'Sim';
  if (['nao', 'n?o', 'n', 'false', '0', 'no'].includes(text)) return 'Nao';
  const key = normalizeKey(text);
  if (key.includes('nao_tenho') || key.includes('nao_possui')) return 'Nao';
  if (key.includes('tenho') || key.includes('possui')) return 'Sim';
  return normalizeText(value, 'Nao informado') || 'Nao informado';
}

function normalizeCnpjOwnershipLabel(value: unknown) {
  const text = normalizeText(value);
  const key = normalizeKey(text);
  if (!key) return 'Nao informado';
  if (key.includes('mei')) return 'Tenho MEI';
  if (['nao', 'n_o', 'n', 'false', '0', 'no'].includes(key) || key.includes('nao_tenho') || key.includes('nao_possui')) return 'Nao';
  if (['sim', 's', 'true', '1', 'yes'].includes(key) || key.includes('tenho_cnpj') || key.includes('possui_cnpj')) return 'Sim';
  if (text.replace(/\D/g, '').length >= 11) return 'Sim';
  return text || 'Nao informado';
}

function extractCnpjValue(value: unknown) {
  const text = normalizeText(value);
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 11) return text;
  return '';
}

function notificationValue(value: unknown, fallback = 'Nao informado') {
  const text = normalizeText(value);
  return text || fallback;
}

function resolveAdName(lead: any) {
  return notificationValue(
    lead?.utm_content || lead?.utm_term || lead?.utm_campaign || lead?.utm_medium || lead?.utm_source,
    'Nao informado'
  );
}

function buildLeadDetailsMessage(lead: any, intro: string) {
  const cnpjNumber = notificationValue(lead?.cnpj, '');

  return [
    intro,
    '',
    `Nome: ${notificationValue(lead?.nome)}`,
    `Telefone: ${notificationValue(lead?.telefone)}`,
    `Idades: ${notificationValue(lead?.idades)}`,
    `Cidade: ${notificationValue(lead?.cidade)}`,
    `Possui CNPJ: ${notificationValue(lead?.possui_cnpj)}`,
    ...(cnpjNumber ? [`CNPJ: ${cnpjNumber}`] : []),
    `Investimento: ${notificationValue(lead?.investimento)}`,
    `Tem plano de saude: ${notificationValue(lead?.tem_plano_ativo)}`,
    `Plano atual: ${notificationValue(lead?.plano_atual)}`,
    `Anuncio: ${resolveAdName(lead)}`,
  ].join('\n');
}

function normalizeLeadNotificationMode(value: unknown) {
  const mode = String(value || '').trim();
  return ['responsavel_apenas', 'responsavel_e_admin_se_integrante', 'responsavel_e_admins'].includes(mode)
    ? mode
    : 'responsavel_e_admin_se_integrante';
}

async function tryStartLeadAiForWebhook(leadId?: string | null) {
  if (!leadId) return null;

  try {
    return await startLeadAiIfEligible(leadId);
  } catch (aiErr) {
    console.error('[Webhook n8n] Failed starting lead AI:', aiErr);
    const rawMessage = String((aiErr as any)?.message || aiErr || '');
    const lowerMessage = rawMessage.toLowerCase();
    const missingInboxConnection =
      lowerMessage.includes('instancia uazapi') ||
      lowerMessage.includes('instância uazapi') ||
      lowerMessage.includes('ainda nao foi criada') ||
      lowerMessage.includes('ainda não foi criada') ||
      lowerMessage.includes('nao possui token') ||
      lowerMessage.includes('não possui token');
    const invalidWhatsAppNumber =
      lowerMessage.includes('not on whatsapp') ||
      lowerMessage.includes('nao esta no whatsapp') ||
      lowerMessage.includes('não está no whatsapp') ||
      lowerMessage.includes('number does not exist');
    const reason = invalidWhatsAppNumber
      ? 'O telefone informado nao esta cadastrado no WhatsApp ou pode estar digitado incorretamente.'
      : missingInboxConnection
        ? 'Voce ainda nao conectou seu numero no Inbox.'
      : lowerMessage.includes('whatsapp disconnected')
        ? 'Seu numero esta desconectado no Inbox. Conecte novamente para a IA atender automaticamente.'
        : 'A IA nao conseguiu iniciar automaticamente. A equipe Orion pode verificar o ocorrido.';

    return {
      started: false,
      eligible: false,
      error: true,
      reason,
    };
  }
}

async function tryStartLeadBotForWebhook(leadId?: string | null) {
  if (!leadId) return null;

  try {
    return await startLeadBotIfEligible(leadId);
  } catch (botErr) {
    console.error('[Webhook n8n] Failed starting lead bot:', botErr);
    return null;
  }
}

async function resolveCorretorId(body: any) {
  let resolvedId: string | null = null;

  const corretoraId = normalizeText(field(body, [
    'corretora_id',
    'id_corretora',
    'concessionaria_id',
    'id_concessionaria',
  ]));
  if (corretoraId) {
    const { data: corretora } = await supabaseAdmin
      .from('corretoras')
      .select('nome')
      .eq('id', corretoraId)
      .maybeSingle();

    if (corretora?.nome) {
      const { data: brokerageOwner } = await supabaseAdmin
        .from('corretores')
        .select('id')
        .ilike('nome_empresa', corretora.nome)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (brokerageOwner?.id) resolvedId = brokerageOwner.id;
    }
  }

  const corretorId = normalizeText(field(body, ['corretor_id', 'id_corretor', 'broker_id']));
  if (!resolvedId && corretorId) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('id', corretorId)
      .maybeSingle();
    if (data?.id) {
      resolvedId = data.id;
    } else {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('corretor_id')
        .eq('id', corretorId)
        .maybeSingle();

      if (prof?.corretor_id) resolvedId = prof.corretor_id;
    }
  }

  if (!resolvedId) {
    const corretorEmail = normalizeText(field(body, ['corretor_email', 'email_corretor', 'email do corretor', 'email'])).toLowerCase();
    if (corretorEmail) {
      const { data: broker } = await supabaseAdmin
        .from('corretores')
        .select('id')
        .eq('email', corretorEmail)
        .maybeSingle();
      if (broker?.id) {
        resolvedId = broker.id;
      } else {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('corretor_id')
          .eq('email', corretorEmail)
          .maybeSingle();
        if (prof?.corretor_id) resolvedId = prof.corretor_id;
      }
    }
  }

  if (!resolvedId) {
    const corretorNome = normalizeText(field(body, ['corretor_nome', 'nome_corretor', 'nome do corretor']));
    if (corretorNome) {
      const { data: broker } = await supabaseAdmin
        .from('corretores')
        .select('id')
        .ilike('nome', corretorNome)
        .maybeSingle();
      if (broker?.id) {
        resolvedId = broker.id;
      } else {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('corretor_id')
          .ilike('nome', corretorNome)
          .maybeSingle();
        if (prof?.corretor_id) resolvedId = prof.corretor_id;
      }
    }
  }

  if (resolvedId) {
    const { data: broker } = await supabaseAdmin
      .from('corretores')
      .select('nome_empresa')
      .eq('id', resolvedId)
      .maybeSingle();

    if (broker?.nome_empresa) {
      const { data: primaryBroker } = await supabaseAdmin
        .from('corretores')
        .select('id')
        .eq('nome_empresa', broker.nome_empresa)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (primaryBroker?.id) {
        return primaryBroker.id;
      }
    }
    return resolvedId;
  }

  return null;
}

async function assignLeadToNextTeamMember(corretorId: string, leadId: string) {
  const { data: currentLead } = await supabaseAdmin
    .from('leads')
    .select('responsavel_membro_id, responsavel_profile_id')
    .eq('id', leadId)
    .eq('corretor_id', corretorId)
    .maybeSingle();

  if (currentLead?.responsavel_membro_id || currentLead?.responsavel_profile_id) {
    return currentLead.responsavel_membro_id || null;
  }

  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('rodizio_ativo, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  if (broker?.rodizio_ativo === false) return null;

  if (broker?.nome_empresa) {
    const { data: distribution } = await supabaseAdmin
      .from('corretoras')
      .select('distribuicao_modelo')
      .ilike('nome', broker.nome_empresa)
      .maybeSingle();
    if (distribution?.distribuicao_modelo === 'fila_compartilhada') return null;
  }

  const { data: team } = await supabaseAdmin
    .from('corretor_times')
    .select('id')
    .eq('corretor_id', corretorId)
    .eq('ativo', true)
    .maybeSingle();

  if (!team?.id) return null;

  const { data: members } = await supabaseAdmin
    .from('corretor_time_membros')
    .select('id, profile_id, ordem, ultimo_lead_at, created_at')
    .eq('time_id', team.id)
    .in('status', ['active', 'ativo'])
    .not('profile_id', 'is', null)
    .neq('participa_rodizio', false)
    .order('ultimo_lead_at', { ascending: true, nullsFirst: true })
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true });

  if (!members || members.length === 0) return null;

  // O rodizio escolhia so por "quem recebeu ha mais tempo". Isso desencaixa
  // sempre que um lead chega com responsavel definido de fora ou e reatribuido
  // na mao: a pessoa ganha o lead sem gastar a vez, e a diferenca cresce. Na
  // Conexao chegou a 8 contra 6. Agora quem tem menos leads no mes recebe, e o
  // criterio antigo vira desempate.
  const inicioDaJanela = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const idsDosMembros = members.map((item) => item.id);
  const { data: recentes } = await supabaseAdmin
    .from('leads')
    .select('responsavel_membro_id')
    .in('responsavel_membro_id', idsDosMembros)
    .gte('created_at', inicioDaJanela)
    .limit(4000);

  const carga = new Map(idsDosMembros.map((id) => [id, 0]));
  for (const lead of recentes || []) {
    const dono = String(lead.responsavel_membro_id || '');
    if (carga.has(dono)) carga.set(dono, (carga.get(dono) || 0) + 1);
  }

  const member = members.reduce((escolhido, candidato) => (
    (carga.get(candidato.id) || 0) < (carga.get(escolhido.id) || 0) ? candidato : escolhido
  ), members[0]);
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('leads')
    .update({
      responsavel_membro_id: member.id,
      responsavel_profile_id: member.profile_id,
      updated_at: now,
    })
    .eq('id', leadId)
    .eq('corretor_id', corretorId);

  await supabaseAdmin
    .from('corretor_time_membros')
    .update({ ultimo_lead_at: now })
    .eq('id', member.id);

  return member.id;
}

export async function POST(request: Request) {
  try {
    ensureLeadAiTimeoutScheduler();

    const limited = rateLimit(request, 'webhook:n8n:leads', { limit: 180, windowMs: 60_000 });
    if (limited) return limited;

    const secret = process.env.ORION_N8N_WEBHOOK_SECRET;
    if (secret) {
      const headerSecret = request.headers.get('x-orion-secret');
      const bearerSecret = request.headers.get('Authorization')?.replace('Bearer ', '');
      if (headerSecret !== secret && bearerSecret !== secret) {
        return NextResponse.json({ error: 'Webhook não autorizado.' }, { status: 401 });
      }
    }

    const body = flattenPayload(await request.json());
    const corretorId = await resolveCorretorId(body);

    if (!corretorId) {
      return NextResponse.json({
        error: 'Concessionaria ou corretor nao encontrado. Envie corretora_id, corretor_id, corretor_email ou corretor_nome.'
      }, { status: 400 });
    }

    const nome = normalizeText(field(body, ['nome', 'name', 'lead_nome', 'cliente', 'nome completo']));
    const telefone = normalizeText(field(body, ['telefone', 'phone', 'whatsapp', 'celular', 'fone']));

    if (!nome || !telefone) {
      return NextResponse.json({ error: 'Nome e telefone do lead são obrigatórios.' }, { status: 400 });
    }

    const spamReason = getLeadSpamReason({ nome, telefone });
    if (spamReason) {
      await writeAuditLog(request, null, {
        action: 'lead.blocked_spam',
        entity_type: 'lead',
        metadata: { corretor_id: corretorId, reason: spamReason },
      });
      return NextResponse.json({
        success: true,
        blocked: true,
        message: 'Lead identificado como spam e bloqueado antes de entrar no CRM.',
      });
    }

    const rawDate = field(body, ['data_entrada', 'data entrada', 'data', 'created_time', 'timestamp', 'data do lead']);
    const dataEntrada = parseLeadDate(rawDate);

    const valorNegociacao = parseCurrencyValue(field(body, [
      'valor_negociacao',
      'valor negociacao',
      'valor negociação',
      'valor da negociacao',
      'valor da negociação',
      'valor cotacao',
      'valor cotação',
      'valor da cotacao',
      'valor da cotação',
      'valor proposta',
      'valor venda',
      'valor fechado',
      'receita',
    ]));

    const utmCampaign = normalizeText(field(body, [
      'utm_campaign',
      'utmCampaign',
      'utm campaign',
      'campaign_name',
      'campaignName',
      'campaign',
      'campanha',
      'nome campanha',
      'respondent_utms_utm_campaign',
    ])) || null;

    const leadPayload = {
      corretor_id: corretorId,
      data_entrada: dataEntrada,
      nome,
      telefone,
      idades: normalizeText(field(body, ['idades', 'idade', 'idade(s)', 'idades beneficiarios', 'idades beneficiários', 'idades dos beneficiarios', 'idades dos beneficiários', 'vidas', 'vida', 'quantidade de vidas', 'qtd vidas', 'qtd_vidas', 'numero de vidas', 'número de vidas', 'age_group'])),
      possui_cnpj: normalizeCnpjOwnershipLabel(field(body, ['possui_cnpj', 'possui cnpj', 'possui cnpj?', 'tem cnpj', 'tem cnpj?', 'tem mei', 'mei']) || field(body, ['cnpj'])),
      cnpj: extractCnpjValue(field(body, ['cnpj_numero', 'cnpj numero', 'cnpj nÃºmero', 'numero cnpj', 'nÃºmero cnpj', 'cnpj do cliente', 'cnpj'])) || null,
      tem_plano_ativo: normalizeBooleanLabel(field(body, ['tem_plano_ativo', 'tem plano ativo', 'tem plano ativo?', 'plano ativo', 'planoativo', 'possui plano', 'possui plano?', 'possui convenio', 'tem convenio', 'ja tem plano', 'já tem plano'])),
      plano_atual: normalizeText(field(body, ['plano_atual', 'plano atual', 'qual plano atual', 'qual seu plano atual', 'operadora atual', 'convenio atual', 'convênio atual', 'seguradora atual', 'plano'])) || null,
      custo_plano_atual: normalizeText(field(body, ['custo_plano_atual', 'custo plano atual', 'custo atual', 'valor plano atual', 'valor do plano atual', 'mensalidade atual', 'valor_atual'])) || null,
      investimento: normalizeText(field(body, ['investimento', 'investimento pretendido', 'investimento_pretendido', 'pretensao investimento', 'pretensão investimento', 'valor_pretendido', 'budget', 'orcamento', 'orçamento'])),
      cidade: normalizeText(field(body, ['cidade', 'city', 'regiao', 'localidade'])),
      operadora: normalizeText(field(body, ['operadora', 'pagina', 'página', 'aba', 'operator', 'page', 'source_page'])) || null,
      utm_source: normalizeText(field(body, ['utm_source', 'source', 'origem', 'utm origem'])) || null,
      utm_medium: normalizeText(field(body, ['utm_medium', 'medium', 'meio', 'utm meio'])) || null,
      utm_campaign: utmCampaign,
      utm_term: normalizeText(field(body, ['utm_term', 'term', 'conjunto', 'conjunto de anuncio', 'conjunto_anuncio', 'adset', 'ad set'])) || null,
      utm_content: normalizeText(field(body, ['utm_content', 'content', 'anuncio', 'anúncio', 'ad', 'criativo'])) || null,
      valor_negociacao: valorNegociacao,
      operadora_negociacao: normalizeText(field(body, ['operadora_negociacao', 'operadora negociacao', 'operadora negociação', 'operadora venda', 'operadora da venda', 'operadora escolhida'])) || null,
      status: normalizeLeadStatus(field(body, ['status']) || 'Aguardando atendimento'),
      observacoes: normalizeText(field(body, ['observacoes', 'observação', 'observacao', 'obs', 'comentarios'])) || null,
      updated_at: new Date().toISOString()
    };
    const resolvedOrigin = resolveLeadOrigin({
      origem: leadPayload.utm_source,
      utm_source: leadPayload.utm_source,
      utm_medium: leadPayload.utm_medium,
      utm_campaign: leadPayload.utm_campaign,
      utm_term: leadPayload.utm_term,
      utm_content: leadPayload.utm_content,
      operadora: leadPayload.operadora,
      observacoes: leadPayload.observacoes,
    }, 'Orion');
    const leadPayloadWithOrigin = {
      ...leadPayload,
      origem: resolvedOrigin,
    };

    const duplicateKey = buildLeadDuplicateKey(leadPayloadWithOrigin);
    let existingPage = 0;
    const existingLimit = 1000;
    let fetchExisting = true;
    let previousOwner: {
      responsavel_membro_id: string | null;
      responsavel_profile_id: string | null;
      data_entrada: string | null;
    } | null = null;
    const incomingContactKey = buildLeadContactKey(leadPayloadWithOrigin);

    while (fetchExisting) {
      const from = existingPage * existingLimit;
      const to = from + existingLimit - 1;
      const { data: existingLeads, error: existingError } = await supabaseAdmin
        .from('leads')
        .select('id, corretor_id, data_entrada, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, custo_plano_atual, investimento, cidade, operadora, utm_source, utm_medium, utm_campaign, utm_term, utm_content, status, responsavel_membro_id, responsavel_profile_id')
        .eq('corretor_id', corretorId)
        .range(from, to);

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 });
      }

      for (const existingLead of existingLeads || []) {
        if (
          buildLeadContactKey(existingLead) === incomingContactKey &&
          (existingLead.responsavel_membro_id || existingLead.responsavel_profile_id) &&
          (!previousOwner || new Date(existingLead.data_entrada || 0).getTime() > new Date(previousOwner.data_entrada || 0).getTime())
        ) {
          previousOwner = {
            responsavel_membro_id: existingLead.responsavel_membro_id || null,
            responsavel_profile_id: existingLead.responsavel_profile_id || null,
            data_entrada: existingLead.data_entrada || null,
          };
        }
      }

      const existingIdentity = (existingLeads || []).find((lead) => buildLeadIdentityKey(lead) === buildLeadIdentityKey(leadPayloadWithOrigin));
      if (existingIdentity) {
        const update = buildEnrichmentUpdate(existingIdentity, leadPayloadWithOrigin);
        if (Object.keys(update).length > 0) {
          const { data: enrichedLead, error: enrichError } = await supabaseAdmin
            .from('leads')
            .update({ ...update, updated_at: new Date().toISOString() })
            .eq('id', existingIdentity.id)
            .select('id, corretor_id, nome, telefone, status')
            .single();

          if (enrichError) {
            if (isMissingLeadOriginColumn(enrichError) && update.origem !== undefined) {
              const { origem: _origem, ...fallbackUpdate } = update;
              const fallback = await supabaseAdmin
                .from('leads')
                .update({ ...fallbackUpdate, updated_at: new Date().toISOString() })
                .eq('id', existingIdentity.id)
                .select('id, corretor_id, nome, telefone, status')
                .single();

              if (fallback.error) {
                return NextResponse.json({ error: fallback.error.message }, { status: 500 });
              }

              return NextResponse.json({
                success: true,
                duplicate: true,
                enriched: true,
                lead: fallback.data,
                ai: await tryStartLeadAiForWebhook(fallback.data.id),
                message: 'Lead existente enriquecido com dados novos.',
              });
            }
            return NextResponse.json({ error: enrichError.message }, { status: 500 });
          }

          return NextResponse.json({
            success: true,
            duplicate: true,
            enriched: true,
            lead: enrichedLead,
            ai: await tryStartLeadAiForWebhook(enrichedLead.id),
            message: 'Lead existente enriquecido com dados novos.',
          });
        }
      }

      const duplicate = (existingLeads || []).find((lead) => buildLeadDuplicateKey(lead) === duplicateKey);
      if (duplicate) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          lead: duplicate,
          ai: await tryStartLeadAiForWebhook(duplicate.id),
          message: 'Lead duplicado ignorado.',
        });
      }

      if (!existingLeads || existingLeads.length < existingLimit) {
        fetchExisting = false;
      } else {
        existingPage += 1;
      }
    }

    const payloadToInsert = previousOwner
      ? {
          ...leadPayloadWithOrigin,
          responsavel_membro_id: previousOwner.responsavel_membro_id,
          responsavel_profile_id: previousOwner.responsavel_profile_id,
        }
      : leadPayloadWithOrigin;

    let { data, error } = await supabaseAdmin
      .from('leads')
      .insert([payloadToInsert])
      .select('id, corretor_id, nome, telefone, status')
      .single();

    if (error && isMissingLeadOriginColumn(error)) {
      const { origem: _origem, ...fallbackPayload } = payloadToInsert;
      const retry = await supabaseAdmin
        .from('leads')
        .insert([fallbackPayload])
        .select('id, corretor_id, nome, telefone, status')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Lead nao foi criado.' }, { status: 500 });
    }

    const assignedMemberId = await assignLeadToNextTeamMember(corretorId, data.id);

    // Fetch final lead assignment details to notify the correct users
    const { data: finalLead } = await supabaseAdmin
      .from('leads')
      .select('id, corretor_id, nome, telefone, idades, cidade, possui_cnpj, cnpj, investimento, tem_plano_ativo, plano_atual, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id, responsavel_membro:responsavel_membro_id(nome)')
      .eq('id', data.id)
      .maybeSingle();

    const assignedMembroRaw = finalLead?.responsavel_membro;
    const assignedMembroObj = Array.isArray(assignedMembroRaw) ? assignedMembroRaw[0] : (assignedMembroRaw as any);
    const assignedMemberName = assignedMembroObj?.nome || null;
    let memberProfile: any = null;
    const { data: leadBrokerDistribution } = await supabaseAdmin
      .from('corretores')
      .select('nome_empresa')
      .eq('id', corretorId)
      .maybeSingle();
    const { data: distributionConfig } = leadBrokerDistribution?.nome_empresa
      ? await supabaseAdmin.from('corretoras').select('distribuicao_modelo')
          .ilike('nome', leadBrokerDistribution.nome_empresa).maybeSingle()
      : { data: null };
    const isSharedQueue = distributionConfig?.distribuicao_modelo === 'fila_compartilhada';

    if (finalLead?.responsavel_profile_id) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, tipo_usuario, telefone')
        .eq('id', finalLead.responsavel_profile_id)
        .maybeSingle();
      memberProfile = prof;
    }

    const aiStart = await tryStartLeadAiForWebhook(data.id);
    const aiStartError = aiStart && 'error' in aiStart ? aiStart : null;
    const botStart = aiStart?.eligible || aiStartError ? null : await tryStartLeadBotForWebhook(data.id);
    let suppressStandardLeadNotifications = Boolean(aiStart?.eligible) && !isSharedQueue;
    const aiFailureNote = aiStartError?.reason
      ? `IA nao chamou automaticamente: ${aiStartError.reason}`
      : null;
    const notificationReport = {
      standard_notifications_suppressed_by_ai: suppressStandardLeadNotifications,
      ai_handoff_will_notify_responsible: suppressStandardLeadNotifications,
      ai_start_error: aiFailureNote,
      owner_profiles_notified: [] as Array<{ id: string; nome: string | null; tipo_usuario: string | null }>,
      responsible_profile_notified: null as null | { id: string; nome: string | null; tipo_usuario: string | null },
      danilo_notified_now: false,
      note: suppressStandardLeadNotifications
        ? 'IA iniciada: notificacao padrao de novo lead foi suprimida. O responsavel sera avisado quando a IA fizer handoff.'
        : aiFailureNote
          ? `${aiFailureNote} Notificacao padrao de novo lead enviada.`
        : 'IA nao assumiu: notificacoes padrao de novo lead podem ser enviadas agora.',
    };

    if (finalLead && isSharedQueue) {
      const { data: participants } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('profile_id, profiles:profile_id(id,nome,email,tipo_usuario,telefone), time:time_id!inner(ativo, corretor:corretor_id!inner(nome_empresa))')
        .in('status', ['active', 'ativo', 'Ativo'])
        .neq('participa_rodizio', false);
      const recipients = (participants || []).flatMap((item: any) => {
        const team = Array.isArray(item.time) ? item.time[0] : item.time;
        const owner = Array.isArray(team?.corretor) ? team.corretor[0] : team?.corretor;
        const recipient = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
        return team?.ativo !== false
          && String(owner?.nome_empresa || '').trim().toLowerCase() === String(leadBrokerDistribution?.nome_empresa || '').trim().toLowerCase()
          && recipient ? [recipient] : [];
      }).filter((recipient: any, index: number, all: any[]) => all.findIndex((item) => item.id === recipient.id) === index);
      const sharedMessage = buildLeadDetailsMessage(finalLead, 'Novo lead disponível na fila compartilhada. O primeiro atendimento humano assumirá o lead.');
      for (const recipient of recipients) {
        await supabaseAdmin.from('notificacoes').insert({
          titulo: 'Novo lead disponível',
          mensagem: sharedMessage,
          destinatario_profile_id: recipient.id,
          lida: false,
        });
      }
      if (recipients.length > 0) {
        await sendApoloWhatsApp({ type: 'novo_lead', title: 'Novo lead disponível', message: sharedMessage, profiles: recipients });
      }
      notificationReport.owner_profiles_notified = recipients.map((recipient: any) => ({ id: recipient.id, nome: recipient.nome || null, tipo_usuario: recipient.tipo_usuario || null }));
      notificationReport.note = 'Fila compartilhada: todos os participantes foram avisados; a IA não assume a posse.';
      suppressStandardLeadNotifications = true;
    }

    if (finalLead && !suppressStandardLeadNotifications) {
      const { data: leadBroker } = await supabaseAdmin
        .from('corretores')
        .select('id, nome_empresa')
        .eq('id', corretorId)
        .maybeSingle();

      const { data: teamConfig } = await supabaseAdmin
        .from('corretor_times')
        .select('notificacao_novo_lead_modo')
        .eq('corretor_id', corretorId)
        .eq('ativo', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const notificationMode = normalizeLeadNotificationMode(teamConfig?.notificacao_novo_lead_modo);

      let adminQuery = supabaseAdmin
        .from('profiles')
        .select('id, nome, email, tipo_usuario, telefone')
        .in('tipo_usuario', ['corretor', 'corretor_admin'])
        .in('status', ['active', 'ativo', 'Ativo']);

      if (leadBroker?.nome_empresa) {
        adminQuery = adminQuery.eq('nome_empresa', leadBroker.nome_empresa);
      } else {
        adminQuery = adminQuery.eq('corretor_id', corretorId);
      }

      // Find active broker admin profiles for this dealership (corretor)
      const { data: admins } = await adminQuery;

      const memberName = assignedMemberName || memberProfile?.nome;
      const ownerRecipients = (admins || []).filter((admin) => admin.id !== memberProfile?.id);
      const shouldNotifyOwners = ownerRecipients.length > 0 && (
        !memberProfile ||
        notificationMode === 'responsavel_e_admins' ||
        (notificationMode === 'responsavel_e_admin_se_integrante' && memberProfile.tipo_usuario === 'corretor_membro')
      );

      // 1. Notify broker admins
      if (shouldNotifyOwners) {
        notificationReport.owner_profiles_notified = ownerRecipients.map((profile) => ({
          id: profile.id,
          nome: profile.nome || null,
          tipo_usuario: profile.tipo_usuario || null,
        }));
        notificationReport.danilo_notified_now = ownerRecipients.some((profile) =>
          normalizeKey(profile.nome || '').includes('danilo')
        );

        const adminMsg = buildLeadDetailsMessage(
          finalLead,
          [
            memberName
              ? `Chegou um lead para ${memberName}.`
              : 'Chegou um lead sem responsavel definido.',
            aiFailureNote,
          ].filter(Boolean).join('\n')
        );

        for (const admin of ownerRecipients) {
          await supabaseAdmin.from('notificacoes').insert([{
            titulo: 'Novo lead recebido',
            mensagem: adminMsg,
            destinatario_profile_id: admin.id,
            lida: false,
          }]);
        }

        try {
          await sendApoloWhatsApp({
            type: 'novo_lead',
            title: 'Novo lead recebido',
            message: adminMsg,
            profiles: ownerRecipients,
          });
        } catch (waErr) {
          console.error('[Webhook n8n] Failed sending admin WA notification:', waErr);
        }
      }

      // 2. Notify assigned member broker
      if (memberProfile) {
        notificationReport.responsible_profile_notified = {
          id: memberProfile.id,
          nome: memberProfile.nome || null,
          tipo_usuario: memberProfile.tipo_usuario || null,
        };
        if (normalizeKey(memberProfile.nome || '').includes('danilo')) {
          notificationReport.danilo_notified_now = true;
        }

        const memberMsg = buildLeadDetailsMessage(
          finalLead,
          [
            'Novo lead pronto para atendimento.',
            aiFailureNote,
            'Esse lead acabou de entrar em contato com voce pelo CRM. Responda o quanto antes para aproveitar o momento de interesse.',
          ].filter(Boolean).join('\n\n')
        );

        await supabaseAdmin.from('notificacoes').insert([{
          titulo: 'Novo lead pronto para atendimento',
          mensagem: memberMsg,
          destinatario_profile_id: memberProfile.id,
          lida: false,
        }]);

        try {
          await sendApoloWhatsApp({
            type: 'novo_lead',
            title: 'Novo lead pronto para atendimento',
            message: memberMsg,
            profiles: [memberProfile],
          });
        } catch (waErr) {
          console.error('[Webhook n8n] Failed sending member WA notification:', waErr);
        }
      }
    }

    await writeAuditLog(request, null, {
      action: 'lead.create_webhook_n8n',
      entity_type: 'lead',
      entity_id: data.id,
      metadata: {
        corretor_id: corretorId,
        assigned_member_id: assignedMemberId,
        assigned_member_name: assignedMemberName,
        responsible_profile_id: finalLead?.responsavel_profile_id || null,
        responsible_profile_name: memberProfile?.nome || null,
        source: 'n8n',
        ai_start: aiStart,
        bot_start: botStart,
        notifications: notificationReport,
      },
    });

    return NextResponse.json({
      success: true,
      lead: data,
      assignment: {
        responsavel_membro_id: assignedMemberId,
        responsavel_membro_nome: assignedMemberName,
        responsavel_profile_id: finalLead?.responsavel_profile_id || null,
        responsavel_profile_nome: memberProfile?.nome || null,
      },
      ai: aiStart,
      bot: botStart,
      notifications: notificationReport,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao receber lead do n8n.' }, { status: 500 });
  }
}
