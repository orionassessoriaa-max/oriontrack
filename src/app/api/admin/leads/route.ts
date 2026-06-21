import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';
import { rateLimit, writeAuditLog } from '@/lib/api/security';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

const ACTIVE_PROFILE_STATUSES = ['active', 'ativo', 'Ativo'];

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

  if (!profile || !['admin', 'corretor_admin'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

async function getCorretorScopeForProfile(profile: any, requestedCorretorId: string) {
  if (profile.tipo_usuario === 'admin') {
    if (!requestedCorretorId) return { error: 'Selecione um corretor.' };
    return { corretorId: requestedCorretorId, corretorIds: [requestedCorretorId] };
  }

  const ownCorretorId = profile.corretor_id;
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
      .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro'])
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
    responsibleName ? `Novo lead criado para ${responsibleName}.` : 'Novo lead criado manualmente.',
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

    const responsibleResult = await resolveResponsibleMember(corretorId, scope.corretorIds, String(body.responsavel_membro_id || ''));
    if ('error' in responsibleResult) return NextResponse.json({ error: responsibleResult.error }, { status: 400 });
    const responsibleMember = responsibleResult.member;

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert([{
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
        responsavel_membro_id: responsibleMember?.id || null,
        responsavel_profile_id: responsibleMember?.profile_id || null,
        status: normalizeLeadStatus(body.status || 'Aguardando atendimento'),
        data_entrada: body.data_entrada ? new Date(body.data_entrada).toISOString() : new Date().toISOString(),
      }])
      .select('*, responsavel_membro:responsavel_membro_id(nome,email)')
      .single();

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
          titulo: 'Novo lead atribuido',
          mensagem: message,
          destinatario_profile_id: responsibleProfile.id,
          remetente_profile_id: guard.profile.id,
          lida: false,
        }]);

        try {
          await sendApoloWhatsApp({
            type: 'novo_lead',
            title: 'Novo lead atribuido',
            message,
            profiles: [responsibleProfile],
          });
        } catch (waErr) {
          console.error('[Manual lead] Failed sending WA notification:', waErr);
        }
      }
    }

    return NextResponse.json({ ok: true, lead_id: data.id, lead: data });
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
