import { NextResponse } from 'next/server';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { UserRole } from '@/types';

const ALLOWED_ROLES: UserRole[] = ['admin', 'corretor', 'corretor_admin', 'corretor_membro'];
const ACTIVE_STATUSES = ['active', 'ativo', 'Ativo'];

async function getTeam(corretorId: string) {
  const { data, error } = await supabaseAdmin
    .from('corretor_times')
    .select('id, corretor_id')
    .eq('corretor_id', corretorId)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function isUnityBrokerage(corretorId: string) {
  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.nome_empresa || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase() === 'UNITY SAUDE';
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ALLOWED_ROLES);
  if ('error' in guard) return guard.error;
  if (!guard.profile.corretor_id) {
    return NextResponse.json({ error: 'Conta comercial nao encontrada.' }, { status: 400 });
  }

  try {
    if (guard.profile.tipo_usuario === 'corretor_membro' && !(await isUnityBrokerage(guard.profile.corretor_id))) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }
    const team = await getTeam(guard.profile.corretor_id);
    if (!team) return NextResponse.json({ membros: [] });

    const { data, error } = await supabaseAdmin
      .from('corretor_time_membros')
      .select('id, profile_id, nome, email, status, ordem')
      .eq('time_id', team.id)
      .in('status', ACTIVE_STATUSES)
      .not('profile_id', 'is', null)
      .order('ordem', { ascending: true });
    if (error) throw error;

    return NextResponse.json({ membros: data || [] }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[Inbox assignment] Falha ao listar responsaveis:', error);
    return NextResponse.json({ error: 'Nao foi possivel carregar os responsaveis.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ALLOWED_ROLES);
  if ('error' in guard) return guard.error;
  if (!guard.profile.corretor_id) {
    return NextResponse.json({ error: 'Conta comercial nao encontrada.' }, { status: 400 });
  }

  try {
    if (guard.profile.tipo_usuario === 'corretor_membro' && !(await isUnityBrokerage(guard.profile.corretor_id))) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }
    const body = await request.json();
    const leadId = String(body.lead_id || '').trim();
    const memberId = String(body.member_id || '').trim();
    if (!leadId || !memberId) {
      return NextResponse.json({ error: 'Informe o lead e o novo responsavel.' }, { status: 400 });
    }

    const team = await getTeam(guard.profile.corretor_id);
    if (!team) return NextResponse.json({ error: 'Time comercial nao encontrado.' }, { status: 404 });

    const [{ data: lead, error: leadError }, { data: member, error: memberError }] = await Promise.all([
      supabaseAdmin
        .from('leads')
        .select('id, corretor_id, responsavel_profile_id')
        .eq('id', leadId)
        .eq('corretor_id', guard.profile.corretor_id)
        .maybeSingle(),
      supabaseAdmin
        .from('corretor_time_membros')
        .select('id, profile_id, nome')
        .eq('id', memberId)
        .eq('time_id', team.id)
        .in('status', ACTIVE_STATUSES)
        .not('profile_id', 'is', null)
        .maybeSingle(),
    ]);
    if (leadError) throw leadError;
    if (memberError) throw memberError;
    if (!lead) return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });
    if (!member) return NextResponse.json({ error: 'Responsavel nao encontrado neste time.' }, { status: 404 });

    if (guard.profile.tipo_usuario === 'corretor_membro' && lead.responsavel_profile_id !== guard.profile.id) {
      return NextResponse.json({ error: 'Voce so pode encaminhar leads atribuidos a voce.' }, { status: 403 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('leads')
      .update({
        responsavel_membro_id: member.id,
        responsavel_profile_id: member.profile_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
      .eq('corretor_id', guard.profile.corretor_id);
    if (updateError) throw updateError;

    await writeAuditLog(request, guard.profile, {
      action: 'inbox.lead.forward',
      entity_type: 'lead',
      entity_id: lead.id,
      metadata: {
        from_profile_id: lead.responsavel_profile_id,
        to_profile_id: member.profile_id,
        member_id: member.id,
      },
    });

    return NextResponse.json({ success: true, member });
  } catch (error) {
    console.error('[Inbox assignment] Falha ao encaminhar lead:', error);
    return NextResponse.json({ error: 'Nao foi possivel encaminhar o lead.' }, { status: 500 });
  }
}
