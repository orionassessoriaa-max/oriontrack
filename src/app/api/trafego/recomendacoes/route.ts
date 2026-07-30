import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { regionFromAdsetName } from '@/lib/integrations/googleDrive';

type DecisionBody = {
  id?: string;
  decisao?: 'aprovar' | 'ignorar';
  confirmar?: boolean;
  gestor_id?: string;
  acao_execucao?: 'ativar_troca';
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

type CreativeLibraryAsset = {
  id: string;
  corretor_id: string;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  arquivo_path: string | null;
  status: string;
  created_at: string;
  operadora: string | null;
  regiao: string | null;
  headline: string | null;
  legenda: string | null;
};

class EmptyCreativeFolderError extends Error {
  constructor(
    message: string,
    public readonly offer: { corretor_id: string; operadora: string; regiao: string; quantidade: number },
  ) {
    super(message);
    this.name = 'EmptyCreativeFolderError';
  }
}

type PreparedCreativeSwap = {
  old_ad_id: string;
  old_ad_name: string;
  new_ad_id: string;
  new_ad_name: string;
  creative_id: string;
  asset_id: string;
  asset_name: string;
  asset_url: string | null;
  adset_id: string;
  adset_name: string;
  region: string | null;
  created_at: string;
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

function normalizeSearchText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function fileNameFromAsset(asset: CreativeLibraryAsset) {
  const source = asset.arquivo_path || asset.arquivo_url || asset.titulo || 'criativo.png';
  const raw = source.split('?')[0].split('/').pop() || 'criativo.png';
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'criativo.png';
}

function mimeTypeFromName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'png') return 'image/png';
  return '';
}

function isImageAsset(asset: CreativeLibraryAsset) {
  return Boolean(mimeTypeFromName(fileNameFromAsset(asset)));
}

async function resolveLibraryCreative(recommendation: TrafficRecommendationRow, adsetName: string) {
  const { data: broker, error: brokerError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa')
    .eq('id', recommendation.corretor_id)
    .maybeSingle();
  if (brokerError) throw new Error(brokerError.message);

  const concessionaria = String(
    broker?.nome_empresa || recommendation.concessionaria_nome || ''
  ).trim();
  if (!broker || !concessionaria) {
    throw new Error('Pasta da concessionaria nao encontrada na biblioteca de criativos do CRM.');
  }

  const { data: folderBrokers, error: folderError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa')
    .not('nome_empresa', 'is', null);
  if (folderError) throw new Error(folderError.message);

  const folderKey = normalizeSearchText(concessionaria).replace(/[^a-z0-9]/g, '');
  const corretorIds = Array.from(new Set(
    [
      broker.id,
      ...(folderBrokers || [])
        .filter((item) => normalizeSearchText(item.nome_empresa).replace(/[^a-z0-9]/g, '') === folderKey)
        .map((item) => item.id),
    ].filter(Boolean)
  ));
  const { data: strategies, error: strategyError } = await supabaseAdmin
    .from('trafego_estrategias_criativos')
    .select('operadora, regiao')
    .eq('corretor_id', recommendation.corretor_id)
    .eq('ativa', true);
  if (strategyError) throw new Error(strategyError.message);
  const adsetText = normalizeSearchText(adsetName);
  const detectedRegion = regionFromAdsetName(adsetName);
  const regionText = normalizeSearchText(detectedRegion);
  const matchingStrategies = (strategies || []).filter((item) => {
    const operatorMatches = adsetText.includes(normalizeSearchText(item.operadora));
    const strategyRegion = normalizeSearchText(item.regiao);
    const regionMatches = regionText ? strategyRegion === regionText : adsetText.includes(strategyRegion);
    return operatorMatches && regionMatches;
  });
  const regionStrategies = (strategies || []).filter((item) => {
    const strategyRegion = normalizeSearchText(item.regiao);
    return regionText ? strategyRegion === regionText : adsetText.includes(strategyRegion);
  });
  const strategy = matchingStrategies[0]
    || (regionStrategies.length === 1 ? regionStrategies[0] : null)
    || ((strategies || []).length === 1 ? strategies![0] : null);
  if (!strategy) {
    throw new Error(`Nao foi possivel identificar com seguranca a operadora e a regiao do conjunto "${adsetName}". Cadastre essa combinacao na Entrada.`);
  }

  const { data: assets, error: assetsError } = await supabaseAdmin
    .from('criativo_assets')
    .select('id, corretor_id, titulo, descricao, arquivo_url, arquivo_path, status, created_at, operadora, regiao, headline, legenda')
    .in('corretor_id', corretorIds)
    .order('created_at', { ascending: false })
    .limit(500);
  if (assetsError) throw new Error(assetsError.message);

  const imageAssets = ((assets || []) as CreativeLibraryAsset[])
    .filter((asset) =>
      (asset.arquivo_path || asset.arquivo_url)
      && isImageAsset(asset)
      && normalizeSearchText(asset.operadora) === normalizeSearchText(strategy.operadora)
      && normalizeSearchText(asset.regiao) === normalizeSearchText(strategy.regiao)
    );
  if (!imageAssets.length) {
    throw new EmptyCreativeFolderError(
      `Não existem mais criativos de ${strategy.operadora}/${strategy.regiao}. Deseja que eu crie novos?`,
      { corretor_id: recommendation.corretor_id, operadora: strategy.operadora, regiao: strategy.regiao, quantidade: 4 },
    );
  }

  const adsetWords = normalizeSearchText(adsetName)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  const scored = imageAssets.map((asset, index) => {
    const searchable = normalizeSearchText(
      `${asset.titulo} ${asset.descricao || ''} ${asset.arquivo_path || ''}`
    );
    const regionScore = regionText && searchable.includes(regionText) ? 100 : 0;
    const adsetScore = adsetWords.filter((word) => searchable.includes(word)).length * 5;
    return { asset, score: regionScore + adsetScore - index / 1000 };
  });
  scored.sort((a, b) => b.score - a.score);

  return { asset: scored[0].asset, concessionaria, region: strategy.regiao, operadora: strategy.operadora };
}

async function downloadLibraryAsset(asset: CreativeLibraryAsset) {
  if (asset.arquivo_path) {
    const { data, error } = await supabaseAdmin.storage.from('criativos').download(asset.arquivo_path);
    if (!error && data) {
      return {
        bytes: await data.arrayBuffer(),
        mimeType: data.type || mimeTypeFromName(fileNameFromAsset(asset)),
      };
    }
  }

  if (!asset.arquivo_url) {
    throw new Error(`O criativo "${asset.titulo}" nao possui arquivo disponivel.`);
  }
  const response = await fetch(asset.arquivo_url);
  if (!response.ok) {
    throw new Error(`Nao foi possivel baixar o criativo "${asset.titulo}" da biblioteca do CRM.`);
  }
  return {
    bytes: await response.arrayBuffer(),
    mimeType: response.headers.get('content-type') || mimeTypeFromName(fileNameFromAsset(asset)),
  };
}

async function prepareCreativeReplacement(recommendation: TrafficRecommendationRow): Promise<PreparedCreativeSwap> {
  if (!recommendation.alvo_id || recommendation.nivel !== 'anuncio') {
    throw new Error('A troca automatica precisa apontar para um anuncio especifico.');
  }
  const accountId = String(recommendation.meta_ad_account_id || '').replace(/^act_/, '').trim();
  if (!accountId) throw new Error('A recomendacao nao possui uma conta Meta valida.');

  const ad = await graphGet(
    String(recommendation.alvo_id),
    'id,name,adset_id,adset{id,name},creative{id,name,object_story_spec},tracking_specs,url_tags,conversion_domain'
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

  const { asset, region } = await resolveLibraryCreative(recommendation, adsetName);
  const content = await downloadLibraryAsset(asset);
  if (content.bytes.byteLength > 30 * 1024 * 1024) {
    throw new Error(`O criativo "${asset.titulo}" excede o limite de 30 MB para upload automatico.`);
  }

  const spec = structuredClone(originalSpec);
  const fileName = fileNameFromAsset(asset);
  const mimeType = content.mimeType || mimeTypeFromName(fileName);
  if (!mimeType.startsWith('image/')) {
    throw new Error(`O arquivo "${asset.titulo}" nao e uma imagem valida.`);
  }
  const form = new FormData();
  form.append('filename', new Blob([content.bytes], { type: mimeType }), fileName);
  const upload = await graphPostForm(`act_${accountId}/adimages`, form);
  const imageHash = (Object.values(upload.images || {})[0] as { hash?: string } | undefined)?.hash;
  if (!imageHash) throw new Error('A Meta nao retornou o hash da imagem enviada.');
  if (spec.link_data) spec.link_data.image_hash = imageHash;
  else if (spec.photo_data) spec.photo_data.image_hash = imageHash;
  else throw new Error('O formato atual do anuncio nao aceita substituicao automatica por imagem.');
  if (spec.link_data) {
    if (asset.headline) spec.link_data.name = asset.headline;
    if (asset.legenda) spec.link_data.message = asset.legenda;
  }

  const creative = await graphPost(`act_${accountId}/adcreatives`, {
    name: `${ad.name || recommendation.alvo_nome || 'Anuncio'} | ${asset.titulo} | Orion`,
    object_story_spec: JSON.stringify(spec),
  });
  const creativeId = String(creative.id || '').trim();
  if (!creativeId) throw new Error('A Meta nao retornou o ID do novo criativo.');

  const newAdName = `${ad.name || recommendation.alvo_nome || 'Anuncio'} | ${asset.titulo} | Orion`;
  const adParams: Record<string, string> = {
    name: newAdName,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'PAUSED',
  };
  if (ad.tracking_specs) adParams.tracking_specs = JSON.stringify(ad.tracking_specs);
  if (ad.url_tags) adParams.url_tags = String(ad.url_tags);
  if (ad.conversion_domain) adParams.conversion_domain = String(ad.conversion_domain);

  const newAd = await graphPost(`act_${accountId}/ads`, adParams);
  const newAdId = String(newAd.id || '').trim();
  if (!newAdId) throw new Error('A Meta nao retornou o ID do novo anuncio.');

  return {
    old_ad_id: String(recommendation.alvo_id),
    old_ad_name: String(ad.name || recommendation.alvo_nome || 'Anuncio anterior'),
    new_ad_id: newAdId,
    new_ad_name: newAdName,
    creative_id: creativeId,
    asset_id: asset.id,
    asset_name: asset.titulo,
    asset_url: asset.arquivo_url,
    adset_id: adsetId,
    adset_name: adsetName,
    region,
    created_at: new Date().toISOString(),
  };
}

function readPreparedSwap(metricas: Record<string, unknown> | null): PreparedCreativeSwap | null {
  const value = metricas?.troca_criativo;
  if (!value || typeof value !== 'object') return null;
  const swap = value as Partial<PreparedCreativeSwap>;
  if (!swap.old_ad_id || !swap.new_ad_id) return null;
  return swap as PreparedCreativeSwap;
}

async function activatePreparedSwap(swap: PreparedCreativeSwap) {
  await graphPost(swap.new_ad_id, { status: 'ACTIVE' });
  try {
    await pauseMetaObject(swap.old_ad_id, 'anuncio');
  } catch (pauseError) {
    try {
      await graphPost(swap.new_ad_id, { status: 'PAUSED' });
    } catch (rollbackError) {
      const pauseMessage = pauseError instanceof Error ? pauseError.message : 'Falha ao pausar o anuncio anterior.';
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'Falha no rollback.';
      throw new Error(
        `ATENCAO: o novo anuncio foi ativado, mas o anterior nao foi pausado e o rollback falhou. ` +
        `Verifique a Meta imediatamente. Pausa: ${pauseMessage} Rollback: ${rollbackMessage}`
      );
    }
    const message = pauseError instanceof Error ? pauseError.message : 'Falha ao pausar o anuncio anterior.';
    throw new Error(`O novo anuncio voltou para pausado porque o anterior nao pode ser pausado: ${message}`);
  }
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
      .in('status', ['pendente', 'aprovada'])
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
    const allowed = await assertScope(guard.profile, recomendacao.corretor_id, scopedProfile);
    if (!allowed) {
      return NextResponse.json({ error: 'Esta concessionaria nao esta na sua carteira.' }, { status: 403 });
    }

    const now = new Date().toISOString();

    if (body.acao_execucao === 'ativar_troca') {
      if (
        decisao !== 'aprovar' ||
        recomendacao.status !== 'aprovada' ||
        recomendacao.acao !== 'trocar_criativo'
      ) {
        return NextResponse.json({ error: 'Esta troca nao esta aguardando ativacao.' }, { status: 409 });
      }
      if (!body.confirmar) {
        return NextResponse.json({ requer_confirmacao: true }, { status: 428 });
      }

      const swap = readPreparedSwap(recomendacao.metricas);
      if (!swap) {
        return NextResponse.json({ error: 'Os dados do novo anuncio nao foram encontrados.' }, { status: 409 });
      }

      try {
        await activatePreparedSwap(swap);
        const { data: updated, error } = await supabaseAdmin
          .from('trafego_recomendacoes')
          .update({
            status: 'executada',
            executado_em: now,
            execucao_erro: null,
            updated_at: now,
          })
          .eq('id', id)
          .eq('status', 'aprovada')
          .select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!updated?.length) {
          return NextResponse.json({ error: 'Esta troca ja foi ativada.' }, { status: 409 });
        }

        await writeAuditLog({
          profile: guard.profile,
          action: 'trafego.meta.troca_criativo.ativada',
          entityId: id,
          metadata: {
            concessionaria: recomendacao.concessionaria_nome,
            old_ad_id: swap.old_ad_id,
            new_ad_id: swap.new_ad_id,
            asset_id: swap.asset_id,
          },
          request,
        });

        return NextResponse.json({
          success: true,
          status: 'executada',
          mensagem: 'Novo anuncio ativado e anuncio anterior pausado com sucesso.',
          resultado: swap,
        });
      } catch (executionError: unknown) {
        const message = executionError instanceof Error
          ? executionError.message
          : 'Falha ao ativar a troca de criativo.';
        await supabaseAdmin
          .from('trafego_recomendacoes')
          .update({ execucao_erro: message, updated_at: now })
          .eq('id', id)
          .eq('status', 'aprovada');
        await writeAuditLog({
          profile: guard.profile,
          action: 'trafego.meta.troca_criativo.ativacao_falhou',
          entityId: id,
          metadata: { erro: message, old_ad_id: swap.old_ad_id, new_ad_id: swap.new_ad_id },
          request,
        });
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    if (recomendacao.status !== 'pendente') {
      return NextResponse.json({ error: 'Esta recomendacao ja foi decidida.' }, { status: 409 });
    }

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

    if (recomendacao.acao === 'trocar_criativo') {
      try {
        const result = await prepareCreativeReplacement(recomendacao);
        const nextMetrics = {
          ...(recomendacao.metricas || {}),
          troca_criativo: result,
        };

        const { data: updated, error } = await supabaseAdmin
          .from('trafego_recomendacoes')
          .update({
            status: 'aprovada',
            decidido_por: guard.profile.id,
            decidido_em: now,
            metricas: nextMetrics,
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
          action: 'trafego.meta.troca_criativo.preparada',
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
          status: 'aprovada',
          requer_ativacao: true,
          resultado: result,
          mensagem: `Novo anuncio "${result.new_ad_name}" criado pausado. Revise e clique em Ativar.`,
        });
      } catch (executionError: unknown) {
        if (executionError instanceof EmptyCreativeFolderError) {
          return NextResponse.json({
            error: executionError.message,
            requires_creative_generation: true,
            offer: {
              ...executionError.offer,
              recommendation_id: id,
            },
          }, { status: 428 });
        }
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

    if (recomendacao.acao === 'avisar_admin') {
      try {
        const result = await notifyBrokerAdmin(recomendacao, guard.profile.id);
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
        if (!updated?.length) {
          return NextResponse.json({ error: 'Esta recomendacao ja foi decidida.' }, { status: 409 });
        }

        await writeAuditLog({
          profile: guard.profile,
          action: 'trafego.corretor_admin.notificado',
          entityId: id,
          metadata: {
            alvo_id: recomendacao.alvo_id,
            alvo: recomendacao.alvo_nome,
            concessionaria: recomendacao.concessionaria_nome,
            resultado: result,
          },
          request,
        });
        return NextResponse.json({
          success: true,
          status: 'executada',
          notificacao_enviada: true,
          resultado: result,
          mensagem: 'Corretor admin notificado na dashboard sobre o saldo da conta.',
        });
      } catch (executionError: unknown) {
        const message = executionError instanceof Error
          ? executionError.message
          : 'Falha ao notificar o corretor admin.';
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
