import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const { data, error } = await supabaseAdmin
      .from('corretora_ai_prompt_models')
      .select('id, nome, categoria, system_prompt, base_model, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ models: data || [] });
  } catch (error: any) {
    console.error('[api_admin_ia_prompt_models] GET error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao carregar modelos de prompt.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const limited = rateLimit(request, 'admin:ia:prompt-models', { limit: 40, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const nome = String(body.nome || '').trim();
    const categoria = String(body.categoria || 'Atendimento').trim();
    const system_prompt = String(body.system_prompt || '').trim();
    const base_model = body.base_model ? String(body.base_model).trim() : null;

    if (!nome || !system_prompt) {
      return NextResponse.json({ error: 'Nome e prompt sao obrigatorios.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('corretora_ai_prompt_models')
      .insert({
        nome,
        categoria: categoria || 'Atendimento',
        system_prompt,
        base_model
      })
      .select('id, nome, categoria, system_prompt, base_model, created_at, updated_at')
      .single();

    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: 'create_ai_prompt_model',
      entity_type: 'corretora_ai_prompt_models',
      entity_id: data.id,
      metadata: { nome, categoria, base_model }
    });

    return NextResponse.json({ ok: true, model: data });
  } catch (error: any) {
    console.error('[api_admin_ia_prompt_models] POST error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao salvar modelo de prompt.' },
      { status: 500 }
    );
  }
}
