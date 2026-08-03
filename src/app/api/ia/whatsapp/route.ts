import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { configureUazapiWebhook, uazapiAiInstanceName, uazapiFetch } from '@/lib/uazapi';

function asArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.instances)) return payload.instances;
  if (Array.isArray(payload?.response)) return payload.response;
  return [];
}

function instanceName(row: any) {
  return String(row?.name || row?.instanceName || row?.instance || row?.session || row?.sessionkey || '');
}

function stateOf(row: any) {
  const raw = String(row?.status || row?.state || row?.connectionStatus || row?.instance?.status || '').toLowerCase();
  if (row?.connected === true || row?.loggedIn === true || raw.includes('open') || raw.includes('connect')) return 'open';
  if (raw.includes('connecting') || raw.includes('qr')) return 'connecting';
  return 'close';
}

function qrCode(payload: any) {
  return payload?.qrcode || payload?.base64 || payload?.qr || payload?.data?.qrcode || payload?.data?.base64 || payload?.instance?.qrcode || null;
}

async function resolveAiContext(profile: any) {
  let corretorId = profile.corretor_id as string | null;
  if (!corretorId && profile.tipo_usuario === 'admin') return null;
  const { data: broker } = await supabaseAdmin.from('corretores').select('id, nome_empresa').eq('id', corretorId).maybeSingle();
  if (!broker?.nome_empresa) return null;
  const { data: corretora } = await supabaseAdmin.from('corretoras').select('id, nome').ilike('nome', broker.nome_empresa).maybeSingle();
  if (!corretora) return null;
  const { data: config } = await supabaseAdmin.from('corretora_ai_configs').select('id, corretora_id, status, sender_mode, dedicated_instance_name').eq('corretora_id', corretora.id).maybeSingle();
  const instance = config?.dedicated_instance_name || uazapiAiInstanceName(corretora.id);
  return { broker, corretora, config, instance };
}

async function providerState(instance: string) {
  const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
  const found = asArray(payload).find((row) => instanceName(row).toLowerCase() === instance.toLowerCase());
  return found ? stateOf(found) : 'close';
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['corretor', 'corretor_admin', 'corretor_membro', 'admin']);
    if ('error' in guard) return guard.error;
    const context = await resolveAiContext(guard.profile);
    if (!context) return NextResponse.json({ configured: false, error: 'Concessionaria nao identificada.' }, { status: 404 });
    const dedicated = context.config?.sender_mode === 'dedicated';
    const state = dedicated ? await providerState(context.instance).catch(() => 'close') : 'close';
    if (dedicated && context.config) {
      const nextStatus = state === 'open' ? 'ativo' : 'aguardando_conexao';
      if (context.config.status !== nextStatus) {
        await supabaseAdmin.from('corretora_ai_configs').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', context.config.id);
        context.config.status = nextStatus;
      }
    }
    return NextResponse.json({
      configured: Boolean(context.config),
      dedicated,
      active: context.config?.status === 'ativo',
      state,
      connected: state === 'open',
      concessionaria: context.corretora.nome,
      instance: dedicated ? context.instance : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel consultar a IA.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'ia:whatsapp:connect', { limit: 10, windowMs: 10 * 60_000 });
    if (limited) return limited;
    const guard = await requireApiUser(request, ['corretor', 'corretor_admin', 'admin']);
    if ('error' in guard) return guard.error;
    const context = await resolveAiContext(guard.profile);
    if (!context?.config || context.config.sender_mode !== 'dedicated') {
      return NextResponse.json({ error: 'Selecione Numero exclusivo da IA na configuracao da concessionaria antes de conectar.' }, { status: 400 });
    }

    try {
      await uazapiFetch('/instance/init', {
        method: 'POST',
        body: JSON.stringify({ name: context.instance, instance: context.instance, instanceName: context.instance }),
      }, { useAdminAuth: true });
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (!message.includes('exist') && !message.includes('already')) throw error;
      // Nunca exclui ou recria uma sessao existente, especialmente a do Danilo.
    }

    await configureUazapiWebhook(context.instance);
    const payload = await uazapiFetch('/instance/connect', { method: 'POST', body: '{}' }, { instanceName: context.instance });
    await writeAuditLog(request, guard.profile, {
      action: 'ai.whatsapp.connect.request',
      entity_type: 'corretora_ai_configs',
      entity_id: context.config.id,
      metadata: { corretora_id: context.corretora.id, instance: context.instance },
    });
    return NextResponse.json({ success: true, qrcode: qrCode(payload), state: 'connecting' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel gerar o QR Code da IA.' }, { status: 502 });
  }
}
