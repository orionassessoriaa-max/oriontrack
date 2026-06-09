import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';
import { rateLimit, writeAuditLog } from '@/lib/api/security';
import { buildLeadDuplicateKey } from '@/lib/leadDuplicate';

function normalizeText(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
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
    source.payload,
    source.json,
    source.respondent?.answers,
    source.answers,
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));

  return Object.assign({}, source, ...nested);
}

function field(body: Record<string, any>, aliases: string[]) {
  const normalized = new Map<string, unknown>();
  Object.entries(body || {}).forEach(([key, value]) => {
    normalized.set(normalizeKey(key), value);
  });

  for (const alias of aliases) {
    const direct = body[alias];
    if (direct !== undefined && direct !== null && normalizeText(direct)) return direct;
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined && value !== null && normalizeText(value)) return value;
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

function normalizeBooleanLabel(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (['sim', 's', 'true', '1', 'yes'].includes(text)) return 'Sim';
  if (['nao', 'não', 'n', 'false', '0', 'no'].includes(text)) return 'Não';
  return normalizeText(value, 'Não informado') || 'Não informado';
}

async function resolveCorretorId(body: any) {
  let resolvedId: string | null = null;

  const corretorId = normalizeText(field(body, ['corretor_id', 'id_corretor', 'broker_id']));
  if (corretorId) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('id', corretorId)
      .maybeSingle();
    if (data?.id) resolvedId = data.id;
  }

  if (!resolvedId) {
    const corretorEmail = normalizeText(field(body, ['corretor_email', 'email_corretor', 'email do corretor'])).toLowerCase();
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
  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('rodizio_ativo')
    .eq('id', corretorId)
    .maybeSingle();

  if (broker?.rodizio_ativo === false) return null;

  const { data: team } = await supabaseAdmin
    .from('corretor_times')
    .select('id, proximo_indice')
    .eq('corretor_id', corretorId)
    .eq('ativo', true)
    .maybeSingle();

  if (!team?.id) return null;

  const { data: members } = await supabaseAdmin
    .from('corretor_time_membros')
    .select('id, profile_id, ordem, created_at')
    .eq('time_id', team.id)
    .in('status', ['active', 'ativo'])
    .not('profile_id', 'is', null)
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true });

  if (!members || members.length === 0) return null;

  const nextIndex = Math.max(Number(team.proximo_indice || 0), 0) % members.length;
  const member = members[nextIndex];
  const nextPointer = (nextIndex + 1) % members.length;
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

  await supabaseAdmin
    .from('corretor_times')
    .update({ proximo_indice: nextPointer })
    .eq('id', team.id);

  return member.id;
}

export async function POST(request: Request) {
  try {
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
        error: 'Corretor não encontrado. Envie corretor_id, corretor_email ou corretor_nome.'
      }, { status: 400 });
    }

    const nome = normalizeText(field(body, ['nome', 'name', 'lead_nome', 'cliente', 'nome completo']));
    const telefone = normalizeText(field(body, ['telefone', 'phone', 'whatsapp', 'celular', 'fone']));

    if (!nome || !telefone) {
      return NextResponse.json({ error: 'Nome e telefone do lead são obrigatórios.' }, { status: 400 });
    }

    const rawDate = field(body, ['data_entrada', 'data entrada', 'data', 'created_time', 'timestamp', 'data do lead']);
    const dataEntrada = rawDate
      ? new Date(rawDate).toISOString()
      : new Date().toISOString();

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

    const leadPayload = {
      corretor_id: corretorId,
      data_entrada: dataEntrada,
      nome,
      telefone,
      idades: normalizeText(field(body, ['idades', 'idade', 'vidas', 'quantidade de vidas', 'qtd vidas', 'age_group'])),
      possui_cnpj: normalizeBooleanLabel(field(body, ['possui_cnpj', 'possui cnpj', 'cnpj', 'tem cnpj'])),
      tem_plano_ativo: normalizeBooleanLabel(field(body, ['tem_plano_ativo', 'tem plano ativo', 'plano ativo', 'possui plano', 'possui convenio', 'tem convenio', 'ja tem plano', 'já tem plano'])),
      plano_atual: normalizeText(field(body, ['plano_atual', 'plano atual', 'operadora atual', 'convenio atual', 'convênio atual', 'seguradora atual', 'plano'])) || null,
      custo_plano_atual: normalizeText(field(body, ['custo_plano_atual', 'custo plano atual', 'custo atual', 'valor plano atual', 'valor do plano atual', 'mensalidade atual', 'valor_atual'])) || null,
      investimento: normalizeText(field(body, ['investimento', 'investimento pretendido', 'investimento_pretendido', 'pretensao investimento', 'valor_pretendido', 'budget', 'orcamento'])),
      cidade: normalizeText(field(body, ['cidade', 'city', 'regiao', 'localidade'])),
      operadora: normalizeText(field(body, ['operadora', 'pagina', 'página', 'aba', 'operator', 'page', 'source_page'])) || null,
      utm_source: normalizeText(field(body, ['utm_source', 'source', 'origem', 'utm origem'])) || null,
      utm_medium: normalizeText(field(body, ['utm_medium', 'medium', 'meio', 'utm meio'])) || null,
      utm_campaign: normalizeText(field(body, ['utm_campaign', 'campaign', 'campanha', 'nome campanha'])) || null,
      utm_term: normalizeText(field(body, ['utm_term', 'term', 'conjunto', 'conjunto de anuncio', 'conjunto_anuncio', 'adset', 'ad set'])) || null,
      utm_content: normalizeText(field(body, ['utm_content', 'content', 'anuncio', 'anúncio', 'ad', 'criativo'])) || null,
      valor_negociacao: valorNegociacao,
      operadora_negociacao: normalizeText(field(body, ['operadora_negociacao', 'operadora negociacao', 'operadora negociação', 'operadora venda', 'operadora da venda', 'operadora escolhida'])) || null,
      status: normalizeLeadStatus(field(body, ['status']) || 'Aguardando atendimento'),
      observacoes: normalizeText(field(body, ['observacoes', 'observação', 'observacao', 'obs', 'comentarios'])) || null,
      updated_at: new Date().toISOString()
    };

    const duplicateKey = buildLeadDuplicateKey(leadPayload);
    let existingPage = 0;
    const existingLimit = 1000;
    let fetchExisting = true;

    while (fetchExisting) {
      const from = existingPage * existingLimit;
      const to = from + existingLimit - 1;
      const { data: existingLeads, error: existingError } = await supabaseAdmin
        .from('leads')
        .select('id, corretor_id, data_entrada, nome, telefone, idades, possui_cnpj, tem_plano_ativo, plano_atual, custo_plano_atual, investimento, cidade, operadora, utm_source, utm_medium, utm_campaign, utm_term, utm_content, status')
        .eq('corretor_id', corretorId)
        .range(from, to);

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 });
      }

      const duplicate = (existingLeads || []).find((lead) => buildLeadDuplicateKey(lead) === duplicateKey);
      if (duplicate) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          lead: duplicate,
          message: 'Lead duplicado ignorado.',
        });
      }

      if (!existingLeads || existingLeads.length < existingLimit) {
        fetchExisting = false;
      } else {
        existingPage += 1;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert([leadPayload])
      .select('id, corretor_id, nome, telefone, status')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const assignedMemberId = await assignLeadToNextTeamMember(corretorId, data.id);

    await writeAuditLog(request, null, {
      action: 'lead.create_webhook_n8n',
      entity_type: 'lead',
      entity_id: data.id,
      metadata: {
        corretor_id: corretorId,
        assigned_member_id: assignedMemberId,
        source: 'n8n',
      },
    });

    return NextResponse.json({ success: true, lead: data, responsavel_membro_id: assignedMemberId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao receber lead do n8n.' }, { status: 500 });
  }
}
