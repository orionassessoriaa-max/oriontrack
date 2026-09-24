import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

const ALLOWED_ROLES = ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'account_manager'] as const;

type UnityLabel = { id: string; name: string; color: string };
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

  if (normalizedCompany(target.nome_empresa) !== 'UNITY SAUDE' || !target.corretor_id) {
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

function sanitizeLabels(value: unknown): UnityLabel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 50).flatMap((item: any) => {
    const name = String(item?.name || '').trim().slice(0, 50);
    const normalized = name.toLocaleLowerCase('pt-BR');
    if (!name || seen.has(normalized)) return [];
    seen.add(normalized);
    const color = /^#[0-9a-f]{6}$/i.test(String(item?.color || '')) ? String(item.color) : '#06b6d4';
    return [{ id: String(item?.id || crypto.randomUUID()), name, color }];
  });
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

function readConfig(rows: any[]) {
  for (const row of rows) {
    const config = row?.operadoras_info?.unity_inbox_config;
    if (config) {
      return {
        labels: sanitizeLabels(config.labels),
        quickReplies: sanitizeQuickReplies(config.quickReplies),
      };
    }
  }
  return { labels: [], quickReplies: [] };
}

export async function GET(request: Request) {
  try {
    const context = await resolveUnityContext(request);
    if ('response' in context) return context.response;
    return NextResponse.json(readConfig(context.companyRows), { headers: { 'Cache-Control': 'no-store' } });
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
    const current = readConfig(context.companyRows);
    const labels = body.labels === undefined ? current.labels : sanitizeLabels(body.labels);
    const quickReplies = body.quickReplies === undefined ? current.quickReplies : sanitizeQuickReplies(body.quickReplies);

    for (const row of context.companyRows) {
      const operadorasInfo = row.operadoras_info && typeof row.operadoras_info === 'object' ? row.operadoras_info : {};
      const { error } = await supabaseAdmin
        .from('corretores')
        .update({ operadoras_info: { ...operadorasInfo, unity_inbox_config: { labels, quickReplies } } })
        .eq('id', row.id);
      if (error) throw error;
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

    return NextResponse.json({ ok: true, labels, quickReplies });
  } catch (error: any) {
    console.error('[unity_inbox_config] PATCH error:', error);
    return NextResponse.json({ error: error?.message || 'Erro ao salvar configuracao.' }, { status: 500 });
  }
}
