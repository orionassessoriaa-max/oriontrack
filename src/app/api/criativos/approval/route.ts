import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit, writeAuditLog, type ApiProfile } from '@/lib/api/security';
import { canUseCreativeFolder } from '@/lib/creatives/access';
import { supabaseAdmin } from '@/lib/supabase/admin';

const CLIENT_ROLES = ['corretor', 'corretor_admin', 'corretor_membro'] as const;
const READ_ROLES = ['admin', ...CLIENT_ROLES] as const;
const SEND_ROLES = ['admin', 'gestor_trafego', 'designer'] as const;

function clean(value: unknown, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function validUuid(value: unknown) {
  const normalized = clean(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

async function companyScope(corretorId: string) {
  const { data: base, error } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();
  if (error) throw error;
  if (!base) return null;

  let ids = [base.id];
  const company = clean(base.nome_empresa);
  if (company) {
    const { data: peers, error: peersError } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', company);
    if (peersError) throw peersError;
    ids = (peers || []).map((item) => item.id);
  }
  return { base, ids };
}

async function resolveCorretorId(profile: ApiProfile) {
  if (profile.corretor_id) return profile.corretor_id;
  const emails = [profile.email_real, profile.email]
    .map((email) => clean(email, 200).toLowerCase())
    .filter(Boolean);
  if (!emails.length) return null;
  const { data } = await supabaseAdmin
    .from('corretores')
    .select('id')
    .in('email', emails)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function designerCanUseCorretor(profile: ApiProfile, corretorId: string) {
  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('time_operacional')
    .eq('id', corretorId)
    .maybeSingle();
  if (error || !data) return false;
  if (!Array.isArray(data.time_operacional)) return true;
  return data.time_operacional.some((member) => {
    if (!member || typeof member !== 'object') return false;
    const item = member as { profile_id?: string; id?: string };
    return item.profile_id === profile.id || item.id === profile.id;
  });
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...READ_ROLES]);
  if ('error' in guard) return guard.error;
  try {
    const requested = validUuid(new URL(request.url).searchParams.get('corretor_id'));
    const corretorId = guard.profile.tipo_usuario === 'admin'
      ? requested
      : await resolveCorretorId(guard.profile);
    if (!corretorId) {
      return NextResponse.json({ error: 'Corretor nao identificado.' }, { status: 400 });
    }
    const scope = await companyScope(corretorId);
    if (!scope) return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });

    const { data, error } = await supabaseAdmin
      .from('criativo_assets')
      .select('id, demanda_id, corretor_id, titulo, descricao, arquivo_url, status, comentario_corretor, created_at')
      .in('corretor_id', scope.ids)
      .in('status', ['em_aprovacao', 'aprovado', 'revisao', 'rodando'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({
      assets: data || [],
      concessionaria: scope.base.nome_empresa || scope.base.nome,
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao carregar materiais para aprovacao.',
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, [...SEND_ROLES]);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'criativos:approval:send', {
    limit: 60,
    windowMs: 10 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const assetId = validUuid(body.asset_id);
    const gestorId = validUuid(body.gestor_id);
    if (!assetId) return NextResponse.json({ error: 'Criativo invalido.' }, { status: 400 });

    const { data: asset, error } = await supabaseAdmin
      .from('criativo_assets')
      .select('id, demanda_id, corretor_id, titulo, status')
      .eq('id', assetId)
      .maybeSingle();
    if (error) throw error;
    if (!asset?.corretor_id) return NextResponse.json({ error: 'Criativo nao encontrado.' }, { status: 404 });

    const allowed = guard.profile.tipo_usuario === 'admin'
      || (guard.profile.tipo_usuario === 'gestor_trafego'
        && await canUseCreativeFolder(guard.profile, asset.corretor_id, gestorId))
      || (guard.profile.tipo_usuario === 'designer'
        && await designerCanUseCorretor(guard.profile, asset.corretor_id));
    if (!allowed) return NextResponse.json({ error: 'Criativo fora do seu escopo.' }, { status: 403 });

    const updatedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('criativo_assets')
      .update({ status: 'em_aprovacao', comentario_corretor: null, updated_at: updatedAt })
      .eq('id', asset.id)
      .in('status', ['rascunho', 'revisao', 'em_aprovacao'])
      .select('id, status, updated_at')
      .maybeSingle();
    if (updateError) throw updateError;
    if (asset.demanda_id) {
      await supabaseAdmin
        .from('criativo_demandas')
        .update({ status: 'entregue', updated_at: updatedAt })
        .eq('id', asset.demanda_id);
    }
    await writeAuditLog(request, guard.profile, {
      action: 'creative.send_for_approval',
      entity_type: 'criativo_asset',
      entity_id: asset.id,
      metadata: { corretor_id: asset.corretor_id },
    });
    return NextResponse.json({ success: true, asset: updated || { id: asset.id, status: 'em_aprovacao' } });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao enviar para aprovacao.',
    }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = await requireApiUser(request, [...READ_ROLES]);
  if ('error' in guard) return guard.error;
  try {
    const body = await request.json().catch(() => ({}));
    const assetId = validUuid(body.asset_id);
    const requested = validUuid(body.corretor_id);
    const status = clean(body.status, 30);
    const comentario = clean(body.comentario, 2000);
    if (!assetId || !['aprovado', 'revisao'].includes(status)) {
      return NextResponse.json({ error: 'Dados de aprovacao invalidos.' }, { status: 400 });
    }
    const corretorId = guard.profile.tipo_usuario === 'admin' ? requested : guard.profile.corretor_id;
    if (!corretorId) return NextResponse.json({ error: 'Corretor nao identificado.' }, { status: 400 });
    const scope = await companyScope(corretorId);
    if (!scope) return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });

    const { data: asset, error } = await supabaseAdmin
      .from('criativo_assets')
      .select('id, demanda_id, corretor_id')
      .eq('id', assetId)
      .in('corretor_id', scope.ids)
      .maybeSingle();
    if (error) throw error;
    if (!asset) return NextResponse.json({ error: 'Criativo fora desta concessionaria.' }, { status: 403 });

    const updatedAt = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('criativo_assets')
      .update({
        status,
        comentario_corretor: status === 'revisao' ? comentario || null : null,
        updated_at: updatedAt,
      })
      .eq('id', asset.id);
    if (updateError) throw updateError;
    if (asset.demanda_id) {
      await supabaseAdmin
        .from('criativo_demandas')
        .update({ status, updated_at: updatedAt })
        .eq('id', asset.demanda_id);
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao registrar aprovacao.',
    }, { status: 500 });
  }
}
