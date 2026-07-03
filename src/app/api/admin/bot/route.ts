import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';

const defaultFlow = [
  { id: 'trigger_crm', type: 'trigger', label: 'Gatilho CRM', description: 'Quando o lead cair no CRM' },
  { id: 'message_first', type: 'message', label: 'Primeiro atendimento', description: 'Envia a primeira mensagem ao lead' },
  { id: 'condition_response', type: 'condition', label: 'Resposta do lead', description: 'True/false para continuar' },
  { id: 'notify_broker', type: 'action', label: 'Acionar corretor', description: 'Chama o responsavel quando precisar de atendimento humano' },
];

function normalizeFlow(fluxo: unknown) {
  if (Array.isArray(fluxo) && fluxo.length) return fluxo;
  if (fluxo && typeof fluxo === 'object') return fluxo;
  return defaultFlow;
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const { data: corretoras, error: errCorretoras } = await supabaseAdmin
      .from('corretoras')
      .select('id, nome, status')
      .order('nome');

    if (errCorretoras) throw errCorretoras;

    const { data: botConfigs, error: errBotConfigs } = await supabaseAdmin
      .from('corretora_bot_configs')
      .select('*, corretoras(nome)')
      .order('created_at', { ascending: true });

    if (errBotConfigs) throw errBotConfigs;

    const activeConfigs = botConfigs || [];
    const activeCorretoraIds = new Set(activeConfigs.map((config) => config.corretora_id));
    const inactiveCorretoras = (corretoras || []).filter(
      (corretora) => corretora.status === 'ativo' && !activeCorretoraIds.has(corretora.id)
    );

    return NextResponse.json({ activeConfigs, inactiveCorretoras });
  } catch (error: any) {
    console.error('[api_admin_bot] GET error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao carregar configuracoes do bot.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const limited = rateLimit(request, 'admin:bot:upsert', { limit: 60, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const { corretora_id, nome, trigger_key, primeira_mensagem, fluxo, status } = body;

    if (!corretora_id || !nome || !primeira_mensagem) {
      return NextResponse.json({ error: 'Campos obrigatorios faltando.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('corretora_bot_configs')
      .upsert({
        corretora_id,
        nome,
        trigger_key: trigger_key || 'crm',
        primeira_mensagem,
        fluxo: normalizeFlow(fluxo),
        status: status || 'ativo',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'corretora_id' })
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: 'save_bot_config',
      entity_type: 'corretora_bot_configs',
      entity_id: data.id,
      metadata: { corretora_id, nome, trigger_key: trigger_key || 'crm', status },
    });

    return NextResponse.json({ ok: true, config: data });
  } catch (error: any) {
    console.error('[api_admin_bot] POST error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao salvar configuracao do bot.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const limited = rateLimit(request, 'admin:bot:delete', { limit: 30, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Config ID nao informado.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('corretora_bot_configs')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: 'delete_bot_config',
      entity_type: 'corretora_bot_configs',
      entity_id: id,
      metadata: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[api_admin_bot] DELETE error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao desativar bot da concessionaria.' }, { status: 500 });
  }
}
