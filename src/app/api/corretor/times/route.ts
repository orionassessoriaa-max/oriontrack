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

  if (!profile || !['admin', 'corretor'].includes(profile.tipo_usuario)) {
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
    .eq('ativo', true)
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

async function getOwnerProfile(corretorId: string) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real')
    .eq('tipo_usuario', 'corretor')
    .eq('corretor_id', corretorId)
    .eq('status', 'active')
    .maybeSingle();

  return data;
}

export async function GET(request: Request) {
  try {
    const guard = await requireUser(request);
    if ('error' in guard) return guard.error;

    const corretorId = await getRequestedCorretorId(request, guard.profile);
    if (!corretorId) {
      return NextResponse.json({ error: 'Corretor nao informado.' }, { status: 400 });
    }

    const team = await ensureTeam(corretorId);

    const { data: membros, error: membersError } = await supabaseAdmin
      .from('corretor_time_membros')
      .select('id, time_id, corretor_id, profile_id, nome, email, status, ordem, ultimo_lead_at, created_at')
      .eq('time_id', team.id)
      .order('ordem', { ascending: true })
      .order('created_at', { ascending: true });

    if (membersError) throw membersError;

    let leads: any[] = [];
    if (guard.profile.tipo_usuario === 'corretor') {
      const { data: leadsData, error: leadsError } = await supabaseAdmin
        .from('leads')
        .select('id, nome, telefone, status, cidade, investimento, valor_negociacao, valor_venda, valor_comissao, responsavel_membro_id, data_entrada, updated_at')
        .eq('corretor_id', corretorId)
        .order('data_entrada', { ascending: false })
        .limit(1000);

      if (leadsError) throw leadsError;
      leads = leadsData || [];
    }

    const ownerProfile = await getOwnerProfile(corretorId);
    const ownerMember = (membros || []).find((member: any) => member.profile_id === ownerProfile?.id);

    return NextResponse.json({
      team,
      membros: membros || [],
      leads,
      settings: {
        owner_in_distribution: Boolean(ownerMember),
        owner_profile: ownerProfile || null,
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
    const corretorId = await getRequestedCorretorId(request, guard.profile, body);
    if (!corretorId) {
      return NextResponse.json({ error: 'Corretor nao informado.' }, { status: 400 });
    }

    const { data: corretor } = await supabaseAdmin
      .from('corretores')
      .select('id, nome')
      .eq('id', corretorId)
      .maybeSingle();

    if (!corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    const team = await ensureTeam(corretorId, String(body.nome_time || 'Time comercial'));

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
      return NextResponse.json({ success: true, team: data });
    }

    if (action === 'toggle_owner_member') {
      if (!['admin', 'corretor'].includes(guard.profile.tipo_usuario)) {
        return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
      }

      const includeOwner = Boolean(body.include_owner);
      const ownerProfile = await getOwnerProfile(corretorId);
      if (!ownerProfile?.id) {
        return NextResponse.json({ error: 'Nao encontrei o acesso principal desse corretor.' }, { status: 404 });
      }

      const { data: existingOwnerMember } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id')
        .eq('time_id', team.id)
        .eq('profile_id', ownerProfile.id)
        .maybeSingle();

      if (includeOwner && !existingOwnerMember) {
        const { data: lastMember } = await supabaseAdmin
          .from('corretor_time_membros')
          .select('ordem')
          .eq('time_id', team.id)
          .order('ordem', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { error: insertError } = await supabaseAdmin
          .from('corretor_time_membros')
          .insert([{
            time_id: team.id,
            corretor_id: corretorId,
            profile_id: ownerProfile.id,
            nome: ownerProfile.nome || corretor.nome,
            email: ownerProfile.email_real || ownerProfile.email,
            ordem: Number(lastMember?.ordem || 0) + 1,
          }]);

        if (insertError) throw insertError;
      }

      if (!includeOwner && existingOwnerMember?.id) {
        await supabaseAdmin
          .from('leads')
          .update({ responsavel_membro_id: null, responsavel_profile_id: null })
          .eq('corretor_id', corretorId)
          .eq('responsavel_membro_id', existingOwnerMember.id);

        const { error: deleteError } = await supabaseAdmin
          .from('corretor_time_membros')
          .delete()
          .eq('id', existingOwnerMember.id);

        if (deleteError) throw deleteError;
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
        .select('id, profile_id, profiles:profile_id(tipo_usuario)')
        .eq('id', memberId)
        .eq('corretor_id', corretorId)
        .maybeSingle();

      if (!member) return NextResponse.json({ error: 'Membro nao encontrado.' }, { status: 404 });

      await supabaseAdmin
        .from('corretor_time_membros')
        .delete()
        .eq('id', memberId);

      const memberRole = Array.isArray((member as any).profiles) ? (member as any).profiles[0]?.tipo_usuario : (member as any).profiles?.tipo_usuario;

      if (member.profile_id && memberRole !== 'corretor') {
        await supabaseAdmin
          .from('profiles')
          .update({ status: 'inactive' })
          .eq('id', member.profile_id);
      }

      return NextResponse.json({ success: true });
    }

    if (action === 'update_member') {
      const memberId = String(body.member_id || '').trim();
      const nome = String(body.nome || '').trim();
      const email = String(body.email || '').trim().toLowerCase();

      if (!memberId || !nome || !email.includes('@')) {
        return NextResponse.json({ error: 'Informe nome e email validos.' }, { status: 400 });
      }

      const { data: member } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id')
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
        await supabaseAdmin
          .from('profiles')
          .update({ nome, email, email_real: email })
          .eq('id', member.profile_id);

        await supabaseAdmin.auth.admin.updateUserById(member.profile_id, {
          email,
          email_confirm: true,
          user_metadata: { nome, email_real: email, tipo_usuario: 'corretor_membro' }
        });
      }

      return NextResponse.json({ success: true, membro: data });
    }

    if (action === 'assign_lead') {
      if (guard.profile.tipo_usuario !== 'corretor') {
        return NextResponse.json({ error: 'Apenas o corretor dono do time pode enviar leads.' }, { status: 403 });
      }

      const leadId = String(body.lead_id || '').trim();
      const memberId = String(body.member_id || '').trim();
      if (!leadId || !memberId) {
        return NextResponse.json({ error: 'Selecione o lead e o integrante.' }, { status: 400 });
      }

      const { data: member } = await supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id')
        .eq('id', memberId)
        .eq('corretor_id', corretorId)
        .in('status', ['active', 'ativo'])
        .maybeSingle();

      if (!member) return NextResponse.json({ error: 'Integrante nao encontrado.' }, { status: 404 });

      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('id', leadId)
        .eq('corretor_id', corretorId)
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
        .eq('corretor_id', corretorId);

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
    if (!nome || !email.includes('@')) {
      return NextResponse.json({ error: 'Informe nome e email real do membro.' }, { status: 400 });
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

    const senhaProvisoria = generateStrongPassword();
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senhaProvisoria,
      email_confirm: true,
      user_metadata: {
        nome,
        tipo_usuario: 'corretor_membro',
        corretor_id: corretorId,
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
          tipo_usuario: 'corretor_membro',
          corretor_id: corretorId,
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
