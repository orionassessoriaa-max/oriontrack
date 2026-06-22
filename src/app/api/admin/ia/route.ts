import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;
    
    // Fetch all corretoras
    const { data: corretoras, error: errCorretoras } = await supabaseAdmin
      .from('corretoras')
      .select('id, nome, status')
      .order('nome');
      
    if (errCorretoras) throw errCorretoras;
      
    // Fetch all AI configs
    const { data: aiConfigs, error: errAiConfigs } = await supabaseAdmin
      .from('corretora_ai_configs')
      .select('*')
      .order('created_at', { ascending: true });
      
    if (errAiConfigs) throw errAiConfigs;
      
    const activeConfigs = aiConfigs || [];
    const activeCorretoraIds = new Set(activeConfigs.map(c => c.corretora_id));
    
    const inactiveCorretoras = (corretoras || []).filter(
      c => c.status === 'ativo' && !activeCorretoraIds.has(c.id)
    );
    
    return NextResponse.json({
      activeConfigs,
      inactiveCorretoras
    });
  } catch (error: any) {
    console.error('[api_admin_ia] GET error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao carregar configuracoes da IA.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;
    
    const limited = rateLimit(request, 'admin:ia:upsert', { limit: 60, windowMs: 10 * 60_000 });
    if (limited) return limited;
    
    const body = await request.json().catch(() => ({}));
    const { corretora_id, persona, system_prompt, status } = body;
    
    if (!corretora_id || !persona || !system_prompt) {
      return NextResponse.json({ error: 'Campos obrigatorios faltando.' }, { status: 400 });
    }
    
    const { data, error } = await supabaseAdmin
      .from('corretora_ai_configs')
      .upsert({
        corretora_id,
        persona,
        system_prompt,
        status: status || 'ativo',
        updated_at: new Date().toISOString()
      }, { onConflict: 'corretora_id' })
      .select('*')
      .single();
      
    if (error) throw error;
    
    await writeAuditLog(request, guard.profile, {
      action: 'save_ai_config',
      entity_type: 'corretora_ai_configs',
      entity_id: data.id,
      metadata: { corretora_id, persona, status }
    });
    
    return NextResponse.json({ ok: true, config: data });
  } catch (error: any) {
    console.error('[api_admin_ia] POST error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao salvar configuracao da IA.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;
    
    const limited = rateLimit(request, 'admin:ia:delete', { limit: 30, windowMs: 10 * 60_000 });
    if (limited) return limited;
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Config ID nao informado.' }, { status: 400 });
    }
    
    const { error } = await supabaseAdmin
      .from('corretora_ai_configs')
      .delete()
      .eq('id', id);
      
    if (error) throw error;
    
    await writeAuditLog(request, guard.profile, {
      action: 'delete_ai_config',
      entity_type: 'corretora_ai_configs',
      entity_id: id,
      metadata: { id }
    });
    
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[api_admin_ia] DELETE error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao desativar IA da concessionaria.' }, { status: 500 });
  }
}
