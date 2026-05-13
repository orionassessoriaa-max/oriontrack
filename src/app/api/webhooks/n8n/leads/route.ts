import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';

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
  const corretorId = normalizeText(body.corretor_id);
  if (corretorId) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('id', corretorId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  const corretorEmail = normalizeText(body.corretor_email || body.email_corretor).toLowerCase();
  if (corretorEmail) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('email', corretorEmail)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  const corretorNome = normalizeText(body.corretor_nome || body.nome_corretor);
  if (corretorNome) {
    const { data } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .ilike('nome', corretorNome)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  return null;
}

export async function POST(request: Request) {
  try {
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
      investimento: normalizeText(body.investimento || body.valor || body.budget),
      cidade: normalizeText(body.cidade || body.city),
      operadora: normalizeText(body.operadora || body.operator) || null,
      status: normalizeLeadStatus(body.status || 'Aguardando atendimento'),
      observacoes: normalizeText(body.observacoes || body.obs) || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert([leadPayload])
      .select('id, corretor_id, nome, telefone, status')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, lead: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao receber lead do n8n.' }, { status: 500 });
  }
}
