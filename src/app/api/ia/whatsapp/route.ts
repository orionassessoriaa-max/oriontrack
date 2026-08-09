import { NextResponse } from 'next/server';
import { ApiProfile, rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { configureUazapiWebhook, ensureUazapiInstance, uazapiAiInstanceName, uazapiFetch } from '@/lib/uazapi';
import { DEFAULT_LEAD_AI_PERSONA, DEFAULT_LEAD_AI_SYSTEM_PROMPT } from '@/lib/defaultLeadAiPrompt';

const AI_TARGET_ROLES = ['corretor', 'corretor_admin', 'corretor_membro'] as const;

async function resolveTargetProfile(request: Request, actor: ApiProfile) {
  const viewingProfileId = request.headers.get('x-orion-view-profile-id');
  if (!viewingProfileId || viewingProfileId === actor.id) return actor;
  if (actor.tipo_usuario !== 'admin') throw new Error('Voce nao pode conectar a IA deste perfil.');

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, email_real, nome, tipo_usuario, corretor_id, telefone, status, is_admin_master, equipe_orion')
    .eq('id', viewingProfileId)
    .in('tipo_usuario', AI_TARGET_ROLES as unknown as string[])
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Perfil visualizado nao encontrado.');
  return data as ApiProfile;
}

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
  if (
    raw.includes('disconnect')
    || raw.includes('close')
    || raw.includes('offline')
    || raw.includes('loggedout')
    || raw.includes('logged_out')
  ) return 'close';
  if (raw.includes('connecting') || raw.includes('qr') || raw.includes('pair')) return 'connecting';
  if (
    row?.connected === true
    || row?.loggedIn === true
    || raw === 'open'
    || raw === 'connected'
    || raw === 'online'
  ) return 'open';
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
  const matches = asArray(payload).filter((row) => instanceName(row).toLowerCase() === instance.toLowerCase());
  const found = matches.find((row) => stateOf(row) === 'open') || matches[0];
  return found ? stateOf(found) : 'close';
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['corretor', 'corretor_admin', 'corretor_membro', 'admin']);
    if ('error' in guard) return guard.error;
    const targetProfile = await resolveTargetProfile(request, guard.profile);
    const context = await resolveAiContext(targetProfile);
    if (!context) return NextResponse.json({ configured: false, error: 'Concessionaria nao identificada.' }, { status: 404 });
    const dedicated = context.config?.sender_mode === 'dedicated';
    const state = dedicated ? await providerState(context.instance).catch(() => 'close') : 'close';
    if (dedicated && context.config) {
      // Uma consulta da pagina pode confirmar recuperacao, mas nunca deve
      // transformar uma oscilacao isolada em desconexao definitiva.
      if (state === 'open' && context.config.status !== 'ativo') {
        await supabaseAdmin.from('corretora_ai_configs').update({ status: 'ativo', updated_at: new Date().toISOString() }).eq('id', context.config.id);
        context.config.status = 'ativo';
      }
    }
    return NextResponse.json({
      configured: Boolean(context.config),
      dedicated,
      can_connect: !context.config || dedicated,
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
    const guard = await requireApiUser(request, ['corretor', 'corretor_admin', 'corretor_membro', 'admin']);
    if ('error' in guard) return guard.error;
    const targetProfile = await resolveTargetProfile(request, guard.profile);
    const context = await resolveAiContext(targetProfile);
    if (!context) {
      return NextResponse.json({ error: 'Concessionaria nao identificada.' }, { status: 404 });
    }
    if (context.config && context.config.sender_mode !== 'dedicated') {
      return NextResponse.json({ error: 'Selecione Numero exclusivo da IA na configuracao da concessionaria antes de conectar.' }, { status: 400 });
    }

    if (!context.config) {
      const { data: createdConfig, error: configError } = await supabaseAdmin
        .from('corretora_ai_configs')
        .upsert({
          corretora_id: context.corretora.id,
          persona: DEFAULT_LEAD_AI_PERSONA,
          system_prompt: DEFAULT_LEAD_AI_SYSTEM_PROMPT,
          sender_profile_id: null,
          sender_mode: 'dedicated',
          dedicated_instance_name: context.instance,
          status: 'aguardando_conexao',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'corretora_id' })
        .select('id, corretora_id, status, sender_mode, dedicated_instance_name')
        .single();
      if (configError) throw configError;
      context.config = createdConfig;
    }

    await ensureUazapiInstance(context.instance);

    await configureUazapiWebhook(context.instance);
    const payload = await uazapiFetch('/instance/connect', { method: 'POST', body: '{}' }, { instanceName: context.instance });
    await supabaseAdmin
      .from('corretora_ai_configs')
      .update({ status: 'aguardando_conexao', updated_at: new Date().toISOString() })
      .eq('id', context.config.id);
    await writeAuditLog(request, guard.profile, {
      action: 'ai.whatsapp.connect.request',
      entity_type: 'corretora_ai_configs',
      entity_id: context.config.id,
      metadata: { corretora_id: context.corretora.id, instance: context.instance, target_profile_id: targetProfile.id },
    });
    return NextResponse.json({ success: true, qrcode: qrCode(payload), state: 'connecting' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel gerar o QR Code da IA.' }, { status: 502 });
  }
}
