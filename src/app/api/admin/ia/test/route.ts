import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { startLeadAiIfEligible } from '@/lib/leadAiAgent';
import { ensureLeadAiTimeoutScheduler } from '@/lib/leadAiTimeoutScheduler';
import { normalizePhone } from '@/lib/uazapi';

function cleanText(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeCnpjLabel(value: unknown) {
  const raw = String(value ?? '').trim();
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!normalized) return 'Nao informado';
  if (normalized.includes('mei')) return 'Tenho MEI';
  if (['sim', 's', 'com cnpj', 'tenho cnpj', 'cnpj'].some((item) => normalized.includes(item))) return 'Com CNPJ';
  if (['nao', 'n', 'sem cnpj', 'cpf', 'pessoa fisica'].some((item) => normalized.includes(item))) return 'Sem CNPJ';
  return raw;
}

async function findAdminForCorretora(corretoraName: string, preferredProfileId?: string | null) {
  const { data: corretores, error: corretoresError } = await supabaseAdmin
    .from('corretores')
    .select('id')
    .ilike('nome_empresa', corretoraName);

  if (corretoresError) throw corretoresError;

  const corretorIds = (corretores || []).map((corretor) => corretor.id).filter(Boolean);
  if (corretorIds.length === 0) return null;

  if (preferredProfileId) {
    const { data: preferred, error: preferredError } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, tipo_usuario, corretor_id, nome_empresa, telefone, status')
      .eq('id', preferredProfileId)
      .in('corretor_id', corretorIds)
      .in('tipo_usuario', ['corretor_admin', 'corretor'])
      .in('status', ['active', 'ativo', 'Ativo'])
      .maybeSingle();

    if (preferredError) throw preferredError;
    if (preferred?.corretor_id) return preferred;
  }

  const { data: admins, error } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, tipo_usuario, corretor_id, nome_empresa, telefone, status')
    .in('tipo_usuario', ['corretor_admin', 'corretor'])
    .in('corretor_id', corretorIds)
    .in('status', ['active', 'ativo', 'Ativo'])
    .order('tipo_usuario', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) throw error;

  const activeAdmins = admins || [];
  return (
    activeAdmins.find((profile) => profile.tipo_usuario === 'corretor_admin' && profile.corretor_id) ||
    activeAdmins.find((profile) => profile.tipo_usuario === 'corretor' && profile.corretor_id) ||
    null
  );
}

async function findBrokerForCorretora(corretoraName: string) {
  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .ilike('nome_empresa', corretoraName)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function POST(request: Request) {
  try {
    ensureLeadAiTimeoutScheduler();

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const limited = rateLimit(request, 'admin:ia:test', { limit: 20, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const configId = cleanText(body.config_id);
    const phone = normalizePhone(body.telefone);
    const leadName = cleanText(body.nome, 'Teste IA');

    if (!configId) {
      return NextResponse.json({ error: 'Selecione uma concessionaria com IA ativa.' }, { status: 400 });
    }

    if (!phone || phone.length < 12) {
      return NextResponse.json({ error: 'Informe um WhatsApp valido com DDD.' }, { status: 400 });
    }

    const { data: config, error: configError } = await supabaseAdmin
      .from('corretora_ai_configs')
      .select('id, corretora_id, persona, status, sender_profile_id, corretoras(id, nome, status)')
      .eq('id', configId)
      .eq('status', 'ativo')
      .maybeSingle();

    if (configError) throw configError;
    if (!config) {
      return NextResponse.json({ error: 'Configuracao de IA ativa nao encontrada.' }, { status: 404 });
    }

    const corretora = Array.isArray(config.corretoras)
      ? config.corretoras[0]
      : config.corretoras;

    if (!corretora?.nome) {
      return NextResponse.json({ error: 'Configuracao de IA ativa nao encontrada.' }, { status: 404 });
    }

    const corretoraName = corretora.nome;
    const adminProfile = await findAdminForCorretora(corretoraName, config.sender_profile_id);
    const broker = adminProfile?.corretor_id
      ? { id: adminProfile.corretor_id }
      : await findBrokerForCorretora(corretoraName);

    if (!broker?.id) {
      return NextResponse.json({
        error: 'Esta concessionaria precisa de um Corretor Admin ou corretor principal antes do teste.',
      }, { status: 400 });
    }

    const now = new Date();
    const uniqueToken = `teste-ia-${now.getTime()}`;

    const { data: lead, error: leadError } = await supabaseAdmin
      .from('leads')
      .insert([{
        corretor_id: broker.id,
        responsavel_profile_id: adminProfile?.id || null,
        data_entrada: now.toISOString(),
        nome: leadName,
        telefone: phone,
        idades: cleanText(body.idades, '32'),
        possui_cnpj: normalizeCnpjLabel(body.possui_cnpj || 'Nao informado'),
        cnpj: cleanText(body.cnpj) || null,
        tem_plano_ativo: cleanText(body.tem_plano_ativo, 'Nao'),
        plano_atual: cleanText(body.plano_atual, 'Nao informado'),
        investimento: cleanText(body.investimento, 'Menos de R$1.000,00'),
        cidade: cleanText(body.cidade, 'Teste IA'),
        operadora: cleanText(body.operadora, 'HAPVIDA'),
        utm_source: 'Teste IA',
        utm_medium: 'Orion Track',
        utm_campaign: uniqueToken,
        utm_term: uniqueToken,
        utm_content: 'Teste IA - painel admin',
        status: 'Aguardando atendimento',
        observacoes: null,
        updated_at: now.toISOString(),
      }])
      .select('id, nome, telefone, corretor_id, responsavel_profile_id')
      .single();

    if (leadError) throw leadError;

    let ai: Awaited<ReturnType<typeof startLeadAiIfEligible>>;
    try {
      ai = await startLeadAiIfEligible(lead.id);
    } catch (error: any) {
      const rawMessage = String(error?.message || '');
      const isDisconnected = rawMessage.toLowerCase().includes('whatsapp disconnected');
      return NextResponse.json({
        ok: false,
        lead,
        error: isDisconnected
          ? `WhatsApp desconectado no perfil que envia a IA: ${adminProfile?.nome || 'admin da concessionaria'}${adminProfile?.telefone ? ` (${adminProfile.telefone})` : ''}. Reconecte esse perfil no Apolo WhatsApp e teste de novo.`
          : rawMessage || 'Lead de teste criado, mas a IA nao conseguiu enviar a mensagem.',
        sender: adminProfile ? {
          id: adminProfile.id,
          nome: adminProfile.nome,
          telefone: adminProfile.telefone,
          tipo_usuario: adminProfile.tipo_usuario,
        } : null,
      }, { status: 400 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'send_ai_test',
      entity_type: 'lead',
      entity_id: lead.id,
      metadata: {
        config_id: config.id,
        corretora_id: config.corretora_id,
        corretora: corretoraName,
        telefone: phone,
        ai,
      },
    });

    if (!ai?.started) {
      return NextResponse.json({
        ok: false,
        lead,
        ai,
        error: ai?.reason || 'Lead de teste criado, mas a IA nao iniciou.',
      }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      lead,
      ai,
      message: 'Teste enviado. A IA iniciou a conversa pelo WhatsApp.',
    });
  } catch (error: any) {
    console.error('[api_admin_ia_test] POST error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao enviar teste da IA.' },
      { status: 500 }
    );
  }
}
