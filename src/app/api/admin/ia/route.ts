import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import {
  DEFAULT_LEAD_AI_PERSONA,
  DEFAULT_LEAD_AI_SYSTEM_PROMPT,
} from '@/lib/defaultLeadAiPrompt';
import { uazapiAiInstanceName } from '@/lib/uazapi';

const ACTIVE_PROFILE_STATUSES = ['active', 'ativo', 'Ativo'];
const AI_SENDER_PROFILE_TYPES = ['corretor_admin', 'corretor'];

async function loadSenderProfilesByCorretora(corretoras: Array<{ id: string; nome: string }>) {
  if (!corretoras.length) return {};

  const { data: corretores } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, email, nome_empresa')
    .in('nome_empresa', corretoras.map((item) => item.nome));

  const corretoraByName = new Map(corretoras.map((item) => [String(item.nome || '').trim(), item.id]));
  const corretorToCorretora = new Map<string, string>();
  (corretores || []).forEach((corretor) => {
    const corretoraId = corretoraByName.get(String(corretor.nome_empresa || '').trim());
    if (corretoraId) corretorToCorretora.set(corretor.id, corretoraId);
  });

  const corretorIds = Array.from(corretorToCorretora.keys());
  if (!corretorIds.length) return {};

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, telefone, tipo_usuario, corretor_id')
    .in('corretor_id', corretorIds)
    .in('tipo_usuario', AI_SENDER_PROFILE_TYPES)
    .in('status', ACTIVE_PROFILE_STATUSES)
    .order('tipo_usuario', { ascending: true })
    .order('nome', { ascending: true });

  return (profiles || []).reduce((acc: Record<string, any[]>, profile) => {
    const corretoraId = corretorToCorretora.get(profile.corretor_id);
    if (!corretoraId) return acc;
    if (!acc[corretoraId]) acc[corretoraId] = [];
    acc[corretoraId].push(profile);
    return acc;
  }, {});
}

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
      .select('*, corretoras(nome)')
      .order('created_at', { ascending: true });
      
    if (errAiConfigs) throw errAiConfigs;
      
    const activeConfigs = aiConfigs || [];
    const activeCorretoraIds = new Set(activeConfigs.map(c => c.corretora_id));
    
    const inactiveCorretoras = (corretoras || []).filter(
      c => c.status === 'ativo' && !activeCorretoraIds.has(c.id)
    );
    
    const senderProfilesByCorretora = await loadSenderProfilesByCorretora(corretoras || []);

    return NextResponse.json({
      activeConfigs,
      inactiveCorretoras,
      senderProfilesByCorretora
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
    const corretora_id = String(body.corretora_id || '').trim();
    const requestedPersona = String(body.persona || '').trim();
    const requestedPrompt = String(body.system_prompt || '').trim();
    const useDaniloDefault = body.use_default_model === true || !requestedPrompt;
    const persona = requestedPersona || DEFAULT_LEAD_AI_PERSONA;
    const system_prompt = useDaniloDefault
      ? DEFAULT_LEAD_AI_SYSTEM_PROMPT
      : requestedPrompt;
    const requestedStatus = String(body.status || 'ativo').trim() || 'ativo';
    const sender_profile_id = body.sender_profile_id ? String(body.sender_profile_id) : null;
    const sender_mode = body.sender_mode === 'dedicated' ? 'dedicated' : 'profile';
    const status = sender_mode === 'dedicated' && requestedStatus === 'ativo' ? 'aguardando_conexao' : requestedStatus;
    
    if (!corretora_id) {
      return NextResponse.json({ error: 'Concessionaria nao informada.' }, { status: 400 });
    }
    
    const { data, error } = await supabaseAdmin
      .from('corretora_ai_configs')
      .upsert({
        corretora_id,
        persona,
        system_prompt,
        sender_profile_id,
        sender_mode,
        dedicated_instance_name: sender_mode === 'dedicated' ? uazapiAiInstanceName(corretora_id) : null,
        status,
        updated_at: new Date().toISOString()
      }, { onConflict: 'corretora_id' })
      .select('*')
      .single();
      
    if (error) throw error;
    
    await writeAuditLog(request, guard.profile, {
      action: 'save_ai_config',
      entity_type: 'corretora_ai_configs',
      entity_id: data.id,
      metadata: {
        corretora_id,
        persona,
        status,
        sender_profile_id,
        sender_mode,
        prompt_model: useDaniloDefault ? 'danilo_default' : 'custom',
      }
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
