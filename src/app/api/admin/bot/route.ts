import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import {
  listUazapiInstanceConnections,
  uazapiAiInstanceName,
  uazapiInstanceName,
} from '@/lib/uazapi';

const ACTIVE_PROFILE_STATUSES = ['active', 'ativo', 'Ativo'];
const BOT_SENDER_PROFILE_TYPES = ['corretor_admin', 'corretor', 'corretor_membro'];

type CorretoraRow = { id: string; nome: string; status?: string | null };
type SenderProfile = {
  id: string;
  nome: string | null;
  telefone: string | null;
  tipo_usuario: string | null;
  corretor_id: string;
};

async function loadSenderContext(corretoras: CorretoraRow[]) {
  const names = corretoras.map((item) => item.nome).filter(Boolean);
  const { data: corretores, error: brokersError } = names.length
    ? await supabaseAdmin.from('corretores').select('id, nome_empresa').in('nome_empresa', names)
    : { data: [], error: null };
  if (brokersError) throw brokersError;

  const corretoraByName = new Map(corretoras.map((item) => [String(item.nome || '').trim(), item.id]));
  const corretorToCorretora = new Map<string, string>();
  for (const corretor of corretores || []) {
    const corretoraId = corretoraByName.get(String(corretor.nome_empresa || '').trim());
    if (corretoraId) corretorToCorretora.set(corretor.id, corretoraId);
  }

  const brokerIds = Array.from(corretorToCorretora.keys());
  const { data: profiles, error: profilesError } = brokerIds.length
    ? await supabaseAdmin
        .from('profiles')
        .select('id, nome, telefone, tipo_usuario, corretor_id')
        .in('corretor_id', brokerIds)
        .in('tipo_usuario', BOT_SENDER_PROFILE_TYPES)
        .in('status', ACTIVE_PROFILE_STATUSES)
        .order('tipo_usuario', { ascending: true })
        .order('nome', { ascending: true })
    : { data: [], error: null };
  if (profilesError) throw profilesError;

  const profilesByCorretora = (profiles || []).reduce((acc: Record<string, SenderProfile[]>, profile: any) => {
    const corretoraId = corretorToCorretora.get(profile.corretor_id);
    if (!corretoraId) return acc;
    if (!acc[corretoraId]) acc[corretoraId] = [];
    acc[corretoraId].push(profile as SenderProfile);
    return acc;
  }, {});

  const { data: aiConfigs, error: aiError } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('corretora_id, sender_mode, dedicated_instance_name');
  if (aiError) throw aiError;

  const instances = await listUazapiInstanceConnections();
  const instanceByName = new Map(instances.map((instance) => [instance.name.toLowerCase(), instance]));
  return { profilesByCorretora, aiConfigs: aiConfigs || [], instanceByName };
}

function automaticProfile(profiles: SenderProfile[]) {
  return profiles.find((profile) => profile.tipo_usuario === 'corretor_admin' && profile.telefone)
    || profiles.find((profile) => profile.telefone)
    || profiles[0]
    || null;
}

function buildSenderData(configs: any[], corretoras: CorretoraRow[], context: Awaited<ReturnType<typeof loadSenderContext>>) {
  const senderOptionsByCorretora: Record<string, any[]> = {};
  const botHealthByCorretora: Record<string, any> = {};

  for (const corretora of corretoras) {
    const profiles = context.profilesByCorretora[corretora.id] || [];
    const options: Array<{
      key: string;
      mode: 'profile' | 'dedicated';
      profile_id: string | null;
      instance_name: string;
      source: 'inbox' | 'ai';
      owner_name: string;
      phone: string;
      connected: boolean;
      state: string;
    }> = profiles.map((profile) => {
      const instanceName = uazapiInstanceName(profile.id);
      const connection = context.instanceByName.get(instanceName.toLowerCase());
      return {
        key: `profile:${profile.id}`,
        mode: 'profile',
        profile_id: profile.id,
        instance_name: instanceName,
        source: 'inbox',
        owner_name: profile.nome || 'Usuario do Inbox',
        phone: connection?.phone || profile.telefone || '',
        connected: connection?.connected === true,
        state: connection?.state || 'missing',
      };
    });

    const aiConfig = context.aiConfigs.find((item: any) => item.corretora_id === corretora.id && item.sender_mode === 'dedicated');
    if (aiConfig) {
      const instanceName = aiConfig.dedicated_instance_name || uazapiAiInstanceName(corretora.id);
      const connection = context.instanceByName.get(instanceName.toLowerCase());
      options.push({
        key: `dedicated:${instanceName}`,
        mode: 'dedicated',
        profile_id: null,
        instance_name: instanceName,
        source: 'ai',
        owner_name: 'WhatsApp exclusivo da IA',
        phone: connection?.phone || '',
        connected: connection?.connected === true,
        state: connection?.state || 'missing',
      });
    }
    senderOptionsByCorretora[corretora.id] = options.filter((option) => option.connected);

    const config = configs.find((item) => item.corretora_id === corretora.id);
    if (!config || config.status !== 'ativo') continue;
    const selectedProfile = config.sender_mode === 'profile'
      ? profiles.find((profile) => profile.id === config.sender_profile_id) || null
      : automaticProfile(profiles);
    const instanceName = config.sender_mode === 'dedicated'
      ? config.dedicated_instance_name || uazapiAiInstanceName(corretora.id)
      : selectedProfile ? uazapiInstanceName(selectedProfile.id) : null;
    const connection = instanceName ? context.instanceByName.get(instanceName.toLowerCase()) : null;
    botHealthByCorretora[corretora.id] = {
      healthy: connection?.connected === true,
      state: connection?.state || (instanceName ? 'missing' : 'missing_sender'),
      instance_name: instanceName,
      phone: connection?.phone || selectedProfile?.telefone || '',
      owner_name: config.sender_mode === 'dedicated' ? 'WhatsApp exclusivo da IA' : selectedProfile?.nome || '',
      sender_mode: config.sender_mode || 'automatic',
    };
  }

  return { senderOptionsByCorretora, botHealthByCorretora };
}

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

    const senderContext = await loadSenderContext((corretoras || []) as CorretoraRow[]);
    const senderData = buildSenderData(activeConfigs, (corretoras || []) as CorretoraRow[], senderContext);

    return NextResponse.json({ activeConfigs, inactiveCorretoras, ...senderData });
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
    const requestedMode = ['profile', 'dedicated'].includes(String(body.sender_mode || ''))
      ? String(body.sender_mode)
      : null;
    const senderProfileId = body.sender_profile_id ? String(body.sender_profile_id) : null;
    const dedicatedInstanceName = body.dedicated_instance_name ? String(body.dedicated_instance_name) : null;

    if (!corretora_id || !nome || !primeira_mensagem) {
      return NextResponse.json({ error: 'Campos obrigatorios faltando.' }, { status: 400 });
    }

    const { data: existingConfig } = await supabaseAdmin
      .from('corretora_bot_configs')
      .select('id, sender_mode, sender_profile_id, dedicated_instance_name, status')
      .eq('corretora_id', corretora_id)
      .maybeSingle();
    const senderMode = requestedMode || existingConfig?.sender_mode || 'automatic';

    if (status === 'ativo' && !requestedMode && !existingConfig?.id) {
      return NextResponse.json({ error: 'Escolha um WhatsApp conectado antes de ativar o bot.' }, { status: 400 });
    }

    if (requestedMode) {
      const { data: corretora } = await supabaseAdmin.from('corretoras').select('id, nome, status').eq('id', corretora_id).single();
      const context = await loadSenderContext(corretora ? [corretora as CorretoraRow] : []);
      const senderData = buildSenderData([], corretora ? [corretora as CorretoraRow] : [], context);
      const validOption = (senderData.senderOptionsByCorretora[corretora_id] || []).find((option: any) =>
        option.mode === requestedMode
        && (requestedMode === 'profile' ? option.profile_id === senderProfileId : option.instance_name === dedicatedInstanceName)
      );
      if (!validOption) {
        return NextResponse.json({ error: 'O WhatsApp escolhido nao esta conectado ou nao pertence a esta concessionaria.' }, { status: 400 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('corretora_bot_configs')
      .upsert({
        corretora_id,
        nome,
        trigger_key: trigger_key || 'crm',
        primeira_mensagem,
        fluxo: normalizeFlow(fluxo),
        status: status || 'inativo',
        sender_mode: senderMode,
        sender_profile_id: senderMode === 'profile' ? senderProfileId || existingConfig?.sender_profile_id || null : null,
        dedicated_instance_name: senderMode === 'dedicated' ? dedicatedInstanceName || existingConfig?.dedicated_instance_name || null : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'corretora_id' })
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: 'save_bot_config',
      entity_type: 'corretora_bot_configs',
      entity_id: data.id,
      metadata: { corretora_id, nome, trigger_key: trigger_key || 'crm', status, sender_mode: senderMode },
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
