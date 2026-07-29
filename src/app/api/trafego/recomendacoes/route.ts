import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { downloadDriveFile, regionFromAdsetName, resolveCreativeForAdset } from '@/lib/integrations/googleDrive';

type DecisionBody = {
  id?: string;
  decisao?: 'aprovar' | 'ignorar';
  confirmar?: boolean;
  gestor_id?: string;
};

type TrafficRecommendationRow = {
  corretor_id: string;
  concessionaria_nome: string | null;
  meta_ad_account_id: string | null;
  nivel: string;
  alvo_id: string | null;
  alvo_nome: string | null;
  metricas: Record<string, unknown> | null;
};

type BrokerNotificationProfile = {
  id: string;
  tipo_usuario: string;
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

function graphUrl(path: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  return `https://graph.facebook.com/${graphVersion}/${path.replace(/^\//, '')}`;
}

async function graphGet(path: string, fields: string) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no servidor.');
  const url = new URL(graphUrl(path));
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', token);
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || 'A Meta recusou a consulta do anuncio.');
  return payload;
}

async function graphPost(path: string, params: Record<string, string>) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no servidor.');
  const response = await fetch(graphUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || 'A Meta recusou a troca do criativo.');
  return payload;
}

async function graphPostForm(path: string, form: FormData) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no servidor.');
  form.append('access_token', token);
  const response = await fetch(graphUrl(path), { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || 'A Meta recusou o upload do criativo.');
  return payload;
}

async function replaceCreativeAutomatically(recommendation: TrafficRecommendationRow) {
  if (!recommendation.alvo_id || recommendation.nivel !== 'anuncio') {
    throw new Error('A troca automatica precisa apontar para um anuncio especifico.');
  }
  const accountId = String(recommendation.meta_ad_account_id || '').replace(/^act_/, '').trim();
  if (!accountId) throw new Error('A recomendacao nao possui uma conta Meta valida.');

  const ad = await graphGet(
    String(recommendation.alvo_id),
    'id,name,adset_id,adset{id,name},creative{id,name,object_story_spec}'
  );
  const adsetId = String(ad.adset_id || ad.adset?.id || '').trim();
  const adset = ad.adset?.name
    ? ad.adset
    : adsetId
      ? await graphGet(adsetId, 'id,name')
      : null;
  const adsetName = String(adset?.name || '').trim();
  if (!adsetName) throw new Error('Nao foi possivel identificar o conjunto deste anuncio na Meta.');

  const originalSpec = ad.creative?.object_story_spec;
  if (!originalSpec || typeof originalSpec !== 'object') {
    throw new Error('O anuncio nao possui uma estrutura de criativo reutilizavel na Meta.');
  }

  const mediaKind: 'image' | 'video' = originalSpec.video_data ? 'video' : 'image';
  const region = regionFromAdsetName(adsetName);
  const resolved = await resolveCreativeForAdset({
    brokerageName: String(recommendation.concessionaria_nome || ''),
    adsetName,
    region,
    mediaKind,
  });
  const content = await downloadDriveFile(resolved.file.id);
  const maxBytes = mediaKind === 'video' ? 200 * 1024 * 1024 : 30 * 1024 * 1024;
  if (content.byteLength > maxBytes) {
    throw new Error(`O criativo "${resolved.file.name}" excede o limite de upload automatico.`);
  }

  const spec = structuredClone(originalSpec);
  if (mediaKind === 'image') {
    const form = new FormData();
    form.append('filename', new Blob([content], { type: resolved.file.mimeType }), resolved.file.name);
    const upload = await graphPostForm(`act_${accountId}/adimages`, form);
    const imageHash = (Object.values(upload.images || {})[0] as { hash?: string } | undefined)?.hash;
    if (!imageHash) throw new Error('A Meta nao retornou o hash da imagem enviada.');
    if (spec.link_data) spec.link_data.image_hash = imageHash;
    else if (spec.photo_data) spec.photo_data.image_hash = imageHash;
    else throw new Error('O formato atual do anuncio nao aceita substituicao automatica por imagem.');
  } else {
    const form = new FormData();
    form.append('source', new Blob([content], { type: resolved.file.mimeType }), resolved.file.name);
    const upload = await graphPostForm(`act_${accountId}/advideos`, form);
    const videoId = String(upload.id || '').trim();
    if (!videoId) throw new Error('A Meta nao retornou o ID do video enviado.');
    if (!spec.video_data) throw new Error('O formato atual do anuncio nao aceita substituicao automatica por video.');
    spec.video_data.video_id = videoId;
  }

  const creative = await graphPost(`act_${accountId}/adcreatives`, {
    name: `${ad.name || recommendation.alvo_nome || 'Anuncio'} | ${resolved.file.name} | Orion Auto`,
    object_story_spec: JSON.stringify(spec),
  });
  const creativeId = String(creative.id || '').trim();
  if (!creativeId) throw new Error('A Meta nao retornou o ID do novo criativo.');

  await graphPost(String(recommendation.alvo_id), {
    creative: JSON.stringify({ creative_id: creativeId }),
  });

  return {
    creative_id: creativeId,
    drive_file_id: resolved.file.id,
    drive_file_name: resolved.file.name,
    drive_path: resolved.path.map((folder) => folder.name),
    adset_id: adsetId,
    adset_name: adsetName,
    region,
  };
}

async function notifyBrokerAdmin(recommendation: TrafficRecommendationRow, senderProfileId: string) {
  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('id', recommendation.corretor_id)
    .maybeSingle();

  const profileQueries = [
    supabaseAdmin
      .from('profiles')
      .select('id, tipo_usuario')
      .eq('corretor_id', recommendation.corretor_id)
      .in('tipo_usuario', ['corretor_admin', 'corretor'])
      .in('status', ['active', 'ativo', 'Ativo']),
  ];
  if (broker?.nome_empresa) {
    profileQueries.push(
      supabaseAdmin
        .from('profiles')
        .select('id, tipo_usuario')
        .eq('nome_empresa', broker.nome_empresa)
        .in('tipo_usuario', ['corretor_admin', 'corretor'])
        .in('status', ['active', 'ativo', 'Ativo'])
    );
  }

  const settled = await Promise.all(profileQueries);
  const profiles = Array.from(new Map(
    settled
      .flatMap((result) => (result.data || []) as BrokerNotificationProfile[])
      .map((profile) => [profile.id, profile] as const)
  ).values());
  const admins = profiles.filter((profile) => profile.tipo_usuario === 'corretor_admin');
  const targets = admins.length ? admins : profiles.filter((profile) => profile.tipo_usuario === 'corretor');
  if (!targets.length) throw new Error('Nao encontrei o perfil do corretor admin para receber o aviso.');

  const saldo = Number(recommendation.metricas?.saldo);
  const semSaldo = Number.isFinite(saldo) && saldo <= 0;
  const titulo = semSaldo ? 'Conta de anuncios sem saldo' : 'Saldo de anuncios ficando baixo';
  const balanceText = Number.isFinite(saldo)
    ? saldo.toLocaleString('pt-BR', { style: 'currency', currency: String(recommendation.metricas?.currency || 'BRL') })
    : 'indisponivel';
  const mensagem = semSaldo
    ? `A conta Meta da ${recommendation.concessionaria_nome || broker?.nome_empresa || broker?.nome} esta sem saldo. Recarregue para retomar a entrega das campanhas.`
    : `O saldo da conta Meta da ${recommendation.concessionaria_nome || broker?.nome_empresa || broker?.nome} esta em ${balanceText}. Recarregue para evitar que as campanhas parem.`;

  const { error } = await supabaseAdmin.from('notificacoes').insert(
    targets.map((profile) => ({
      titulo,
      mensagem,
      remetente_profile_id: senderProfileId,
      destinatario_profile_id: profile.id,
      destinatario_tipo: null,
      lida: false,
    }))
  );
  if (error) throw new Error(error.message);
  return { destinatarios: targets.map((profile) => profile.id), titulo, mensagem };
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

    if (recomendacao.acao === 'trocar_criativo' || recomendacao.acao === 'avisar_admin') {
      try {
        const result = recomendacao.acao === 'trocar_criativo'
          ? await replaceCreativeAutomatically(recomendacao)
          : await notifyBrokerAdmin(recomendacao, guard.profile.id);

        const { data: updated, error } = await supabaseAdmin
          .from('trafego_recomendacoes')
          .update({
            status: 'executada',
            decidido_por: guard.profile.id,
            decidido_em: now,
            executado_em: now,
            execucao_erro: null,
            updated_at: now,
          })
          .eq('id', id)
          .eq('status', 'pendente')
          .select('id');

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!updated?.length) return NextResponse.json({ error: 'Esta recomendacao ja foi decidida.' }, { status: 409 });

        await writeAuditLog({
          profile: guard.profile,
          action: recomendacao.acao === 'trocar_criativo'
            ? 'trafego.meta.criativo_trocado'
            : 'trafego.corretor_admin.notificado',
          entityId: id,
          metadata: {
            alvo_id: recomendacao.alvo_id,
            alvo: recomendacao.alvo_nome,
            concessionaria: recomendacao.concessionaria_nome,
            meta_ad_account_id: recomendacao.meta_ad_account_id,
            resultado: result,
          },
          request,
        });

        return NextResponse.json({
          success: true,
          status: 'executada',
          executada_na_meta: recomendacao.acao === 'trocar_criativo',
          notificacao_enviada: recomendacao.acao === 'avisar_admin',
          resultado: result,
          mensagem: recomendacao.acao === 'trocar_criativo'
            ? `Criativo trocado automaticamente no anuncio "${recomendacao.alvo_nome}".`
            : 'Corretor admin notificado na dashboard sobre o saldo da conta.',
        });
      } catch (executionError: unknown) {
        const message = executionError instanceof Error
          ? executionError.message
          : 'Falha ao executar a recomendacao.';
        await supabaseAdmin
          .from('trafego_recomendacoes')
          .update({
            status: 'erro',
            execucao_erro: message,
            decidido_por: guard.profile.id,
            decidido_em: now,
            updated_at: now,
          })
          .eq('id', id)
          .eq('status', 'pendente');

        await writeAuditLog({
          profile: guard.profile,
          action: 'trafego.recomendacao.execucao_falhou',
          entityId: id,
          metadata: { acao: recomendacao.acao, alvo: recomendacao.alvo_nome, erro: message },
          request,
        });

        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    const pauseLevel = (['campanha', 'conjunto', 'anuncio'] as const).find(
      (level) => recomendacao.nivel === level && recomendacao.acao === PAUSE_ACTION_BY_LEVEL[level]
    ) || null;
    const executavelNaMeta = Boolean(pauseLevel && recomendacao.alvo_id);

    if (!executavelNaMeta) {
      // As revisoes de publico e rastreio continuam manuais porque dependem de
      // diagnostico humano. Criativo e aviso ao admin ja foram tratados acima.
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
