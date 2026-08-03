import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { getGestorConcessionariaNames, isGestorLinkedToConcessionariaCorretor, normalizeAccessText } from '@/lib/gestorAccess';
import {
  normalizeLeadDistributionAudience,
  normalizeLeadDistributionModel,
} from '@/lib/leadDistribution';

function normalizeName(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeOperationMode(value: unknown) {
  const mode = String(value || '').trim();
  return ['individual', 'grupo_rodizio', 'grupo_rodizio_admin'].includes(mode)
    ? mode
    : 'individual';
}

function normalizeOperationalTeam(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((member) => ({
      nome: normalizeName(member?.nome),
      cargo: normalizeName(member?.cargo),
      profile_id: normalizeName(member?.profile_id) || undefined,
      foto_url: normalizeName(member?.foto_url) || null,
      tipo_usuario: normalizeName(member?.tipo_usuario) || undefined,
      email: normalizeName(member?.email) || null,
      email_real: normalizeName(member?.email_real) || null,
      is_admin_master: Boolean(member?.is_admin_master),
    }))
    .filter((member) => member.nome && member.cargo);
}

function resolveTrafficManagerId(explicitId: unknown, team: ReturnType<typeof normalizeOperationalTeam>) {
  const directId = normalizeName(explicitId);
  if (directId) return directId;
  const manager = team.find((member) =>
    member.tipo_usuario === 'gestor_trafego' ||
    member.cargo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('trafego')
  );
  return manager?.profile_id || null;
}

function isMissingCorretorasTable(error?: { message?: string | null } | null) {
  return /corretoras|schema cache|does not exist|could not find/i.test(String(error?.message || ''));
}

async function syncBrokerageDistribution(
  brokerageName: string,
  participantProfileIds: string[],
) {
  const normalizedName = normalizeName(brokerageName);
  if (!normalizedName) return;

  const { data: brokers, error: brokersError } = await supabaseAdmin
    .from('corretores')
    .select('id, created_at')
    .ilike('nome_empresa', normalizedName)
    .order('created_at', { ascending: true });
  if (brokersError) throw brokersError;
  if (!brokers?.length) return;

  const brokerIds = brokers.map((broker) => broker.id);
  const primaryBrokerId = brokerIds[0];
  await supabaseAdmin.from('corretores').update({ rodizio_ativo: true }).in('id', brokerIds);

  const { data: existingTeam, error: teamLookupError } = await supabaseAdmin
    .from('corretor_times')
    .select('id')
    .in('corretor_id', brokerIds)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (teamLookupError) throw teamLookupError;

  let teamId = existingTeam?.id || null;
  if (!teamId) {
    const { data: createdTeam, error: createTeamError } = await supabaseAdmin
      .from('corretor_times')
      .insert({
        corretor_id: primaryBrokerId,
        nome: normalizedName,
        ativo: true,
        notificacao_novo_lead_modo: 'responsavel_e_admins',
      })
      .select('id')
      .single();
    if (createTeamError) throw createTeamError;
    teamId = createdTeam.id;
  } else {
    await supabaseAdmin
      .from('corretor_times')
      .update({ ativo: true, notificacao_novo_lead_modo: 'responsavel_e_admins' })
      .eq('id', teamId);
  }

  const { data: brokerageProfiles, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, corretor_id, tipo_usuario')
    .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro'])
    .or(`corretor_id.in.(${brokerIds.join(',')}),nome_empresa.ilike.${normalizedName}`)
    .in('status', ['active', 'ativo', 'Ativo']);
  if (profileError) throw profileError;

  const participantSet = new Set(participantProfileIds.filter(Boolean));
  const { data: currentMembers, error: memberLookupError } = await supabaseAdmin
    .from('corretor_time_membros')
    .select('id, profile_id, ordem')
    .eq('time_id', teamId);
  if (memberLookupError) throw memberLookupError;
  const byProfile = new Map((currentMembers || []).map((member) => [member.profile_id, member]));
  let nextOrder = Math.max(0, ...(currentMembers || []).map((member) => Number(member.ordem || 0))) + 1;

  for (const profile of brokerageProfiles || []) {
    const participates = participantSet.has(profile.id);
    const existing = byProfile.get(profile.id);
    if (existing) {
      const { error } = await supabaseAdmin.from('corretor_time_membros').update({
        participa_rodizio: participates,
        status: 'ativo',
        nome: profile.nome,
        email: profile.email_real || profile.email,
      }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from('corretor_time_membros').insert({
        time_id: teamId,
        corretor_id: profile.corretor_id || primaryBrokerId,
        profile_id: profile.id,
        nome: profile.nome,
        email: profile.email_real || profile.email,
        status: 'ativo',
        ordem: nextOrder++,
        participa_rodizio: participates,
      });
      if (error) throw error;
    }

    const { data: preference } = await supabaseAdmin
      .from('notificacao_preferencias')
      .select('tipos, whatsapp_enabled, telefone')
      .eq('profile_id', profile.id)
      .maybeSingle();
    await supabaseAdmin.from('notificacao_preferencias').upsert({
      profile_id: profile.id,
      whatsapp_enabled: participates ? true : Boolean(preference?.whatsapp_enabled),
      telefone: preference?.telefone || null,
      tipos: { ...(preference?.tipos || {}), novo_lead: participates },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id' });
  }
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
    if ('error' in guard) return guard.error;

    const { data, error } = await supabaseAdmin
      .from('corretoras')
      .select('*')
      .order('nome', { ascending: true });

    if (error) {
      if (isMissingCorretorasTable(error)) {
        return NextResponse.json({ corretoras: [], migration_pending: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (guard.profile.tipo_usuario === 'gestor_trafego') {
      const { data: gestor } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, email_real')
        .eq('id', guard.profile.id)
        .maybeSingle();

      const { data: corretoresData, error: corretoresError } = await supabaseAdmin
        .from('corretores')
        .select('gestor_trafego_id, time_operacional, nome_empresa')
        .in('status', ['active', 'ativo', 'Ativo']);

      if (corretoresError) {
        return NextResponse.json({ error: corretoresError.message }, { status: 500 });
      }

      const linkedCorretores = (corretoresData || []).filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, gestor));
      const concessionariaNames = getGestorConcessionariaNames(linkedCorretores, gestor);
      const corretoras = (data || []).filter((corretora) => concessionariaNames.has(normalizeAccessText(corretora.nome)));

      return NextResponse.json({ corretoras });
    }

    return NextResponse.json({ corretoras: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao listar concessionarias.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:corretoras:create', { limit: 30, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const nome = normalizeName(body.nome);
    const descricao = normalizeName(body.descricao) || null;
    const modo_operacao = normalizeOperationMode(body.modo_operacao);
    const distribuicao_modelo = normalizeLeadDistributionModel(body.distribuicao_modelo);
    const distribuicao_publico = normalizeLeadDistributionAudience(body.distribuicao_publico);
    const distribuicao_regras = (Array.isArray(body.distribuicao_regras) ? body.distribuicao_regras : []).slice(0, 12).map((rule: any, index: number) => ({
      id: normalizeName(rule?.id) || `regra-${index + 1}`,
      nome: normalizeName(rule?.nome) || `Regra ${index + 1}`,
      termos: Array.from(new Set((Array.isArray(rule?.termos) ? rule.termos : []).map(normalizeName).filter(Boolean))).slice(0, 30),
      fallback: rule?.fallback === true,
      ativo: rule?.ativo !== false,
      prioridade: index + 1,
      membros: [],
    }));
    const time_operacional = normalizeOperationalTeam(body.time_operacional);
    const gestor_trafego_id = resolveTrafficManagerId(body.gestor_trafego_id, time_operacional);

    if (!nome) {
      return NextResponse.json({ error: 'Informe o nome da concessionaria.' }, { status: 400 });
    }

    if (gestor_trafego_id) {
      const { data: gestor, error: gestorError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', gestor_trafego_id)
        .eq('tipo_usuario', 'gestor_trafego')
        .in('status', ['active', 'ativo', 'Ativo'])
        .maybeSingle();
      if (gestorError) throw gestorError;
      if (!gestor) {
        return NextResponse.json({ error: 'O gestor de trafego selecionado nao esta ativo.' }, { status: 400 });
      }
    }

    const { data: existing } = await supabaseAdmin
      .from('corretoras')
      .select('*')
      .ilike('nome', nome)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, corretora: existing, already_exists: true });
    }

    const { data, error } = await supabaseAdmin
      .from('corretoras')
      .insert([{
        nome,
        descricao,
        status: 'ativo',
        modo_operacao,
        distribuicao_modelo,
        distribuicao_publico,
        distribuicao_regras,
        time_operacional,
        gestor_trafego_id,
        created_by: guard.profile.id,
      }])
      .select('*')
      .single();

    if (error) {
      if (isMissingCorretorasTable(error)) {
        return NextResponse.json({
          error: 'A migration de concessionarias ainda nao foi aplicada no Supabase.',
          migration_pending: true,
        }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'corretora.create',
      entity_type: 'corretoras',
      entity_id: data.id,
      metadata: { nome, gestor_trafego_id, time_operacional },
    });

    return NextResponse.json({ success: true, corretora: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao criar concessionaria.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:corretoras:update', { limit: 60, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const id = normalizeName(body.id);
    const modo_operacao = normalizeOperationMode(body.modo_operacao);
    const distribuicao_modelo = normalizeLeadDistributionModel(body.distribuicao_modelo);
    const distribuicao_publico = normalizeLeadDistributionAudience(body.distribuicao_publico);
    const participantes = Array.isArray(body.participantes_profile_ids)
      ? body.participantes_profile_ids.map(normalizeName).filter(Boolean)
      : null;

    if (!id) {
      return NextResponse.json({ error: 'Informe a concessionaria.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('corretoras')
      .update({ modo_operacao, distribuicao_modelo, distribuicao_publico })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (isMissingCorretorasTable(error)) {
        return NextResponse.json({
          error: 'A migration de concessionarias ainda nao foi aplicada no Supabase.',
          migration_pending: true,
        }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('corretores')
      .update({ rodizio_ativo: true })
      .ilike('nome_empresa', data.nome);

    if (participantes) {
      await syncBrokerageDistribution(data.nome, participantes);
    }

    await writeAuditLog(request, guard.profile, {
      action: 'corretora.distribution.update',
      entity_type: 'corretoras',
      entity_id: data.id,
      metadata: { nome: data.nome, modo_operacao, distribuicao_modelo, distribuicao_publico, participantes },
    });

    return NextResponse.json({ success: true, corretora: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao atualizar concessionaria.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:corretoras:delete', { limit: 30, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const { searchParams } = new URL(request.url);
    const id = normalizeName(searchParams.get('id'));
    if (!id) {
      return NextResponse.json({ error: 'Informe a concessionaria.' }, { status: 400 });
    }

    const { data: corretora, error: corretoraError } = await supabaseAdmin
      .from('corretoras')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (corretoraError) {
      if (isMissingCorretorasTable(corretoraError)) {
        return NextResponse.json({
          error: 'A migration de concessionarias ainda nao foi aplicada no Supabase.',
          migration_pending: true,
        }, { status: 500 });
      }
      return NextResponse.json({ error: corretoraError.message }, { status: 500 });
    }

    if (!corretora) {
      return NextResponse.json({ error: 'Concessionaria nao encontrada.' }, { status: 404 });
    }

    const nome = normalizeName(corretora.nome);
    const [{ count: corretoresCount, error: corretoresError }, { count: profilesCount, error: profilesError }] = await Promise.all([
      supabaseAdmin
        .from('corretores')
        .select('id', { count: 'exact', head: true })
        .eq('nome_empresa', nome),
      supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('nome_empresa', nome),
    ]);

    if (corretoresError) return NextResponse.json({ error: corretoresError.message }, { status: 500 });
    if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

    if ((corretoresCount || 0) > 0 || (profilesCount || 0) > 0) {
      return NextResponse.json({
        error: 'Esta concessionaria possui corretores vinculados. Remova ou mova os corretores antes de excluir.',
      }, { status: 409 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('corretoras')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'corretora.delete',
      entity_type: 'corretoras',
      entity_id: id,
      metadata: { nome },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao excluir concessionaria.' }, { status: 500 });
  }
}
