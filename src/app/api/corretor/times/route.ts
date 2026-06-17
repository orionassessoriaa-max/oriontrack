import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateStrongPassword } from '@/lib/users';
import { PUBLIC_LOGIN_URL } from '@/lib/publicUrl';
import { writeAuditLog } from '@/lib/api/security';
import type { UserRole } from '@/types';

type GuardProfile = {
  id: string;
  tipo_usuario: UserRole;
  corretor_id: string | null;
  email: string | null;
  email_real: string | null;
  nome: string | null;
  status: string | null;
};

const DEFAULT_LEAD_NOTIFICATION_MODE = 'responsavel_e_admin_se_integrante';
const LEAD_NOTIFICATION_MODES = ['responsavel_apenas', 'responsavel_e_admin_se_integrante', 'responsavel_e_admins'];
const ACTIVE_PROFILE_STATUSES = ['active', 'ativo', 'Ativo'];

function normalizeLeadNotificationMode(value: unknown) {
  const mode = String(value || '').trim();
  return LEAD_NOTIFICATION_MODES.includes(mode) ? mode : DEFAULT_LEAD_NOTIFICATION_MODE;
}

async function requireUser(request: Request) {
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
    .select('id, tipo_usuario, corretor_id, email, email_real, nome, status')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['admin', 'corretor', 'corretor_admin'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile: profile as GuardProfile };
}

async function resolveProfileCorretorId(profile: GuardProfile) {
  if (profile.corretor_id) return profile.corretor_id;

  const emails = [profile.email, profile.email_real]
    .filter(Boolean)
    .map((email) => String(email).trim().toLowerCase());

  if (emails.length === 0) return null;

  const { data: corretor } = await supabaseAdmin
    .from('corretores')
    .select('id')
    .or(emails.map((email) => `email.eq.${email},email_real.eq.${email}`).join(','))
    .maybeSingle();

  if (!corretor?.id) return null;

  await supabaseAdmin
    .from('profiles')
    .update({ corretor_id: corretor.id })
    .eq('id', profile.id);

  return corretor.id;
}

async function getRequestedCorretorId(request: Request, profile: GuardProfile, body?: any) {
  const url = new URL(request.url);
  const requested = String(body?.corretor_id || url.searchParams.get('corretor_id') || '').trim();

  if (profile.tipo_usuario === 'admin') return requested || null;
  return resolveProfileCorretorId(profile);
}

async function ensureTeam(corretorId: string, nome = 'Time comercial') {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('corretor_times')
    .select('*')
    .eq('corretor_id', corretorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('corretor_times')
    .insert([{ corretor_id: corretorId, nome }])
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function getCorretorIdentity(corretorId: string) {
  const { data } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, rodizio_ativo, created_at')
    .eq('id', corretorId)
    .maybeSingle();

  return data;
}

async function getCorretorScope(corretor: any) {
  const brokerageName = String(corretor?.nome_empresa || '').trim();
  if (!brokerageName) {
    return {
      primaryCorretorId: corretor.id,
      corretorIds: [corretor.id],
      brokerageName: '',
      primaryCorretor: corretor,
    };
  }

  const { data: brokerageCorretores } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, rodizio_ativo, created_at')
    .eq('nome_empresa', brokerageName)
    .order('created_at', { ascending: true });

  const corretores = brokerageCorretores && brokerageCorretores.length > 0 ? brokerageCorretores : [corretor];
  const primaryCorretor = corretores[0] || corretor;

  return {
    primaryCorretorId: primaryCorretor.id,
    corretorIds: corretores.map((item) => item.id),
    brokerageName,
    primaryCorretor,
  };
}

async function getOwnerProfiles(corretorIds: string[]) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real')
    .in('tipo_usuario', ['corretor', 'corretor_admin'])
    .in('corretor_id', corretorIds)
    .in('status', ACTIVE_PROFILE_STATUSES);

  return data || [];
}

async function getAssignableProfiles(corretorIds: string[]) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id')
    .in('corretor_id', corretorIds)
    .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro'])
    .in('status', ACTIVE_PROFILE_STATUSES);

  return data || [];
}

async function getTeamLeads(corretorIds: string[]) {
  const pageSize = 1000;
  let page = 0;
  let results: any[] = [];

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, nome, telefone, status, cidade, investimento, valor_negociacao, valor_venda, valor_comissao, responsavel_membro_id, responsavel_profile_id, data_entrada, updated_at')
      .in('corretor_id', corretorIds)
      .order('data_entrada', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw error;

    const batch = data || [];
    results = results.concat(batch);
    if (batch.length < pageSize) break;
    page += 1;
  }

  return results;
}

export async function GET(request: Request) {
  try {
    const guard = await requireUser(request);
    if ('error' in guard) return guard.error;

    const requestedCorretorId = await getRequestedCorretorId(request, guard.profile);
    if (!requestedCorretorId) {
      return NextResponse.json({ error: 'Corretor nao informado.' }, { status: 400 });
    }

    const requestedIdentity = await getCorretorIdentity(requestedCorretorId);
    if (!requestedIdentity) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    const scope = await getCorretorScope(requestedIdentity);
    const corretorId = scope.primaryCorretorId;
    const corretorIdentity = scope.primaryCorretor;

    const [teamRes] = await Promise.all([
      supabaseAdmin
        .from('corretor_times')
        .select('*')
        .eq('corretor_id', corretorId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    const { data: team, error: teamError } = teamRes;
    const brokerageName = scope.brokerageName;

    if (teamError) throw teamError;

    if (!team) {
      const [ownerProfiles, assignableProfiles] = await Promise.all([
        getOwnerProfiles(scope.corretorIds),
        getAssignableProfiles(scope.corretorIds),
      ]);
      const membros = assignableProfiles.map((profile: any, index: number) => ({
        id: `profile:${profile.id}`,
        time_id: null,
        corretor_id: profile.corretor_id || corretorId,
        profile_id: profile.id,
        nome: profile.nome,
        email: profile.email_real || profile.email,
        status: 'ativo',
        ordem: index + 1,
        ultimo_lead_at: null,
        participa_rodizio: false,
        created_at: null,
        foto_url: null,
        tipo_usuario: profile.tipo_usuario,
      }));

      return NextResponse.json({
        team: null,
        brokerage_name: brokerageName || null,
        membros,
        leads: [],
        settings: {
          owner_in_distribution: false,
          owner_profiles: ownerProfiles,
          owner_profile: ownerProfiles[0] || null,
          rodizio_ativo: corretorIdentity?.rodizio_ativo !== false,
          notificacao_novo_lead_modo: DEFAULT_LEAD_NOTIFICATION_MODE,
        },
      });
    }

    const { data: membros, error: membersError } = await supabaseAdmin
      .from('corretor_time_membros')
      .select('id, time_id, corretor_id, profile_id, nome, email, status, ordem, ultimo_lead_at, participa_rodizio, created_at, profiles:profile_id(foto_url, tipo_usuario)')
      .eq('time_id', team.id)
      .order('ordem', { ascending: true })
      .order('created_at', { ascending: true });

    if (membersError) throw membersError;

    const leads = await getTeamLeads(scope.corretorIds);

    const [ownerProfiles, assignableProfiles] = await Promise.all([
      getOwnerProfiles(scope.corretorIds),
      getAssignableProfiles(scope.corretorIds),
    ]);
    const ownerInDistribution = ownerProfiles.length > 0 && ownerProfiles.every((op) => 
      membros.some((m: any) => m.profile_id === op.id)
    );

    const membrosWithPhoto = (membros || []).map((m: any) => {
      const joinedProfile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return {
        id: m.id,
        time_id: m.time_id,
        corretor_id: m.corretor_id,
        profile_id: m.profile_id,
        nome: m.nome,
        email: m.email,
        status: m.status,
        ordem: m.ordem,
        ultimo_lead_at: m.ultimo_lead_at,
        participa_rodizio: m.participa_rodizio !== false,
        created_at: m.created_at,
        foto_url: joinedProfile?.foto_url || null,
        tipo_usuario: joinedProfile?.tipo_usuario || 'corretor_membro',
      };
    });

    const knownProfileIds = new Set(membrosWithPhoto.map((member: any) => member.profile_id).filter(Boolean));
    assignableProfiles.forEach((profile: any) => {
      if (knownProfileIds.has(profile.id)) return;
      membrosWithPhoto.push({
        id: `profile:${profile.id}`,
        time_id: team.id,
        corretor_id: corretorId,
        profile_id: profile.id,
        nome: profile.nome,
        email: profile.email_real || profile.email,
        status: 'ativo',
        ordem: 9999,
        ultimo_lead_at: null,
        participa_rodizio: false,
        created_at: null,
        foto_url: null,
        tipo_usuario: profile.tipo_usuario,
      });
    });

    return NextResponse.json({
      team,
      brokerage_name: brokerageName || team.nome || null,
      membros: membrosWithPhoto,
      leads,
      settings: {
        owner_in_distribution: ownerInDistribution,
        owner_profiles: ownerProfiles,
        owner_profile: ownerProfiles[0] || null,
        rodizio_ativo: corretorIdentity?.rodizio_ativo !== false,
        notificacao_novo_lead_modo: normalizeLeadNotificationMode(team.notificacao_novo_lead_modo),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar time.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireUser(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const action = String(body.action || 'create_member');
    const requestedCorretorId = await getRequestedCorretorId(request, guard.profile, body);
    if (!requestedCorretorId) {
      return NextResponse.json({ error: 'Corretor nao informado.' }, { status: 400 });
    }

    const requestedCorretor = await getCorretorIdentity(requestedCorretorId);

    if (!requestedCorretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    const scope = await getCorretorScope(requestedCorretor);
    const corretorId = scope.primaryCorretorId;
    const corretor = scope.primaryCorretor;

    if (action === 'create_team') {
      const brokerageName = String(corretor.nome_empresa || '').trim();
      const nome = brokerageName || String(body.nome || '').trim();
      if (!nome) return NextResponse.json({ error: 'Informe o nome do time.' }, { status: 400 });

      const team = await ensureTeam(corretorId, nome);

      await writeAuditLog(request, guard.profile, {
        action: 'team.create',
        entity_type: 'corretor_times',
        entity_id: team.id,
        metadata: { corretor_id: corretorId, nome },
      });

      return NextResponse.json({ success: true, team, brokerage_name: brokerageName || team.nome || null });
    }

    if (action === 'delete_team') {
      const { data: teamToDelete } = await supabaseAdmin
        .from('corretor_times')
        .select('id')
        .eq('corretor_id', corretorId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!teamToDelete) {
        return NextResponse.json({ error: 'Time nao encontrado.' }, { status: 404 });
      }

      // Fetch all members of this team
      const { data: members } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id, profiles:profile_id(id, tipo_usuario)')
        .eq('time_id', teamToDelete.id);

      if (members && members.length > 0) {
        // Dissociate leads first
        await supabaseAdmin
          .from('leads')
          .update({
            responsavel_membro_id: null,
            responsavel_profile_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('corretor_id', corretorId);

        // Delete each member and remove access if they are a regular member
        for (const m of members) {
          await supabaseAdmin
            .from('corretor_time_membros')
            .delete()
            .eq('id', m.id);

          const joinedProfile = Array.isArray((m as any).profiles) ? (m as any).profiles[0] : (m as any).profiles;
          const memberRole = joinedProfile?.tipo_usuario;
          const shouldRemoveAccess = m.profile_id && (memberRole === 'corretor_membro' || memberRole === 'corretor_admin');

          if (shouldRemoveAccess) {
            await supabaseAdmin
              .from('profiles')
              .delete()
              .eq('id', m.profile_id)
              .in('tipo_usuario', ['corretor_membro', 'corretor_admin']);

            const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(m.profile_id);
            if (authDeleteError && authDeleteError.message !== 'User not found') {
              console.error('team_member_auth_delete_failed_on_team_delete', authDeleteError.message);
            }
          } else if (m.profile_id && memberRole !== 'corretor') {
            await supabaseAdmin
              .from('profiles')
              .update({ status: 'inactive' })
              .eq('id', m.profile_id);
          }
        }
      }

      // Finally, delete the team itself
      const { error: deleteTeamError } = await supabaseAdmin
        .from('corretor_times')
        .delete()
        .eq('id', teamToDelete.id);

      if (deleteTeamError) throw deleteTeamError;

      await writeAuditLog(request, guard.profile, {
        action: 'team.delete',
        entity_type: 'corretor_times',
        entity_id: teamToDelete.id,
        metadata: { corretor_id: corretorId },
      });

      return NextResponse.json({ success: true });
    }

    const brokerageName = String(corretor.nome_empresa || '').trim();
    const team = await ensureTeam(corretorId, String(body.nome_time || brokerageName || 'Time comercial'));

    if (action === 'update_team_name') {
      const nome = String(body.nome || '').trim();
      if (!nome) return NextResponse.json({ error: 'Informe o nome do time.' }, { status: 400 });

      const { data, error } = await supabaseAdmin
        .from('corretor_times')
        .update({ nome })
        .eq('id', team.id)
        .select('*')
        .single();

      if (error) throw error;

      await writeAuditLog(request, guard.profile, {
        action: 'team.name.update',
        entity_type: 'corretor_times',
        entity_id: team.id,
        metadata: { corretor_id: corretorId, nome },
      });

      return NextResponse.json({ success: true, team: data });
    }

    if (action === 'toggle_distribution') {
      const active = Boolean(body.active);
      
      const { data, error } = await supabaseAdmin
        .from('corretor_times')
        .update({ ativo: active })
        .eq('id', team.id)
        .select('*')
        .single();

      if (error) throw error;

      const { error: brokerRotationError } = await supabaseAdmin
        .from('corretores')
        .update({ rodizio_ativo: active })
        .eq('id', corretorId);

      if (brokerRotationError) throw brokerRotationError;

      await writeAuditLog(request, guard.profile, {
        action: 'team.distribution.toggle',
        entity_type: 'corretor_times',
        entity_id: team.id,
        metadata: { corretor_id: corretorId, active },
      });

      return NextResponse.json({ success: true, team: data, settings: { rodizio_ativo: active } });
    }

    if (action === 'update_lead_notification_mode') {
      if (!['admin', 'corretor', 'corretor_admin'].includes(guard.profile.tipo_usuario)) {
        return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
      }

      const mode = normalizeLeadNotificationMode(body.mode);
      const { data, error } = await supabaseAdmin
        .from('corretor_times')
        .update({ notificacao_novo_lead_modo: mode })
        .eq('id', team.id)
        .select('*')
        .single();

      if (error) throw error;

      await writeAuditLog(request, guard.profile, {
        action: 'team.lead_notification_mode.update',
        entity_type: 'corretor_times',
        entity_id: team.id,
        metadata: { corretor_id: corretorId, mode },
      });

      return NextResponse.json({ success: true, team: data, settings: { notificacao_novo_lead_modo: mode } });
    }

    if (action === 'toggle_owner_member') {
      if (!['admin', 'corretor'].includes(guard.profile.tipo_usuario)) {
        return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
      }

      const includeOwner = Boolean(body.include_owner);
      const ownerProfiles = await getOwnerProfiles(scope.corretorIds);
      if (ownerProfiles.length === 0) {
        return NextResponse.json({ error: 'Nao encontrei o acesso principal desse corretor.' }, { status: 404 });
      }

      // Fetch existing owner members of this team
      const ownerProfileIds = ownerProfiles.map((op) => op.id);
      const { data: existingOwnerMembers } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id')
        .eq('time_id', team.id)
        .in('profile_id', ownerProfileIds);

      const existingMap = new Map((existingOwnerMembers || []).map((m) => [m.profile_id, m.id]));

      if (includeOwner) {
        // Get the last order number
        const { data: lastMember } = await supabaseAdmin
          .from('corretor_time_membros')
          .select('ordem')
          .eq('time_id', team.id)
          .order('ordem', { ascending: false })
          .limit(1)
          .maybeSingle();

        let currentOrdem = Number(lastMember?.ordem || 0);
        const inserts = [];

        for (const op of ownerProfiles) {
          if (!existingMap.has(op.id)) {
            currentOrdem += 1;
            inserts.push({
              time_id: team.id,
              corretor_id: corretorId,
              profile_id: op.id,
              nome: op.nome || corretor.nome,
              email: op.email_real || op.email,
              participa_rodizio: true,
              ordem: currentOrdem,
            });
          }
        }

        if (inserts.length > 0) {
          const { error: insertError } = await supabaseAdmin
            .from('corretor_time_membros')
            .insert(inserts);

          if (insertError) throw insertError;
        }
      } else {
        // Remove all owners from distribution
        const idsToRemove = Array.from(existingMap.values());
        if (idsToRemove.length > 0) {
          // Unassign leads from these members first
          await supabaseAdmin
            .from('leads')
            .update({ responsavel_membro_id: null, responsavel_profile_id: null })
            .eq('corretor_id', corretorId)
            .in('responsavel_membro_id', idsToRemove);

          const { error: deleteError } = await supabaseAdmin
            .from('corretor_time_membros')
            .delete()
            .in('id', idsToRemove);

          if (deleteError) throw deleteError;
        }
      }

      await writeAuditLog(request, guard.profile, {
        action: 'team.owner.toggle',
        entity_type: 'corretor_times',
        entity_id: team.id,
        metadata: { corretor_id: corretorId, include_owner: includeOwner },
      });

      return NextResponse.json({ success: true });
    }

    if (action === 'delete_member') {
      const memberId = String(body.member_id || '').trim();
      if (!memberId) return NextResponse.json({ error: 'Membro nao informado.' }, { status: 400 });

      const { data: member } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id, nome, email, profiles:profile_id(id, tipo_usuario, email, email_real, nome)')
        .eq('id', memberId)
        .eq('corretor_id', corretorId)
        .maybeSingle();

      if (!member) return NextResponse.json({ error: 'Membro nao encontrado.' }, { status: 404 });

      await supabaseAdmin
        .from('leads')
        .update({
          responsavel_membro_id: null,
          responsavel_profile_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('corretor_id', corretorId)
        .eq('responsavel_membro_id', memberId);

      await supabaseAdmin
        .from('corretor_time_membros')
        .delete()
        .eq('id', memberId);

      const joinedProfile = Array.isArray((member as any).profiles) ? (member as any).profiles[0] : (member as any).profiles;
      const memberRole = joinedProfile?.tipo_usuario;
      const shouldRemoveAccess = member.profile_id && (memberRole === 'corretor_membro' || memberRole === 'corretor_admin');

      if (shouldRemoveAccess) {
        await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('id', member.profile_id)
          .in('tipo_usuario', ['corretor_membro', 'corretor_admin']);

        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(member.profile_id);
        if (authDeleteError && authDeleteError.message !== 'User not found') {
          console.error('team_member_auth_delete_failed', authDeleteError.message);
        }
      } else if (member.profile_id && memberRole !== 'corretor') {
        await supabaseAdmin
          .from('profiles')
          .update({ status: 'inactive' })
          .eq('id', member.profile_id);
      }

      await writeAuditLog(request, guard.profile, {
        action: 'team.member.delete',
        entity_type: 'corretor_time_membro',
        entity_id: memberId,
        metadata: {
          corretor_id: corretorId,
          profile_id: member.profile_id,
          member_name: member.nome || joinedProfile?.nome,
          member_email: member.email || joinedProfile?.email_real || joinedProfile?.email,
          removed_access: Boolean(shouldRemoveAccess),
        },
      });

      return NextResponse.json({ success: true, member });
    }

    if (action === 'toggle_member_distribution') {
      if (!['admin', 'corretor', 'corretor_admin'].includes(guard.profile.tipo_usuario)) {
        return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
      }

      const memberId = String(body.member_id || '').trim();
      const participaRodizio = Boolean(body.participa_rodizio);
      if (!memberId) return NextResponse.json({ error: 'Membro nao informado.' }, { status: 400 });

      if (memberId.startsWith('profile:')) {
        return NextResponse.json({ error: 'Salve este perfil no time antes de alterar o rodizio.' }, { status: 400 });
      }

      const { data, error } = await supabaseAdmin
        .from('corretor_time_membros')
        .update({ participa_rodizio: participaRodizio })
        .eq('id', memberId)
        .eq('corretor_id', corretorId)
        .select('*')
        .single();

      if (error) throw error;

      await writeAuditLog(request, guard.profile, {
        action: 'team.member.rotation.toggle',
        entity_type: 'corretor_time_membro',
        entity_id: memberId,
        metadata: { corretor_id: corretorId, participa_rodizio: participaRodizio },
      });

      return NextResponse.json({ success: true, membro: data });
    }

    if (action === 'update_member') {
      const memberId = String(body.member_id || '').trim();
      const nome = String(body.nome || '').trim();
      const email = String(body.email || '').trim().toLowerCase();

      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!memberId || !nome || !emailRegex.test(email)) {
        return NextResponse.json({ error: 'Informe um email válido com extensão (ex: .com, .com.br).' }, { status: 400 });
      }

      const { data: member } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id, profiles:profile_id(tipo_usuario)')
        .eq('id', memberId)
        .eq('corretor_id', corretorId)
        .maybeSingle();

      if (!member) return NextResponse.json({ error: 'Membro nao encontrado.' }, { status: 404 });

      const { data, error } = await supabaseAdmin
        .from('corretor_time_membros')
        .update({ nome, email })
        .eq('id', memberId)
        .select('*')
        .single();

      if (error) throw error;

      if (member.profile_id) {
        const joinedProfile = Array.isArray((member as any).profiles) ? (member as any).profiles[0] : (member as any).profiles;
        const currentRole = joinedProfile?.tipo_usuario || 'corretor_membro';
        const role = body.tipo_usuario === 'corretor_admin' ? 'corretor_admin' : (body.tipo_usuario === 'corretor_membro' ? 'corretor_membro' : currentRole);

        await supabaseAdmin
          .from('profiles')
          .update({ nome, email, email_real: email, tipo_usuario: role })
          .eq('id', member.profile_id);

        await supabaseAdmin.auth.admin.updateUserById(member.profile_id, {
          email,
          email_confirm: true,
          user_metadata: { nome, email_real: email, tipo_usuario: role }
        });
      }

      await writeAuditLog(request, guard.profile, {
        action: 'team.member.update',
        entity_type: 'corretor_time_membro',
        entity_id: memberId,
        metadata: { corretor_id: corretorId, profile_id: member.profile_id, nome, email },
      });

      return NextResponse.json({ success: true, membro: data });
    }

    if (action === 'assign_lead') {
      if (!['admin', 'corretor', 'corretor_admin'].includes(guard.profile.tipo_usuario)) {
        return NextResponse.json({ error: 'Apenas admins do time podem enviar leads.' }, { status: 403 });
      }

      const leadId = String(body.lead_id || '').trim();
      const memberId = String(body.member_id || '').trim();
      if (!leadId) {
        return NextResponse.json({ error: 'Selecione o lead.' }, { status: 400 });
      }

      // Handle unassigning lead (releasing it back to the shared/unowned queue)
      if (memberId === 'unassigned' || !memberId) {
        const { error: updateError } = await supabaseAdmin
          .from('leads')
          .update({
            responsavel_membro_id: null,
            responsavel_profile_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', leadId)
          .in('corretor_id', scope.corretorIds);

        if (updateError) throw updateError;

        await writeAuditLog(request, guard.profile, {
          action: 'team.lead.unassign',
          entity_type: 'lead',
          entity_id: leadId,
          metadata: { corretor_id: corretorId },
        });

        return NextResponse.json({ success: true, unassigned: true });
      }

      let resolvedMemberId = memberId;

      if (memberId.startsWith('profile:')) {
        const profileId = memberId.replace('profile:', '').trim();
        const { data: assignableProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, nome, email, email_real')
          .eq('id', profileId)
          .in('corretor_id', scope.corretorIds)
          .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro'])
          .in('status', ACTIVE_PROFILE_STATUSES)
          .maybeSingle();

        if (!assignableProfile) return NextResponse.json({ error: 'Responsavel nao encontrado nesta conta.' }, { status: 404 });

        const { data: existingMember } = await supabaseAdmin
          .from('corretor_time_membros')
          .select('id')
          .eq('time_id', team.id)
          .eq('profile_id', profileId)
          .maybeSingle();

        if (existingMember?.id) {
          resolvedMemberId = existingMember.id;
        } else {
          const { data: lastMember } = await supabaseAdmin
            .from('corretor_time_membros')
            .select('ordem')
            .eq('time_id', team.id)
            .order('ordem', { ascending: false })
            .limit(1)
            .maybeSingle();

          const { data: createdMember, error: createMemberError } = await supabaseAdmin
            .from('corretor_time_membros')
            .insert([{
              time_id: team.id,
              corretor_id: corretorId,
              profile_id: profileId,
              nome: assignableProfile.nome,
              email: assignableProfile.email_real || assignableProfile.email,
              status: 'ativo',
              participa_rodizio: true,
              ordem: Number(lastMember?.ordem || 0) + 1,
            }])
            .select('id')
            .single();

          if (createMemberError) throw createMemberError;
          resolvedMemberId = createdMember.id;
        }
      }

      const { data: member } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id, nome, email')
        .eq('id', resolvedMemberId)
        .eq('corretor_id', corretorId)
        .in('status', ['active', 'ativo'])
        .maybeSingle();

      if (!member) return NextResponse.json({ error: 'Integrante nao encontrado.' }, { status: 404 });

      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('id', leadId)
        .in('corretor_id', scope.corretorIds)
        .maybeSingle();

      if (!lead) return NextResponse.json({ error: 'Lead nao encontrado para este corretor.' }, { status: 404 });

      const { error: updateError } = await supabaseAdmin
        .from('leads')
        .update({
          responsavel_membro_id: member.id,
          responsavel_profile_id: member.profile_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', leadId)
        .in('corretor_id', scope.corretorIds);

      if (updateError) throw updateError;

      await supabaseAdmin
        .from('corretor_time_membros')
        .update({ ultimo_lead_at: new Date().toISOString() })
        .eq('id', member.id);

      await writeAuditLog(request, guard.profile, {
        action: 'team.lead.assign',
        entity_type: 'lead',
        entity_id: leadId,
        metadata: { member_id: member.id, corretor_id: corretorId },
      });

      return NextResponse.json({ success: true });
    }

    const nome = String(body.nome || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!nome || !emailRegex.test(email)) {
      return NextResponse.json({ error: 'Informe um email válido com extensão (ex: .com, .com.br).' }, { status: 400 });
    }

    const { data: duplicated } = await supabaseAdmin
      .from('corretor_time_membros')
      .select('id')
      .eq('corretor_id', corretorId)
      .eq('email', email)
      .maybeSingle();

    if (duplicated) {
      return NextResponse.json({ error: 'Este email ja esta no time desse corretor.' }, { status: 400 });
    }

    const role = body.tipo_usuario === 'corretor_admin' ? 'corretor_admin' : 'corretor_membro';
    const memberBrokerageName = String(corretor.nome_empresa || '').trim();
    const senhaProvisoria = generateStrongPassword();
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senhaProvisoria,
      email_confirm: true,
      user_metadata: {
        nome,
        tipo_usuario: role,
        corretor_id: corretorId,
        nome_empresa: memberBrokerageName || null,
        email_real: email,
      }
    });

    if (authError || !authUser.user) {
      return NextResponse.json({ error: authError?.message || 'Erro ao criar acesso.' }, { status: 400 });
    }

    try {
      const { data: lastMember } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('ordem')
        .eq('time_id', team.id)
        .order('ordem', { ascending: false })
        .limit(1)
        .maybeSingle();

      const ordem = Number(lastMember?.ordem || 0) + 1;

      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert([{
          id: authUser.user.id,
          email,
          email_real: email,
          nome,
          tipo_usuario: role,
          corretor_id: corretorId,
          nome_empresa: memberBrokerageName || null,
          status: 'active',
          precisa_trocar_senha: true,
        }]);

      if (profileError) throw profileError;

      const { data: membro, error: memberError } = await supabaseAdmin
        .from('corretor_time_membros')
        .insert([{
          time_id: team.id,
          corretor_id: corretorId,
          profile_id: authUser.user.id,
          nome,
          email,
          ordem,
          participa_rodizio: true,
        }])
        .select('*')
        .single();

      if (memberError) throw memberError;

      await writeAuditLog(request, guard.profile, {
        action: 'team.member.create',
        entity_type: 'corretor_time_membro',
        entity_id: membro.id,
        metadata: { corretor_id: corretorId, email },
      });

      return NextResponse.json({
        success: true,
        membro,
        credentials: {
          email,
          senha_provisoria: senhaProvisoria,
          link_login: PUBLIC_LOGIN_URL,
        },
      });
    } catch (error: any) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ error: error.message || 'Erro ao criar membro.' }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao atualizar time.' }, { status: 500 });
  }
}
