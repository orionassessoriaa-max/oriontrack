import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

const HISTORY_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro'] as const;

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function resolveBrokerScope(profile: any, requestedCorretorId?: string | null) {
  const brokerRole = ['corretor', 'corretor_admin', 'corretor_membro'].includes(profile.tipo_usuario);
  const baseBrokerId = profile.tipo_usuario === 'admin'
    ? (requestedCorretorId || null)
    : (brokerRole ? profile.corretor_id : null);

  if (!baseBrokerId) return [] as string[];

  const { data: brokerRow } = await supabaseAdmin
    .from('corretores')
    .select('id,nome_empresa')
    .eq('id', baseBrokerId)
    .maybeSingle();

  if (!brokerRow?.id) return [];

  if (brokerRow.nome_empresa) {
    const { data: siblings } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', brokerRow.nome_empresa);

    if (siblings?.length) return siblings.map((item) => item.id);
  }

  return [brokerRow.id];
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, [...HISTORY_ROLES]);
    if ('error' in guard) return guard.error;

    const url = new URL(request.url);
    const requestedCorretorId = url.searchParams.get('corretor_id');
    const brokerIds = await resolveBrokerScope(guard.profile, requestedCorretorId);

    let leadsQuery = supabaseAdmin
      .from('leads')
      .select('id,nome,telefone,status,cidade,corretor_id,responsavel_profile_id')
      .order('data_entrada', { ascending: false, nullsFirst: false })
      .limit(1500);

    if (brokerIds.length > 0) {
      leadsQuery = leadsQuery.in('corretor_id', brokerIds);
    } else if (guard.profile.tipo_usuario !== 'admin') {
      return NextResponse.json({ activities: [], leads: [], profiles: [] });
    }

    if (guard.profile.tipo_usuario === 'corretor_membro') {
      leadsQuery = leadsQuery.eq('responsavel_profile_id', guard.profile.id);
    }

    const { data: leads, error: leadsError } = await leadsQuery;
    if (leadsError) throw leadsError;

    const leadRows = leads || [];
    const leadIds = leadRows.map((lead) => lead.id).filter(Boolean);

    let activities: any[] = [];
    if (leadIds.length > 0) {
      for (const ids of chunk(leadIds, 250)) {
        const { data, error } = await supabaseAdmin
          .from('lead_atividades')
          .select('*')
          .in('lead_id', ids)
          .order('created_at', { ascending: false })
          .limit(1000);

        if (error) throw error;
        activities = activities.concat(data || []);
      }
    }

    activities = activities
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 1000);

    const profileIds = Array.from(new Set([
      ...leadRows.map((lead) => lead.responsavel_profile_id).filter(Boolean),
      ...activities.map((activity) => activity.profile_id).filter(Boolean),
    ])) as string[];

    const { data: profiles, error: profilesError } = profileIds.length
      ? await supabaseAdmin.from('profiles').select('id,nome,email,email_real').in('id', profileIds)
      : { data: [], error: null };

    if (profilesError) throw profilesError;

    return NextResponse.json({
      activities,
      leads: leadRows,
      profiles: profiles || [],
    });
  } catch (error: any) {
    console.error('[GET /api/historico/leads]', error);
    return NextResponse.json({ error: error.message || 'Erro ao carregar historico.' }, { status: 500 });
  }
}
