import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { downloadDriveFile, getDriveFile } from '@/lib/integrations/googleDrive';
import { normalizeOptimizationDraft } from '@/lib/trafego/optimizationDraft';

type MetaAccount = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  nome_empresa: string | null;
  meta_ad_account_id: string | null;
};

const KRIPTO_PRINCIPAL_ACCOUNT_ID = '1531044161152262';

function normalizeAccountId(value?: string | null) {
  return String(value || '').replace(/^act_/, '').trim();
}

async function guard(request: Request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !user) return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin.from('profiles').select('id, nome, email, email_real, tipo_usuario').eq('id', user.id).maybeSingle();
  if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }
  return { profile };
}

async function allowedAccount(profile: any, accountId: string, equipe?: string | null, gestorId?: string | null) {
  if (equipe === 'kripto_hunters' && accountId === KRIPTO_PRINCIPAL_ACCOUNT_ID) {
    const { data } = await supabaseAdmin.from('meta_ad_accounts').select('id, meta_account_id, nome').eq('meta_account_id', KRIPTO_PRINCIPAL_ACCOUNT_ID).maybeSingle();
    if (data) return { id: String(data.id), nome: data.nome || 'CA - Orion Conta Principal', gestor_trafego_id: null, nome_empresa: data.nome, meta_ad_account_id: data.meta_account_id } as MetaAccount;
  }

  let scopedProfile = profile;
  if (profile.tipo_usuario === 'admin' && gestorId) {
    const { data } = await supabaseAdmin.from('profiles').select('id, nome, email, email_real, tipo_usuario').eq('id', gestorId).eq('tipo_usuario', 'gestor_trafego').maybeSingle();
    if (data) scopedProfile = data;
  }

  const { data, error } = await supabaseAdmin.from('corretores')
    .select('id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name, time_operacional')
    .not('nome_empresa', 'is', null).order('nome', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data || []) as any[];
  const visible = scopedProfile.tipo_usuario === 'gestor_trafego'
    ? rows.filter((row) => isGestorLinkedToConcessionariaCorretor(row, scopedProfile))
    : rows;
  return (visible.find((row) => normalizeAccountId(row.meta_ad_account_id) === accountId) || null) as MetaAccount | null;
}

function graphUrl(path: string) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  return `https://graph.facebook.com/${version}/${path.replace(/^\//, '')}`;
}

function metaErrorMessage(json: any, fallback: string) {
  const error = json?.error;
  if (!error) return fallback;
  const detail = String(error.error_user_msg || error.message || fallback).trim();
  const title = String(error.error_user_title || '').trim();
  const reference = [error.code ? `codigo ${error.code}` : '', error.error_subcode ? `subcodigo ${error.error_subcode}` : '']
    .filter(Boolean)
    .join(', ');
  return `${title ? `${title}: ` : ''}${detail}${reference ? ` (${reference})` : ''}`;
}

async function graphPost(path: string, params: Record<string, string>, operation = 'operacao') {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no ambiente da aplicacao.');
  const body = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(graphUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(`A Meta recusou ${operation}. ${metaErrorMessage(json, `Erro HTTP ${response.status}.`)}`);
  }
  return json;
}

async function graphPostForm(path: string, form: FormData, operation = 'o upload do criativo') {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no ambiente da aplicacao.');
  form.append('access_token', token);
  const response = await fetch(graphUrl(path), { method: 'POST', body: form });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(`A Meta recusou ${operation}. ${metaErrorMessage(json, `Erro HTTP ${response.status}.`)}`);
  }
  return json;
}

async function graphGet(path: string, params: Record<string, string> = {}) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no ambiente da aplicacao.');
  const url = new URL(graphUrl(path));
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('access_token', token);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(`A Meta recusou a leitura da estrutura existente. ${metaErrorMessage(json, `Erro HTTP ${response.status}.`)}`);
  }
  return json;
}

async function existingAdsetCreativeConfig(adsetId: string) {
  const payload = await graphGet(`${adsetId}/ads`, {
    fields: 'creative{object_story_spec}',
    limit: '25',
  });
  for (const item of Array.isArray(payload.data) ? payload.data : []) {
    const spec = item?.creative?.object_story_spec || {};
    const linkData = spec.link_data || {};
    const link = String(
      linkData.link
      || linkData.call_to_action?.value?.link
      || ''
    ).trim();
    const pageId = String(spec.page_id || '').trim();
    if (pageId && link) return { pageId, link };
  }
  return { pageId: '', link: '' };
}

function normalizeCallToAction(value: unknown) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  const aliases: Record<string, string> = {
    SAIBA_MAIS: 'LEARN_MORE',
    FALE_CONOSCO: 'CONTACT_US',
    SOLICITAR_COTACAO: 'GET_QUOTE',
    CADASTRE_SE: 'SIGN_UP',
  };
  const resolved = aliases[normalized] || normalized;
  return ['LEARN_MORE', 'CONTACT_US', 'GET_QUOTE', 'SIGN_UP'].includes(resolved)
    ? resolved
    : 'LEARN_MORE';
}

function moneyToCents(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  const raw = String(value ?? '').replace(/[^0-9,.-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.');
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

function jsonObject(value: unknown, fallback: Record<string, unknown>) {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* use fallback */ }
  }
  return fallback;
}

type AdsetDeliveryConfig = {
  optimizationGoal: string;
  billingEvent: string;
  promotedObject: Record<string, unknown> | null;
  destinationType: string;
  sourceName: string;
};

async function existingAdsetDeliveryConfig(accountPath: string, requestedGoal: string) {
  const payload = await graphGet(`${accountPath}/adsets`, {
    fields: 'id,name,optimization_goal,billing_event,promoted_object,destination_type,updated_time',
    limit: '200',
  });
  const candidates = (Array.isArray(payload.data) ? payload.data : [])
    .filter((item: any) => item?.promoted_object && Object.keys(item.promoted_object).length > 0)
    .sort((left: any, right: any) => String(right.updated_time || '').localeCompare(String(left.updated_time || '')));
  const source = candidates.find((item: any) => String(item.optimization_goal || '') === requestedGoal) || candidates[0];
  if (!source) return null;
  return {
    optimizationGoal: String(source.optimization_goal || requestedGoal || 'LEAD_GENERATION'),
    billingEvent: String(source.billing_event || 'IMPRESSIONS'),
    promotedObject: jsonObject(source.promoted_object, {}),
    destinationType: String(source.destination_type || ''),
    sourceName: String(source.name || source.id || 'conjunto existente'),
  } satisfies AdsetDeliveryConfig;
}

type CreativeSource = {
  bytes: Buffer;
  mime: string;
  name: string;
  origin: 'drive' | 'upload';
};

const IMAGE_LIMIT_BYTES = 30 * 1024 * 1024;
const VIDEO_LIMIT_BYTES = 200 * 1024 * 1024;
const VIDEO_READY_TIMEOUT_MS = 150_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Criativo enviado pela tela vive no Storage publico do Supabase. Buscar
 * qualquer URL aqui seria SSRF, entao so o host do proprio projeto passa.
 */
function isAllowedUploadUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const supabaseHost = new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || '')).host;
    return Boolean(supabaseHost) && url.host === supabaseHost;
  } catch {
    return false;
  }
}

/**
 * O criativo pode chegar de duas portas: Google Drive, como sempre foi, ou
 * upload direto feito na tela. As duas continuam valendo.
 */
async function resolveCreativeSource(ad: any, draft: any): Promise<CreativeSource | null> {
  const driveFileId = String(ad?.drive_file_id || '').trim();
  if (driveFileId) {
    const driveFile = await getDriveFile(driveFileId);
    const bytes = await downloadDriveFile(driveFile.id);
    return { bytes, mime: driveFile.mimeType, name: driveFile.name, origin: 'drive' };
  }

  const uploadUrl = String(ad?.upload_url || ad?.file_url || draft?.upload_url || '').trim();
  if (!uploadUrl) return null;
  if (!isAllowedUploadUrl(uploadUrl)) {
    throw new Error('O criativo enviado nao esta no armazenamento da Orion. Reenvie o arquivo pela tela.');
  }
  const response = await fetch(uploadUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('Nao consegui baixar o criativo enviado pela tela.');
  const bytes = Buffer.from(await response.arrayBuffer());
  const mime = String(ad?.upload_mime || ad?.file_type || response.headers.get('content-type') || '').split(';')[0].trim();
  const name = String(ad?.upload_name || ad?.file_name || uploadUrl.split('/').pop() || 'criativo').slice(0, 120);
  return { bytes, mime, name, origin: 'upload' };
}

async function uploadImageHash(accountPath: string, source: CreativeSource) {
  const form = new FormData();
  form.append('filename', new Blob([new Uint8Array(source.bytes)], { type: source.mime }), source.name);
  const result = await graphPostForm(`${accountPath}/adimages`, form, `o upload da imagem "${source.name}"`);
  const uploaded = Object.values(result.images || {})[0] as { hash?: string } | undefined;
  return String(uploaded?.hash || '');
}

/**
 * Video na Meta e assincrono: sobe, processa e so depois pode virar criativo.
 * Sem esperar o "ready" a criacao do anuncio falha com erro generico.
 */
async function uploadVideoId(accountPath: string, source: CreativeSource) {
  const form = new FormData();
  form.append('source', new Blob([new Uint8Array(source.bytes)], { type: source.mime }), source.name);
  form.append('name', source.name);
  const result = await graphPostForm(`${accountPath}/advideos`, form, `o upload do video "${source.name}"`);
  const videoId = String(result.id || '');
  if (!videoId) throw new Error('A Meta nao retornou o id do video enviado.');

  const deadline = Date.now() + VIDEO_READY_TIMEOUT_MS;
  let lastStatus = 'processing';
  while (Date.now() < deadline) {
    const status = await graphGet(videoId, { fields: 'status' });
    lastStatus = String(status?.status?.video_status || 'processing');
    if (lastStatus === 'ready') break;
    if (lastStatus === 'error') throw new Error(`A Meta recusou o video "${source.name}" no processamento.`);
    await wait(VIDEO_POLL_INTERVAL_MS);
  }
  if (lastStatus !== 'ready') {
    throw new Error(`O video "${source.name}" ainda esta processando na Meta. Tente publicar de novo em alguns minutos.`);
  }

  // A Meta exige capa no criativo de video. A propria plataforma gera as
  // miniaturas durante o processamento.
  let thumbnailUrl = '';
  try {
    const thumbs = await graphGet(`${videoId}/thumbnails`, { fields: 'uri,is_preferred' });
    const list: Array<{ uri?: string; is_preferred?: boolean }> = Array.isArray(thumbs?.data) ? thumbs.data : [];
    thumbnailUrl = String((list.find((item) => item?.is_preferred) || list[0])?.uri || '');
  } catch {
    thumbnailUrl = '';
  }
  return { videoId, thumbnailUrl };
}

async function createPaused(accountId: string, draft: any) {
  const normalizedDraft = normalizeOptimizationDraft(draft);
  const created: any[] = [];
  const skipped: any[] = [];
  const warnings: string[] = [];
  const accountPath = `act_${accountId}`;
  const campaign = normalizedDraft.campaign;
  const existingCampaignId = String(campaign.existing_id || '').trim();
  let campaignId = existingCampaignId;
  if (!campaignId) {
    const campaignResult = await graphPost(`${accountPath}/campaigns`, {
      name: String(campaign.name),
      objective: String(campaign.objective),
      buying_type: String(campaign.buying_type),
      status: 'PAUSED',
      special_ad_categories: JSON.stringify(campaign.special_ad_categories || []),
      // Obrigatorio na API Meta atual para campanhas sem orcamento no nivel
      // da campanha. O fluxo Orion usa ABO e mantem a verba no conjunto.
      is_adset_budget_sharing_enabled: String(campaign.is_adset_budget_sharing_enabled ?? false),
    }, 'a criacao da campanha pausada');
    campaignId = String(campaignResult.id);
    created.push({ level: 'campaign', id: campaignId, name: String(campaign.name || campaignResult.id), status: 'PAUSED' });
  } else {
    warnings.push(`A campanha existente "${String(campaign.name)}" sera usada somente como destino. Ela nao foi alterada.`);
  }

  const availableAdsetIds: string[] = [];
  const adsets = normalizedDraft.adsets;
  let reusableLeadConfig: AdsetDeliveryConfig | null | undefined;
  for (const adset of adsets) {
    const existingAdsetId = String(adset.existing_id || adset.adset_id || '').trim();
    if (existingAdsetId) {
      availableAdsetIds.push(existingAdsetId);
      continue;
    }
    const budget = moneyToCents(adset.daily_budget);
    if (!budget) {
      skipped.push({ level: 'adset', name: adset.name || 'Conjunto', reason: 'Informe uma verba diaria valida no pedido.' });
      continue;
    }
    let optimizationGoal = String(adset.optimization_goal || 'LEAD_GENERATION');
    let billingEvent = String(adset.billing_event || 'IMPRESSIONS');
    let bidStrategy = String(adset.bid_strategy || 'LOWEST_COST_WITHOUT_CAP');
    let promotedObject = jsonObject(adset.promoted_object, {});
    let destinationType = String(adset.destination_type || '').trim();
    if (String(campaign.objective) === 'OUTCOME_LEADS' && Object.keys(promotedObject).length === 0) {
      if (reusableLeadConfig === undefined) {
        reusableLeadConfig = await existingAdsetDeliveryConfig(accountPath, optimizationGoal);
      }
      if (!reusableLeadConfig) {
        skipped.push({
          level: 'adset',
          name: adset.name || 'Conjunto',
          reason: 'A conta nao possui uma configuracao de conversao anterior que possa ser reutilizada. Crie o primeiro conjunto de leads na Meta ou informe o objeto promovido.',
        });
        continue;
      }
      optimizationGoal = reusableLeadConfig.optimizationGoal;
      billingEvent = reusableLeadConfig.billingEvent;
      promotedObject = reusableLeadConfig.promotedObject || {};
      destinationType = reusableLeadConfig.destinationType;
      warnings.push(`O conjunto "${String(adset.name || 'Conjunto ABO')}" reutilizou a configuracao de conversao de "${reusableLeadConfig.sourceName}".`);
    }
    const adsetParams: Record<string, string> = {
      name: String(adset.name || 'Conjunto ABO'),
      campaign_id: campaignId,
      daily_budget: String(budget),
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      bid_strategy: bidStrategy,
      targeting: JSON.stringify(jsonObject(adset.targeting, { geo_locations: { countries: ['BR'] } })),
      status: 'PAUSED',
    };
    if (Object.keys(promotedObject).length > 0) adsetParams.promoted_object = JSON.stringify(promotedObject);
    if (destinationType && destinationType !== 'UNDEFINED') adsetParams.destination_type = destinationType;
    const result = await graphPost(`${accountPath}/adsets`, adsetParams, `a criacao do conjunto "${String(adset.name || 'Conjunto ABO')}"`);
    const newAdsetId = String(result.id);
    availableAdsetIds.push(newAdsetId);
    created.push({ level: 'adset', id: newAdsetId, name: String(adset.name || result.id), status: 'PAUSED' });
  }

  const ads = normalizedDraft.ads;
  for (const ad of ads) {
    let creativeId = ad.creative_id || ad.meta_creative_id;
    const adsetId = String(ad.adset_id || ad.existing_adset_id || availableAdsetIds[0] || '').trim();
    if (!creativeId) {
      let source: CreativeSource | null = null;
      try {
        source = await resolveCreativeSource(ad, normalizedDraft);
      } catch (error) {
        skipped.push({ level: 'ad', name: ad.name || 'Anuncio', reason: error instanceof Error ? error.message : 'Nao consegui ler o criativo informado.' });
        continue;
      }
      if (source) {
        const isImage = source.mime.startsWith('image/');
        const isVideo = source.mime.startsWith('video/');
        if (!isImage && !isVideo) {
          skipped.push({ level: 'ad', name: ad.name || source.name, reason: `Formato "${source.mime || 'desconhecido'}" nao e aceito pela Meta como criativo.` });
          continue;
        }
        const limit = isVideo ? VIDEO_LIMIT_BYTES : IMAGE_LIMIT_BYTES;
        if (source.bytes.byteLength > limit) {
          skipped.push({ level: 'ad', name: ad.name || source.name, reason: `O arquivo excede o limite de ${Math.round(limit / (1024 * 1024))} MB.` });
          continue;
        }

        let pageId = String(ad.page_id || normalizedDraft.page_id || process.env.META_DEFAULT_PAGE_ID || '').trim();
        let link = String(ad.link_url || normalizedDraft.link_url || process.env.META_DEFAULT_LEAD_LINK || '').trim();
        if ((!pageId || !link) && adsetId) {
          const existingConfig = await existingAdsetCreativeConfig(adsetId);
          pageId ||= existingConfig.pageId;
          link ||= existingConfig.link;
        }
        if (!pageId || !link) {
          skipped.push({ level: 'ad', name: ad.name || source.name, reason: 'Nao foi possivel reaproveitar a Pagina da Meta e o link de destino dos anuncios do conjunto. Configure esses dados na concessionaria.' });
          continue;
        }

        const message = String(ad.primary_text || normalizedDraft.primary_text || 'Conheca nossas solucoes.');
        const headline = String(ad.headline || normalizedDraft.headline || source.name);
        const description = String(ad.description || '');
        const callToAction = { type: normalizeCallToAction(ad.call_to_action), value: { link } };
        let storySpec: Record<string, unknown>;

        if (isImage) {
          const imageHash = await uploadImageHash(accountPath, source);
          if (!imageHash) {
            skipped.push({ level: 'ad', name: ad.name || source.name, reason: 'A Meta nao retornou o hash da imagem enviada.' });
            continue;
          }
          storySpec = {
            page_id: pageId,
            link_data: { image_hash: imageHash, link, message, name: headline, description, call_to_action: callToAction },
          };
        } else {
          let video: { videoId: string; thumbnailUrl: string };
          try {
            video = await uploadVideoId(accountPath, source);
          } catch (error) {
            skipped.push({ level: 'ad', name: ad.name || source.name, reason: error instanceof Error ? error.message : 'Falha ao enviar o video para a Meta.' });
            continue;
          }
          if (!video.thumbnailUrl) {
            skipped.push({ level: 'ad', name: ad.name || source.name, reason: 'A Meta nao gerou capa para o video. Publique de novo em alguns minutos.' });
            continue;
          }
          storySpec = {
            page_id: pageId,
            video_data: {
              video_id: video.videoId,
              image_url: video.thumbnailUrl,
              message,
              title: headline,
              link_description: description,
              call_to_action: callToAction,
            },
          };
          warnings.push(`O video "${source.name}" foi enviado e processado na Meta antes de virar anuncio.`);
        }

        const creativeResult = await graphPost(`${accountPath}/adcreatives`, {
          name: String(ad.creative_name || `${ad.name || source.name} | Orion Creative`),
          object_story_spec: JSON.stringify(storySpec),
        }, `a criacao do criativo "${String(ad.name || source.name)}"`);
        creativeId = String(creativeResult.id || '');
      }
    }
    if (!creativeId || !adsetId) {
      skipped.push({ level: 'ad', name: ad.name || 'Anuncio', reason: creativeId ? 'Nenhum conjunto criado para vincular o anuncio.' : 'Informe um creative_id da Meta, um arquivo do Drive ou envie o criativo pela tela.' });
      continue;
    }
    const result = await graphPost(`${accountPath}/ads`, {
      name: String(ad.name || 'Anuncio Orion'),
      adset_id: String(adsetId),
      creative: JSON.stringify({ creative_id: String(creativeId) }),
      status: 'PAUSED',
    }, `a criacao do anuncio "${String(ad.name || 'Anuncio Orion')}"`);
    created.push({ level: 'ad', id: String(result.id), name: String(ad.name || result.id), status: 'PAUSED' });
  }
  if (skipped.length) warnings.push('Alguns itens nao foram criados porque faltam verba, conjunto ou creative_id da Meta.');
  return { created, skipped, warnings };
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:execute-draft', { limit: 20, windowMs: 5 * 60_000 });
    if (limited) return limited;
    const access = await guard(request);
    if ('error' in access) return access.error;
    const body = await request.json();
    const accountId = normalizeAccountId(body.account_id);
    if (!accountId || !body.confirmar_criacao) return NextResponse.json({ error: 'Confirme a criacao pausada antes de continuar.' }, { status: 400 });
    const account = await allowedAccount(access.profile, accountId, body.equipe ? String(body.equipe) : null, body.gestor_id ? String(body.gestor_id) : null);
    if (!account) return NextResponse.json({ error: 'Conta fora do escopo deste gestor.' }, { status: 403 });
    const normalizedDraft = normalizeOptimizationDraft(body.draft);
    if (normalizedDraft.missing_info.length) {
      return NextResponse.json({ error: `Complete o plano antes de criar: ${normalizedDraft.missing_info.join(' ')}` }, { status: 400 });
    }
    if (normalizedDraft.ads.length && !normalizedDraft.adsets.length) {
      return NextResponse.json({ error: 'O plano precisa indicar o conjunto de destino do novo anuncio.' }, { status: 400 });
    }
    const result = await createPaused(accountId, normalizedDraft);
    return NextResponse.json({ success: true, account: account.nome_empresa || account.nome, ...result, activate_available: result.created.length > 0 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel criar a estrutura pausada na Meta.' }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  try {
    const access = await guard(request);
    if ('error' in access) return access.error;
    const body = await request.json();
    const accountId = normalizeAccountId(body.account_id);
    const level = String(body.level || '');
    if (!accountId || !body.confirmar || !body.object_id || !['campaign', 'adset', 'ad'].includes(level)) return NextResponse.json({ error: 'Dados de ativacao incompletos.' }, { status: 400 });
    const account = await allowedAccount(access.profile, accountId, body.equipe ? String(body.equipe) : null, body.gestor_id ? String(body.gestor_id) : null);
    if (!account) return NextResponse.json({ error: 'Conta fora do escopo deste gestor.' }, { status: 403 });
    await graphPost(String(body.object_id), { status: 'ACTIVE' }, 'a ativacao solicitada');
    return NextResponse.json({ success: true, object_id: String(body.object_id), level, status: 'ACTIVE' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel ativar o item na Meta.' }, { status: 502 });
  }
}
