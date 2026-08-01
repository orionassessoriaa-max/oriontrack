import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';
import { rateLimit, writeAuditLog } from '@/lib/api/security';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';
import { startLeadBotIfEligible } from '@/lib/leadBot';
import { isMissingLeadOriginColumn, resolveLeadOrigin } from '@/lib/leadOrigin';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { buildLeadContactKey, buildLeadIdentityKey } from '@/lib/leadDuplicate';

const ACTIVE_PROFILE_STATUSES = ['active', 'ativo', 'Ativo'];
const LEAD_CREATOR_PROFILE_TYPES = [
  'admin',
  'corretor',
  'corretor_admin',
  'corretor_membro',
  'corretor_integrante',
  'corretor_parceiro',
  'gestor_trafego',
];
const ASSIGNABLE_PROFILE_TYPES = [
  'corretor',
  'corretor_admin',
  'corretor_membro',
  'corretor_integrante',
  'corretor_parceiro',
];

async function requireLeadCreator(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, is_admin_master, nome_empresa')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !LEAD_CREATOR_PROFILE_TYPES.includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

async function resolveProfileCorretorId(profile: any) {
  if (profile.corretor_id) return profile.corretor_id;

  const emails = [profile.email, profile.email_real]
    .filter(Boolean)
    .map((email) => String(email).trim().toLowerCase());

  if (emails.length > 0) {
    const { data: corretorByEmail } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .or(emails.map((email) => `email.eq.${email},email_real.eq.${email}`).join(','))
      .maybeSingle();

    if (corretorByEmail?.id) {
      await supabaseAdmin
        .from('profiles')
        .update({ corretor_id: corretorByEmail.id })
        .eq('id', profile.id);
      return corretorByEmail.id;
    }
  }

  const brokerageName = String(profile.nome_empresa || '').trim();
  if (brokerageName) {
    const { data: corretorByCompany } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', brokerageName)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (corretorByCompany?.id) {
      await supabaseAdmin
        .from('profiles')
        .update({ corretor_id: corretorByCompany.id })
        .eq('id', profile.id);
      return corretorByCompany.id;
    }
  }

  return null;
}

async function getCorretorScopeForProfile(profile: any, requestedCorretorId: string) {
  if (profile.tipo_usuario === 'admin') {
    if (!requestedCorretorId) return { error: 'Selecione um corretor.' };
    return { corretorId: requestedCorretorId, corretorIds: [requestedCorretorId] };
  }

  if (profile.tipo_usuario === 'gestor_trafego') {
    if (!requestedCorretorId) return { error: 'Selecione uma concessionaria.' };

    const { data: requestedCorretor } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, nome_empresa, gestor_trafego_id, time_operacional')
      .eq('id', requestedCorretorId)
      .maybeSingle();

    if (!requestedCorretor || !isGestorLinkedToConcessionariaCorretor(requestedCorretor, profile)) {
      return { error: 'Voce so pode criar leads para concessionarias atribuidas a voce.' };
    }

    let corretorIds = [requestedCorretor.id];
    if (requestedCorretor.nome_empresa) {
      const { data: siblings } = await supabaseAdmin
        .from('corretores')
        .select('id, nome, nome_empresa, gestor_trafego_id, time_operacional')
        .eq('nome_empresa', requestedCorretor.nome_empresa);
      corretorIds = (siblings || [])
        .filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, profile))
        .map((corretor) => corretor.id);
    }

    return { corretorId: requestedCorretor.id, corretorIds };
  }

  const ownCorretorId = await resolveProfileCorretorId(profile);
  if (!ownCorretorId) return { error: 'Perfil sem corretor vinculado.' };

  const { data: ownCorretor } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa')
    .eq('id', ownCorretorId)
    .maybeSingle();

  if (!ownCorretor) return { error: 'Corretor principal nao encontrado.' };

  let corretorIds = [ownCorretor.id];
  if (ownCorretor.nome_empresa) {
    const { data: siblings } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', ownCorretor.nome_empresa);
    corretorIds = (siblings || []).map((item) => item.id);
  }

  const corretorId = requestedCorretorId || ownCorretor.id;
  if (!corretorIds.includes(corretorId)) {
    return { error: 'Voce so pode criar leads para sua propria concessionaria.' };
  }

  return { corretorId, corretorIds };
}

async function resolveResponsibleMember(corretorId: string, corretorIds: string[], rawMemberId: string) {
  const memberId = rawMemberId.trim();
  if (!memberId || memberId === 'unassigned') return { member: null };

  let resolvedMemberId = memberId;

  if (memberId.startsWith('profile:')) {
    const profileId = memberId.replace('profile:', '').trim();
    const { data: assignableProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real')
      .eq('id', profileId)
      .in('corretor_id', corretorIds)
      .in('tipo_usuario', ASSIGNABLE_PROFILE_TYPES)
      .in('status', ACTIVE_PROFILE_STATUSES)
      .maybeSingle();

    if (!assignableProfile) return { error: 'Responsavel nao encontrado nesta concessionaria.' };

    const { data: team } = await supabaseAdmin
      .from('corretor_times')
      .select('id')
      .eq('corretor_id', corretorId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let teamId = team?.id;
    if (!teamId) {
      const { data: createdTeam, error: teamError } = await supabaseAdmin
        .from('corretor_times')
        .insert([{ corretor_id: corretorId, nome: 'Time comercial' }])
        .select('id')
        .single();
      if (teamError) throw teamError;
      teamId = createdTeam.id;
    }

    const { data: existingMember } = await supabaseAdmin
      .from('corretor_time_membros')
      .select('id, profile_id, nome, email')
      .eq('time_id', teamId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (existingMember?.id) {
      return { member: existingMember };
    }

    const { data: lastMember } = await supabaseAdmin
      .from('corretor_time_membros')
      .select('ordem')
      .eq('time_id', teamId)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: createdMember, error: createMemberError } = await supabaseAdmin
      .from('corretor_time_membros')
      .insert([{
        time_id: teamId,
        corretor_id: corretorId,
        profile_id: profileId,
        nome: assignableProfile.nome,
        email: assignableProfile.email_real || assignableProfile.email,
        status: 'ativo',
        participa_rodizio: true,
        ordem: Number(lastMember?.ordem || 0) + 1,
      }])
      .select('id, profile_id, nome, email')
      .single();

    if (createMemberError) throw createMemberError;
    return { member: createdMember };
  }

  const { data: member } = await supabaseAdmin
    .from('corretor_time_membros')
    .select('id, profile_id, nome, email')
    .eq('id', resolvedMemberId)
    .in('corretor_id', corretorIds)
    .in('status', ACTIVE_PROFILE_STATUSES)
    .maybeSingle();

  if (!member) return { error: 'Integrante nao encontrado.' };
  return { member };
}

function buildManualLeadMessage(lead: any, responsibleName?: string | null) {
  const lines = [
    responsibleName
      ? `Novo lead pronto para atendimento.\n\nEsse lead foi criado no CRM e esta sob responsabilidade de ${responsibleName}. Responda o quanto antes para aproveitar o momento de interesse.`
      : 'Novo lead criado manualmente.',
    '',
    `Nome: ${lead.nome}`,
    `Telefone: ${lead.telefone}`,
  ];
  if (lead.idades) lines.push(`Idades: ${lead.idades}`);
  if (lead.cidade) lines.push(`Cidade: ${lead.cidade}`);
  if (lead.investimento) lines.push(`Investimento: ${lead.investimento}`);
  if (lead.possui_cnpj) lines.push(`CNPJ: ${lead.possui_cnpj}`);
  if (lead.tem_plano_ativo) lines.push(`Tem plano de saude: ${lead.tem_plano_ativo}`);
  if (lead.plano_atual) lines.push(`Plano atual: ${lead.plano_atual}`);
  return lines.join('\n');
}

async function findPreviousLeadAssignment(
  corretorId: string,
  nome: string,
  telefone: string,
  dataEntrada: string,
) {
  const incoming = { corretor_id: corretorId, nome, telefone, data_entrada: dataEntrada };
  const contactKey = buildLeadContactKey(incoming);
  const identityKey = buildLeadIdentityKey(incoming);
  let page = 0;
  const limit = 1000;
  let previousOwner: {
    responsavel_membro_id: string | null;
    responsavel_profile_id: string | null;
    data_entrada: string | null;
  } | null = null;

  while (true) {
    const from = page * limit;
    const { data: leads, error } = await supabaseAdmin
      .from('leads')
      .select('id, corretor_id, nome, telefone, data_entrada, responsavel_membro_id, responsavel_profile_id')
      .eq('corretor_id', corretorId)
      .range(from, from + limit - 1);

    if (error) throw error;

    for (const lead of leads || []) {
      if (buildLeadIdentityKey(lead) === identityKey) {
        return { sameDateLeadId: lead.id, previousOwner };
      }
      if (
        buildLeadContactKey(lead) === contactKey &&
        (lead.responsavel_membro_id || lead.responsavel_profile_id) &&
        (!previousOwner || new Date(lead.data_entrada || 0).getTime() > new Date(previousOwner.data_entrada || 0).getTime())
      ) {
        previousOwner = {
          responsavel_membro_id: lead.responsavel_membro_id || null,
          responsavel_profile_id: lead.responsavel_profile_id || null,
          data_entrada: lead.data_entrada || null,
        };
      }
    }

    if (!leads || leads.length < limit) break;
    page += 1;
  }

  return { sameDateLeadId: null, previousOwner };
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'admin:leads:create', { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const guard = await requireLeadCreator(request);
  if ('error' in guard) return guard.error;

  try {
    const body = await request.json();
    const requestedCorretorId = String(body.corretor_id || '').trim();
    const nome = String(body.nome || '').trim();
    const telefone = String(body.telefone || '').trim();
    const scope = await getCorretorScopeForProfile(guard.profile, requestedCorretorId);
    if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: 403 });
    const corretorId = scope.corretorId;

    if (!nome || !telefone) {
      return NextResponse.json({ error: 'Informe nome e telefone do lead.' }, { status: 400 });
    }

    const { data: corretor } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('id', corretorId)
      .maybeSingle();

    if (!corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    const rawResponsibleId = String(body.responsavel_membro_id || '');
    const selfAssignedProfileTypes = ['corretor_membro', 'corretor_integrante', 'corretor_parceiro'];
    let responsibleId = selfAssignedProfileTypes.includes(guard.profile.tipo_usuario)
      && (!rawResponsibleId || rawResponsibleId === 'unassigned')
        ? `profile:${guard.profile.id}`
        : rawResponsibleId;
    const dataEntrada = body.data_entrada ? new Date(body.data_entrada).toISOString() : new Date().toISOString();
    const previous = await findPreviousLeadAssignment(corretorId, nome, telefone, dataEntrada);

    if (previous.sameDateLeadId) {
      return NextResponse.json({
        error: 'Este lead ja foi cadastrado nesta mesma data.',
        duplicate: true,
        lead_id: previous.sameDateLeadId,
      }, { status: 409 });
    }

    if ((!responsibleId || responsibleId === 'unassigned') && previous.previousOwner) {
      responsibleId = previous.previousOwner.responsavel_membro_id
        || (previous.previousOwner.responsavel_profile_id ? `profile:${previous.previousOwner.responsavel_profile_id}` : '');
    }
    const responsibleResult = await resolveResponsibleMember(corretorId, scope.corretorIds, responsibleId);
    if ('error' in responsibleResult) return NextResponse.json({ error: responsibleResult.error }, { status: 400 });
    const responsibleMember = responsibleResult.member;

    const origem = resolveLeadOrigin({
      origem: body.origem,
      utm_source: body.utm_source,
      utm_medium: body.utm_medium,
      utm_campaign: body.utm_campaign,
      utm_term: body.utm_term,
      utm_content: body.utm_content,
      campaign: body.campanha,
      adset: body.conjunto,
      ad: body.anuncio,
      operadora: body.operadora,
    }, 'Manual');
    const leadPayload = {
      corretor_id: corretorId,
      nome,
      telefone,
      idades: String(body.idades || ''),
      possui_cnpj: String(body.possui_cnpj || 'Nao informado'),
      cnpj: body.cnpj ? String(body.cnpj) : null,
      tem_plano_ativo: String(body.tem_plano_ativo || 'Nao informado'),
      plano_atual: String(body.plano_atual || ''),
      custo_plano_atual: String(body.custo_plano_atual || ''),
      investimento: String(body.investimento || ''),
      cidade: String(body.cidade || ''),
      operadora: body.operadora ? String(body.operadora) : null,
      origem,
      utm_source: origem,
      responsavel_membro_id: responsibleMember?.id || null,
      responsavel_profile_id: responsibleMember?.profile_id || null,
      status: normalizeLeadStatus(body.status || 'Aguardando atendimento'),
      data_entrada: dataEntrada,
    };

    let { data, error } = await supabaseAdmin
      .from('leads')
      .insert([leadPayload])
      .select('*, responsavel_membro:responsavel_membro_id(nome,email)')
      .single();

    if (error && isMissingLeadOriginColumn(error)) {
      const { origem: _origem, ...fallbackPayload } = leadPayload;
      const retry = await supabaseAdmin
        .from('leads')
        .insert([fallbackPayload])
        .select('*, responsavel_membro:responsavel_membro_id(nome,email)')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await writeAuditLog(request, guard.profile as any, {
      action: 'lead.create_admin',
      entity_type: 'lead',
      entity_id: data.id,
      metadata: { corretor_id: corretorId, nome, responsavel_membro_id: responsibleMember?.id || null },
    });

    if (responsibleMember?.profile_id) {
      const { data: responsibleProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, tipo_usuario, telefone')
        .eq('id', responsibleMember.profile_id)
        .maybeSingle();

      if (responsibleProfile?.id) {
        const message = buildManualLeadMessage(data, responsibleMember.nome);
        await supabaseAdmin.from('notificacoes').insert([{
          titulo: 'Novo lead pronto para atendimento',
          mensagem: message,
          destinatario_profile_id: responsibleProfile.id,
          remetente_profile_id: guard.profile.id,
          lida: false,
        }]);

        try {
          await sendApoloWhatsApp({
            type: 'novo_lead',
            title: 'Novo lead pronto para atendimento',
            message,
            profiles: [responsibleProfile],
          });
        } catch (waErr) {
          console.error('[Manual lead] Failed sending WA notification:', waErr);
        }
      }
    }

    let botStart = null;
    try {
      botStart = await startLeadBotIfEligible(data.id);
    } catch (botErr) {
      console.error('[Manual lead] Failed starting lead bot:', botErr);
    }

    return NextResponse.json({ ok: true, lead_id: data.id, lead: data, bot: botStart });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro ao salvar lead.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const limited = rateLimit(request, 'admin:leads:delete-bulk', { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const guard = await requireLeadCreator(request);
  if ('error' in guard) return guard.error;
  if (guard.profile.tipo_usuario !== 'admin') {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== 'DELETE_ALL_LEADS') {
      return NextResponse.json({ error: 'Confirmacao invalida para remover todos os leads.' }, { status: 400 });
    }

    const corretorId = String(body.corretor_id || '').trim();
    const requestedCorretorIds = Array.isArray(body.corretor_ids)
      ? body.corretor_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const corretorIds = Array.from(new Set(corretorId ? [corretorId] : requestedCorretorIds));
    const concessionariaNome = String(body.concessionaria || '').trim();
    let scopeNome = concessionariaNome;

    if (corretorIds.length > 0) {
      const { data: corretores, error: corretorError } = await supabaseAdmin
        .from('corretores')
        .select('id, nome, nome_empresa')
        .in('id', corretorIds);

      if (corretorError) {
        return NextResponse.json({ error: corretorError.message }, { status: 500 });
      }

      if (!corretores || corretores.length !== corretorIds.length) {
        return NextResponse.json({ error: 'Concessionaria nao encontrada.' }, { status: 404 });
      }

      scopeNome = scopeNome || corretores[0]?.nome_empresa || corretores[0]?.nome || '';
    }

    let countQuery = supabaseAdmin
      .from('leads')
      .select('id', { count: 'exact', head: true });

    if (corretorIds.length > 0) countQuery = countQuery.in('corretor_id', corretorIds);

    const { count, error: countError } = await countQuery;

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    let deleteQuery = supabaseAdmin
      .from('leads')
      .delete()
      .not('id', 'is', null);

    if (corretorIds.length > 0) deleteQuery = deleteQuery.in('corretor_id', corretorIds);

    const { error } = await deleteQuery;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile as any, {
      action: corretorIds.length > 0 ? 'lead.bulk_delete_by_concessionaria' : 'lead.bulk_delete_all',
      entity_type: 'leads',
      entity_id: corretorIds.length > 0 ? corretorIds.join(',') : 'all',
      metadata: {
        deleted_count: count || 0,
        corretor_ids: corretorIds,
        concessionaria: scopeNome || null,
      },
    });

    return NextResponse.json({ success: true, deleted: count || 0, concessionaria: scopeNome || null });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro ao remover todos os leads.' }, { status: 500 });
  }
}
