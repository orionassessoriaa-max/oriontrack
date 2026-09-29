import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sanitizeUnityMacros } from '@/lib/unityMacros';
import { mergeUnityDefaultLabels, sanitizeUnityLabels } from '@/lib/unityLabels';

const ALLOWED_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;

type UnityQuickReply = { id: string; title: string; text: string };

function normalizedCompany(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

async function resolveUnityContext(request: Request) {
  const guard = await requireApiUser(request, ALLOWED_ROLES as any);
  if ('error' in guard) return { response: guard.error };

  let target = guard.profile as any;
  const requestedProfileId = request.headers.get('x-orion-view-profile-id');
  if (requestedProfileId && requestedProfileId !== guard.profile.id && guard.profile.tipo_usuario === 'admin') {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id,nome,nome_empresa,corretor_id,tipo_usuario')
      .eq('id', requestedProfileId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { response: NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 404 }) };
    target = data;
  }

  if (!target.corretor_id) {
    return { response: NextResponse.json({ error: 'Configuracao disponivel somente para a Unity.' }, { status: 403 }) };
  }

  const { data: baseBroker, error: baseError } = await supabaseAdmin
    .from('corretores')
    .select('id,nome_empresa,operadoras_info')
    .eq('id', target.corretor_id)
    .maybeSingle();
  if (baseError) throw baseError;
  if (!baseBroker || normalizedCompany(baseBroker.nome_empresa) !== 'UNITY SAUDE') {
    return { response: NextResponse.json({ error: 'Cadastro da Unity nao encontrado.' }, { status: 404 }) };
  }

  const { data: companyRows, error: companyError } = await supabaseAdmin
    .from('corretores')
    .select('id,operadoras_info')
    .eq('nome_empresa', baseBroker.nome_empresa);
  if (companyError) throw companyError;

  return { guard, target, companyRows: companyRows || [] };
}

function sanitizeQuickReplies(value: unknown): UnityQuickReply[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 100).flatMap((item: any) => {
    const title = String(item?.title || '').trim().slice(0, 60);
    const text = String(item?.text || '').trim().slice(0, 4000);
    const normalized = title.toLocaleLowerCase('pt-BR');
    if (!title || !text || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ id: String(item?.id || crypto.randomUUID()), title, text }];
  });
}

function readStoredConfig(rows: any[]) {
  for (const row of rows) {
    const config = row?.operadoras_info?.unity_inbox_config;
    if (config && typeof config === 'object') return config as Record<string, unknown>;
  }
  return {};
}

function readConfig(rows: any[], profileId: string) {
  const config = readStoredConfig(rows);
  const repliesByProfile = config.quickRepliesByProfile;
  const macrosByProfile = config.macrosByProfile;
  const personalReplies = repliesByProfile && typeof repliesByProfile === 'object'
    ? (repliesByProfile as Record<string, unknown>)[profileId]
    : [];
  const personalMacros = macrosByProfile && typeof macrosByProfile === 'object'
    ? (macrosByProfile as Record<string, unknown>)[profileId]
    : [];

  return {
    labels: mergeUnityDefaultLabels(config.labels),
    quickReplies: sanitizeQuickReplies(personalReplies),
    macros: sanitizeUnityMacros(personalMacros),
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveUnityContext(request);
    if ('response' in context) return context.response;
    const config = readConfig(context.companyRows, context.target.id);
    const companyIds = context.companyRows.map((row: any) => String(row.id));
    const { data: conversations, error: conversationError } = companyIds.length
      ? await supabaseAdmin.from('whatsapp_conversas').select('tags').in('corretor_id', companyIds)
      : { data: [], error: null };
    if (conversationError) throw conversationError;
    const labelUsage = (conversations || []).reduce<Record<string, number>>((counts, conversation: any) => {
      const tags = Array.isArray(conversation.tags)
        ? conversation.tags.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];
      for (const tag of new Set<string>(tags)) {
        const key = tag.toLocaleLowerCase('pt-BR');
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    }, {});
    return NextResponse.json({ ...config, labelUsage }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[unity_inbox_config] GET error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao carregar configuracao.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await resolveUnityContext(request);
    if ('response' in context) return context.response;
    const limited = rateLimit(request, 'inbox:unity-config:update', {
      limit: 60,
      windowMs: 10 * 60_000,
      key: context.target.id,
    });
    if (limited) return limited;
    const body = await request.json().catch(() => ({}));
    const storedConfig = readStoredConfig(context.companyRows);
    const current = readConfig(context.companyRows, context.target.id);
    const labels = body.labels === undefined ? current.labels : sanitizeUnityLabels(body.labels);
    const quickReplies = body.quickReplies === undefined ? current.quickReplies : sanitizeQuickReplies(body.quickReplies);
    const macros = body.macros === undefined ? current.macros : sanitizeUnityMacros(body.macros);
    const storedRepliesByProfile = storedConfig.quickRepliesByProfile && typeof storedConfig.quickRepliesByProfile === 'object'
      ? storedConfig.quickRepliesByProfile as Record<string, unknown>
      : {};
    const quickRepliesByProfile = {
      ...storedRepliesByProfile,
      [context.target.id]: quickReplies,
    };
    const storedMacrosByProfile = storedConfig.macrosByProfile && typeof storedConfig.macrosByProfile === 'object'
      ? storedConfig.macrosByProfile as Record<string, unknown>
      : {};
    const macrosByProfile = {
      ...storedMacrosByProfile,
      [context.target.id]: macros,
    };
    // O formato antigo era coletivo; ele nao pode continuar expondo respostas entre acessos.
    const configWithoutSharedReplies = { ...storedConfig };
    delete configWithoutSharedReplies.quickReplies;

    for (const row of context.companyRows) {
      const operadorasInfo = row.operadoras_info && typeof row.operadoras_info === 'object' ? row.operadoras_info : {};
      const { error } = await supabaseAdmin
        .from('corretores')
        .update({
          operadoras_info: {
            ...operadorasInfo,
            unity_inbox_config: { ...configWithoutSharedReplies, labels, quickRepliesByProfile, macrosByProfile },
          },
        })
        .eq('id', row.id);
      if (error) throw error;
    }

    const renamedLabels = body.labels === undefined
      ? []
      : labels.flatMap((label) => {
          const previous = current.labels.find((item) => item.id === label.id);
          return previous && previous.name !== label.name ? [{ from: previous.name, to: label.name }] : [];
        });
    if (renamedLabels.length) {
      const companyIds = context.companyRows.map((row: any) => String(row.id));
      const { data: taggedConversations, error: taggedError } = await supabaseAdmin
        .from('whatsapp_conversas')
        .select('id,tags')
        .in('corretor_id', companyIds);
      if (taggedError) throw taggedError;
      for (const conversation of taggedConversations || []) {
        const currentTags = Array.isArray(conversation.tags) ? conversation.tags.map(String) : [];
        let changed = false;
        const nextTags = currentTags.map((tag) => {
          const rename = renamedLabels.find((item) => item.from.toLocaleLowerCase('pt-BR') === tag.toLocaleLowerCase('pt-BR'));
          if (!rename) return tag;
          changed = true;
          return rename.to;
        });
        if (changed) {
          const { error: renameError } = await supabaseAdmin
            .from('whatsapp_conversas')
            .update({ tags: nextTags, updated_at: new Date().toISOString() })
            .eq('id', conversation.id);
          if (renameError) throw renameError;
        }
      }
    }

    if (body.conversation_id && Array.isArray(body.tags)) {
      const companyIds = context.companyRows.map((row: any) => String(row.id));
      const tags = Array.from(new Set(body.tags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean))).slice(0, 30);
      const { data: conversation, error: conversationError } = await supabaseAdmin
        .from('whatsapp_conversas')
        .select('id,corretor_id')
        .eq('id', String(body.conversation_id))
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation || !companyIds.includes(String(conversation.corretor_id))) {
        return NextResponse.json({ error: 'Conversa fora da Unity.' }, { status: 403 });
      }
      const { error: tagError } = await supabaseAdmin
        .from('whatsapp_conversas')
        .update({ tags, updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      if (tagError) throw tagError;
    }

    return NextResponse.json({ ok: true, labels, quickReplies, macros });
  } catch (error: any) {
    console.error('[unity_inbox_config] PATCH error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao salvar configuracao.' }, { status: 500 });
  }
}
