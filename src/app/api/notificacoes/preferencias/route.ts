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

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'notifications:preferences:get', { limit: 60, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request);
    if ('error' in guard) return guard.error;

    const { data, error } = await supabaseAdmin
      .from('notificacao_preferencias')
      .select('*')
      .eq('profile_id', guard.profile.id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      preferences: data || {
        profile_id: guard.profile.id,
        whatsapp_enabled: false,
        telefone: guard.profile.telefone || '',
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
    const telefone = String(body.telefone || '').trim();
    const tipos = body.tipos && typeof body.tipos === 'object'
      ? { ...DEFAULT_TYPES, ...body.tipos }
      : DEFAULT_TYPES;

    const payload = {
      profile_id: guard.profile.id,
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
    return NextResponse.json({ success: true, preferences: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao salvar preferencias.' }, { status: 500 });
  }
}
