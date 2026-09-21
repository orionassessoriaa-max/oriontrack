import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser } from '@/lib/api/security';

const DEFAULT_TYPES = {
  saldo_baixo: true,
  cpl_alto: true,
  notificacao: true,
  novo_lead: true,
  suporte: true,
  demandas: true,
};

async function resolveTargetProfile(guardProfile: any, request: Request, body?: any) {
  const url = new URL(request.url);
  const requestedTargetId = String(body?.target_profile_id || url.searchParams.get('target_profile_id') || '').trim();
  const targetProfileId = requestedTargetId || guardProfile.id;

  if (targetProfileId === guardProfile.id) {
    return { target: guardProfile };
  }

  if (guardProfile.tipo_usuario !== 'admin') {
    return {
      error: NextResponse.json({ error: 'Voce nao pode alterar preferencias de outro usuario.' }, { status: 403 }),
    };
  }

  const { data: target, error } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, telefone, status, corretor_id')
    .eq('id', targetProfileId)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  if (!target) {
    return { error: NextResponse.json({ error: 'Perfil alvo nao encontrado.' }, { status: 404 }) };
  }

  return { target };
}

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'notifications:preferences:get', { limit: 60, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request);
    if ('error' in guard) return guard.error;

    const resolved = await resolveTargetProfile(guard.profile, request);
    if ('error' in resolved) return resolved.error;
    const target = resolved.target;

    const { data, error } = await supabaseAdmin
      .from('notificacao_preferencias')
      .select('*')
      .eq('profile_id', target.id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      preferences: data || {
        profile_id: target.id,
        whatsapp_enabled: false,
        telefone: target.telefone || '',
        tipos: DEFAULT_TYPES,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar preferencias.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const limited = rateLimit(request, 'notifications:preferences:update', { limit: 30, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const resolved = await resolveTargetProfile(guard.profile, request, body);
    if ('error' in resolved) return resolved.error;
    const target = resolved.target;

    const telefone = String(body.telefone || '').trim();
    const tipos = body.tipos && typeof body.tipos === 'object'
      ? { ...DEFAULT_TYPES, ...body.tipos }
      : DEFAULT_TYPES;

    const payload = {
      profile_id: target.id,
      whatsapp_enabled: Boolean(body.whatsapp_enabled),
      telefone,
      tipos,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('notificacao_preferencias')
      .upsert(payload, { onConflict: 'profile_id' })
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (telefone) {
      const { error: profileUpdateError } = await supabaseAdmin
        .from('profiles')
        .update({ telefone })
        .eq('id', target.id);

      if (profileUpdateError) {
        return NextResponse.json({ error: profileUpdateError.message }, { status: 500 });
      }

      if (target.corretor_id && ['corretor', 'corretor_admin'].includes(target.tipo_usuario)) {
        const { error: brokerUpdateError } = await supabaseAdmin
          .from('corretores')
          .update({ telefone })
          .eq('id', target.corretor_id);

        if (brokerUpdateError) {
          return NextResponse.json({ error: brokerUpdateError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ success: true, preferences: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao salvar preferencias.' }, { status: 500 });
  }
}
