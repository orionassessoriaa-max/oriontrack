import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';
import { rateLimit, writeAuditLog } from '@/lib/api/security';
import { buildLeadDuplicateKey } from '@/lib/leadDuplicate';

function normalizeText(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeBooleanLabel(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (['sim', 's', 'true', '1', 'yes'].includes(text)) return 'Sim';
  if (['nao', 'não', 'n', 'false', '0', 'no'].includes(text)) return 'Não';
  return normalizeText(value, 'Não informado') || 'Não informado';
}

async function resolveCorretorId(body: any) {
  let resolvedId: string | null = null;

  const corretorId = normalizeText(body.corretor_id);
  if (corretorId) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('id', corretorId)
      .maybeSingle();
    if (data?.id) resolvedId = data.id;
  }

  if (!resolvedId) {
    const corretorEmail = normalizeText(body.corretor_email || body.email_corretor).toLowerCase();
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
    const corretorNome = normalizeText(body.corretor_nome || body.nome_corretor);
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

    const body = await request.json();
    const corretorId = await resolveCorretorId(body);

    if (!corretorId) {
      return NextResponse.json({
        error: 'Corretor não encontrado. Envie corretor_id, corretor_email ou corretor_nome.'
      }, { status: 400 });
    }

    const nome = normalizeText(body.nome || body.name || body.lead_nome);
    const telefone = normalizeText(body.telefone || body.phone || body.whatsapp);

    if (!nome || !telefone) {
      return NextResponse.json({ error: 'Nome e telefone do lead são obrigatórios.' }, { status: 400 });
    }

    const dataEntrada = body.data_entrada
      ? new Date(body.data_entrada).toISOString()
      : new Date().toISOString();

    const leadPayload = {
      corretor_id: corretorId,
      data_entrada: dataEntrada,
      nome,
      telefone,
      idades: normalizeText(body.idades || body.vidas || body.age_group),
      possui_cnpj: normalizeBooleanLabel(body.possui_cnpj || body.cnpj),
      tem_plano_ativo: normalizeBooleanLabel(body.tem_plano_ativo || body.plano_ativo),
      plano_atual: normalizeText(body.plano_atual || body.plano) || null,
      custo_plano_atual: normalizeText(body.custo_plano_atual || body.custo_atual || body.valor_plano_atual || body.valor_atual) || null,
      investimento: normalizeText(body.investimento || body.investimento_pretendido || body.valor_pretendido || body.budget),
      cidade: normalizeText(body.cidade || body.city),
      operadora: normalizeText(body.operadora || body.operator) || null,
      utm_source: normalizeText(body.utm_source) || null,
      utm_medium: normalizeText(body.utm_medium) || null,
      utm_campaign: normalizeText(body.utm_campaign || body.campanha) || null,
      utm_term: normalizeText(body.utm_term || body.conjunto || body.conjunto_anuncio) || null,
      utm_content: normalizeText(body.utm_content || body.anuncio || body.criativo) || null,
      status: normalizeLeadStatus(body.status || 'Aguardando atendimento'),
      observacoes: normalizeText(body.observacoes || body.obs) || null,
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
