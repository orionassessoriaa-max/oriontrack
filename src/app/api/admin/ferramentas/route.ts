import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { FERRAMENTA_CATALOG, isFerramentaStatus } from '@/lib/ferramentas';

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const [{ data: corretoras, error: corretorasError }, { data: configuracoes, error: configsError }] = await Promise.all([
      supabaseAdmin
        .from('corretoras')
        .select('id, nome, status')
        .order('nome'),
      supabaseAdmin
        .from('corretora_ferramentas')
        .select('id, corretora_id, ferramenta_key, status, observacoes, updated_at')
        .order('updated_at', { ascending: false }),
    ]);

    if (corretorasError) throw corretorasError;
    if (configsError) throw configsError;

    return NextResponse.json({
      corretoras: corretoras || [],
      ferramentas: FERRAMENTA_CATALOG,
      configuracoes: configuracoes || [],
    });
  } catch (error: any) {
    console.error('[api_admin_ferramentas] GET error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao carregar ferramentas.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const limited = rateLimit(request, 'admin:ferramentas:update', { limit: 120, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const corretoraId = String(body.corretoraId || '').trim();
    const ferramentaKey = String(body.ferramentaKey || '').trim();
    const status = String(body.status || '').trim();
    const observacoes = body.observacoes === undefined ? null : String(body.observacoes || '').trim() || null;

    const catalogItem = FERRAMENTA_CATALOG.find((tool) => tool.key === ferramentaKey);
    if (!corretoraId || !catalogItem || !isFerramentaStatus(status)) {
      return NextResponse.json({ error: 'Configuracao invalida.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('corretora_ferramentas')
      .upsert({
        corretora_id: corretoraId,
        ferramenta_key: ferramentaKey,
        status,
        observacoes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'corretora_id,ferramenta_key' })
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: 'save_tool_config',
      entity_type: 'corretora_ferramentas',
      entity_id: data.id,
      metadata: { corretoraId, ferramentaKey, status },
    });

    return NextResponse.json({ ok: true, config: data });
  } catch (error: any) {
    console.error('[api_admin_ferramentas] PATCH error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao salvar ferramenta.' },
      { status: 500 }
    );
  }
}
