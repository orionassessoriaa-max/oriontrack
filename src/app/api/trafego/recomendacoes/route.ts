import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

type DecisionBody = {
  id?: string;
  decisao?: 'aprovar' | 'ignorar';
  confirmar?: boolean;
  gestor_id?: string;
};

async function requireTrafficAccess(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

async function resolveScopedProfile(profile: any, requestedGestorId?: string | null) {
  if (profile.tipo_usuario !== 'admin' || !requestedGestorId) return profile;

  const { data: gestor } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id')
    .eq('id', requestedGestorId)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();

  return gestor || profile;
}

/**
 * Um gestor so decide sobre concessionaria que e dele. Admin passa direto.
 * Sem essa checagem, o id de uma recomendacao seria suficiente para pausar
 * anuncio de qualquer carteira.
 */
async function assertScope(profile: any, corretorId: string | null, scopedProfile: any) {
  if (profile.tipo_usuario === 'admin' && scopedProfile.id === profile.id) return true;
  if (!corretorId) return false;

  const { data: corretor } = await supabaseAdmin
    .from('corretores')
    .select('id, gestor_trafego_id, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  if (!corretor) return false;
  return isGestorLinkedToConcessionariaCorretor(corretor, scopedProfile);
}

async function writeAuditLog(input: {
  profile: any;
  action: string;
  entityId: string;
  metadata: Record<string, unknown>;
  request: Request;
}) {
  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: input.profile.id,
    actor_email: input.profile.email_real || input.profile.email,
    actor_role: input.profile.tipo_usuario,
    action: input.action,
    entity_type: 'trafego_recomendacao',
    entity_id: input.entityId,
    metadata: input.metadata,
    ip_address: input.request.headers.get('x-forwarded-for') || null,
    user_agent: input.request.headers.get('user-agent') || null,
  });
}

const PAUSE_ACTION_BY_LEVEL = {
  campanha: 'pausar_campanha',
  conjunto: 'pausar_conjunto',
  anuncio: 'pausar_anuncio',
} as const;

type PauseLevel = keyof typeof PAUSE_ACTION_BY_LEVEL;

/** Pausa o item exato na Meta. O ID pode ser de campanha, conjunto ou anuncio. */
async function pauseMetaObject(objectId: string, level: PauseLevel) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no servidor.');

  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${objectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ status: 'PAUSED', access_token: token }).toString(),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.error) {
    const message = String(payload?.error?.message || `Falha ao pausar ${level} na Meta.`);
    const code = String(payload?.error?.code || '');
    if (code === '190') throw new Error('Token Meta expirado ou invalido. Gere um novo token.');
    if (/permission|permiss/i.test(message)) {
      throw new Error('O token Meta nao tem permissao de escrita (ads_management) para pausar este item.');
    }
    throw new Error(message);
  }

  return payload;
}

export async function GET(request: Request) {
  try {
    const guard = await requireTrafficAccess(request);
    if ('error' in guard) return guard.error;

    const url = new URL(request.url);
    const scopedProfile = await resolveScopedProfile(guard.profile, url.searchParams.get('gestor_id'));

    let corretorIds: string[] | null = null;
    if (scopedProfile.tipo_usuario === 'gestor_trafego') {
      const { data: corretores } = await supabaseAdmin
        .from('corretores')
        .select('id, gestor_trafego_id, nome_empresa')
        .not('nome_empresa', 'is', null);

      corretorIds = ((corretores || []) as any[])
        .filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, scopedProfile))
        .map((corretor) => corretor.id);

      if (corretorIds.length === 0) {
        return NextResponse.json({ success: true, recomendacoes: [], analises_hoje: 0, ultima_analise_em: null });
      }
    }

    let query = supabaseAdmin
      .from('trafego_recomendacoes')
      .select('id, corretor_id, concessionaria_nome, meta_ad_account_id, nivel, alvo_id, alvo_nome, acao, severidade, motivo, metricas, status, periodo_inicio, periodo_fim, created_at')
      .eq('status', 'pendente')
      .order('severidade', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(60);

    if (corretorIds) query = query.in('corretor_id', corretorIds);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const todayStart = `${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}T00:00:00.000Z`;
    const { count: analisesHoje } = await supabaseAdmin
      .from('trafego_analises')
      .select('id', { count: 'exact', head: true })
      .eq('gestor_id', scopedProfile.id)
      .gte('created_at', todayStart);

    const { data: ultima } = await supabaseAdmin
      .from('trafego_analises')
      .select('created_at, resumo_ia, periodo_inicio, periodo_fim')
      .eq('gestor_id', scopedProfile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      recomendacoes: data || [],
      analises_hoje: analisesHoje || 0,
      ultima_analise_em: ultima?.created_at || null,
      resumo_ia: ultima?.resumo_ia || '',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar recomendacoes.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'trafego:recomendacoes', { limit: 60, windowMs: 5 * 60_000 });
    if (limited) return limited;

    const guard = await requireTrafficAccess(request);
    if ('error' in guard) return guard.error;

    const body = (await request.json()) as DecisionBody;
    const id = String(body.id || '').trim();
    const decisao = body.decisao;

    if (!id) return NextResponse.json({ error: 'Recomendacao obrigatoria.' }, { status: 400 });
    if (decisao !== 'aprovar' && decisao !== 'ignorar') {
      return NextResponse.json({ error: 'Decisao invalida.' }, { status: 400 });
    }

    const scopedProfile = await resolveScopedProfile(guard.profile, body.gestor_id);

    const { data: recomendacao, error: loadError } = await supabaseAdmin
      .from('trafego_recomendacoes')
      .select('id, corretor_id, concessionaria_nome, meta_ad_account_id, nivel, alvo_id, alvo_nome, acao, severidade, motivo, metricas, status')
      .eq('id', id)
      .maybeSingle();

    if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
    if (!recomendacao) return NextResponse.json({ error: 'Recomendacao nao encontrada.' }, { status: 404 });
    if (recomendacao.status !== 'pendente') {
      return NextResponse.json({ error: 'Esta recomendacao ja foi decidida.' }, { status: 409 });
    }

    const allowed = await assertScope(guard.profile, recomendacao.corretor_id, scopedProfile);
    if (!allowed) {
      return NextResponse.json({ error: 'Esta concessionaria nao esta na sua carteira.' }, { status: 403 });
    }

    const now = new Date().toISOString();

    if (decisao === 'ignorar') {
      const { data: updated, error } = await supabaseAdmin
        .from('trafego_recomendacoes')
        .update({ status: 'ignorada', decidido_por: guard.profile.id, decidido_em: now, updated_at: now })
        .eq('id', id)
        .eq('status', 'pendente')
        .select('id');

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!updated?.length) return NextResponse.json({ error: 'Esta recomendacao ja foi decidida.' }, { status: 409 });

      await writeAuditLog({
        profile: guard.profile,
        action: 'trafego.recomendacao.ignorada',
        entityId: id,
        metadata: { acao: recomendacao.acao, alvo: recomendacao.alvo_nome, concessionaria: recomendacao.concessionaria_nome },
        request,
      });

      return NextResponse.json({ success: true, status: 'ignorada' });
    }

    const pauseLevel = (['campanha', 'conjunto', 'anuncio'] as const).find(
      (level) => recomendacao.nivel === level && recomendacao.acao === PAUSE_ACTION_BY_LEVEL[level]
    ) || null;
    const executavelNaMeta = Boolean(pauseLevel && recomendacao.alvo_id);

    if (!executavelNaMeta) {
      // Trocar criativo, revisar publico, revisar rastreio e avisar admin nao tem
      // equivalente seguro em chamada de API. Viram pendencia de execucao manual.
      const { data: updated, error } = await supabaseAdmin
        .from('trafego_recomendacoes')
        .update({ status: 'aprovada', decidido_por: guard.profile.id, decidido_em: now, updated_at: now })
        .eq('id', id)
        .eq('status', 'pendente')
        .select('id');

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!updated?.length) return NextResponse.json({ error: 'Esta recomendacao ja foi decidida.' }, { status: 409 });

      await writeAuditLog({
        profile: guard.profile,
        action: 'trafego.recomendacao.aprovada_manual',
        entityId: id,
        metadata: { acao: recomendacao.acao, alvo: recomendacao.alvo_nome, concessionaria: recomendacao.concessionaria_nome },
        request,
      });

      return NextResponse.json({
        success: true,
        status: 'aprovada',
        executada_na_meta: false,
        mensagem: 'Aprovada. Esta ação não é executada por API e ficou registrada para execução manual.',
      });
    }

    // Pausa e irreversivel pelo painel: exige confirmacao explicita do gestor.
    if (!body.confirmar) {
      return NextResponse.json({
        error: `Confirmacao obrigatoria para pausar ${pauseLevel} na Meta.`,
        requer_confirmacao: true,
        alvo: recomendacao.alvo_nome,
      }, { status: 428 });
    }

    try {
      await pauseMetaObject(String(recomendacao.alvo_id), pauseLevel as PauseLevel);
    } catch (metaError: any) {
      const message = metaError?.message || `Falha ao pausar ${pauseLevel} na Meta.`;
      await supabaseAdmin
        .from('trafego_recomendacoes')
        .update({ status: 'erro', execucao_erro: message, decidido_por: guard.profile.id, decidido_em: now, updated_at: now })
        .eq('id', id);

      await writeAuditLog({
        profile: guard.profile,
        action: 'trafego.recomendacao.execucao_falhou',
        entityId: id,
        metadata: { acao: recomendacao.acao, alvo_id: recomendacao.alvo_id, alvo: recomendacao.alvo_nome, erro: message },
        request,
      });

      return NextResponse.json({ error: message }, { status: 502 });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('trafego_recomendacoes')
      .update({
        status: 'executada',
        decidido_por: guard.profile.id,
        decidido_em: now,
        executado_em: now,
        updated_at: now,
      })
      .eq('id', id)
      .select('id');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated?.length) return NextResponse.json({ error: 'Esta recomendacao ja foi decidida.' }, { status: 409 });

    await writeAuditLog({
      profile: guard.profile,
      action: 'trafego.meta.item_pausado',
      entityId: id,
      metadata: {
        alvo_id: recomendacao.alvo_id,
        alvo: recomendacao.alvo_nome,
        concessionaria: recomendacao.concessionaria_nome,
        meta_ad_account_id: recomendacao.meta_ad_account_id,
        nivel: pauseLevel,
        motivo: recomendacao.motivo,
        metricas: recomendacao.metricas,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      status: 'executada',
      executada_na_meta: true,
      mensagem: `${pauseLevel === 'campanha' ? 'Campanha' : pauseLevel === 'conjunto' ? 'Conjunto' : 'Anúncio'} "${recomendacao.alvo_nome}" pausado na Meta.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao decidir recomendacao.' }, { status: 500 });
  }
}
