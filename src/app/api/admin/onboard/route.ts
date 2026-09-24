import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

type OnboardAuditRow = {
  id: string;
  actor_profile_id: string | null;
  metadata: {
    cliente?: string;
    segmento?: string | null;
    link_path?: string;
  } | null;
  created_at: string;
};

async function withAuthorNames(rows: OnboardAuditRow[]) {
  const profileIds = Array.from(new Set(rows.map((row) => row.actor_profile_id).filter(Boolean))) as string[];
  const { data: profiles } = profileIds.length
    ? await supabaseAdmin.from('profiles').select('id,nome').in('id', profileIds)
    : { data: [] as Array<{ id: string; nome: string | null }> };
  const names = new Map((profiles || []).map((profile) => [profile.id, profile.nome]));

  return rows
    .filter((row) => row.metadata?.cliente && row.metadata?.link_path)
    .map((row) => ({
      id: row.id,
      cliente: String(row.metadata?.cliente || ''),
      segmento: row.metadata?.segmento ? String(row.metadata.segmento) : null,
      link_path: String(row.metadata?.link_path || ''),
      created_at: row.created_at,
      created_by_name: row.actor_profile_id ? names.get(row.actor_profile_id) || 'Equipe Orion' : 'Equipe Orion',
    }));
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .select('id,actor_profile_id,metadata,created_at')
      .eq('action', 'create_onboarding_link')
      .eq('entity_type', 'admin_onboard')
      .order('created_at', { ascending: false })
      .limit(12);

    if (error) throw error;
    return NextResponse.json({ items: await withAuthorNames((data || []) as OnboardAuditRow[]) });
  } catch (error: any) {
    console.error('[api_admin_onboard] GET error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao carregar os onboardings salvos.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const limited = rateLimit(request, 'admin:onboard:create', { limit: 60, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const cliente = String(body.cliente || '').trim();
    const segmento = String(body.segmento || '').trim();

    if (!cliente || cliente.length > 120 || segmento.length > 120) {
      return NextResponse.json({ error: 'Nome ou segmento inválido.' }, { status: 400 });
    }

    const linkPath = `/onboard/?cliente=${encodeURIComponent(cliente)}&segmento=${encodeURIComponent(segmento)}`;
    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        actor_profile_id: guard.profile.id,
        actor_email: guard.profile.email_real || guard.profile.email || null,
        actor_role: guard.profile.tipo_usuario,
        action: 'create_onboarding_link',
        entity_type: 'admin_onboard',
        metadata: { cliente, segmento: segmento || null, link_path: linkPath },
        user_agent: request.headers.get('user-agent'),
      })
      .select('id,actor_profile_id,metadata,created_at')
      .single();

    if (error) throw error;

    return NextResponse.json({
      item: {
        id: data.id,
        cliente,
        segmento: segmento || null,
        link_path: linkPath,
        created_at: data.created_at,
        created_by_name: guard.profile.nome || 'Equipe Orion',
      },
    });
  } catch (error: any) {
    console.error('[api_admin_onboard] POST error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao salvar o onboarding.' },
      { status: 500 },
    );
  }
}
