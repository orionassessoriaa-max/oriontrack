import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

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

async function graphPost(path: string, params: Record<string, string>) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado no ambiente da aplicacao.');
  const body = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(graphUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(json.error?.message || `Meta recusou a operacao (${response.status}).`);
  return json;
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

async function createPaused(accountId: string, draft: any) {
  const created: any[] = [];
  const skipped: any[] = [];
  const warnings: string[] = [];
  const accountPath = `act_${accountId}`;
  const campaign = draft?.campaign || {};
  const campaignResult = await graphPost(`${accountPath}/campaigns`, {
    name: String(campaign.name || `[ORION] Campanha | ${new Date().toISOString().slice(0, 10)}`),
    objective: String(campaign.objective || 'OUTCOME_LEADS'),
    buying_type: String(campaign.buying_type || 'AUCTION'),
    status: 'PAUSED',
    special_ad_categories: JSON.stringify(campaign.special_ad_categories || []),
  });
  const campaignItem = { level: 'campaign', id: String(campaignResult.id), name: String(campaign.name || campaignResult.id), status: 'PAUSED' };
  created.push(campaignItem);

  const adsets = Array.isArray(draft?.adsets) ? draft.adsets : [];
  for (const adset of adsets) {
    const budget = moneyToCents(adset.daily_budget);
    if (!budget) {
      skipped.push({ level: 'adset', name: adset.name || 'Conjunto', reason: 'Informe uma verba diaria valida no pedido.' });
      continue;
    }
    const result = await graphPost(`${campaignResult.id}/adsets`, {
      name: String(adset.name || 'Conjunto ABO'),
      campaign_id: String(campaignResult.id),
      daily_budget: String(budget),
      billing_event: String(adset.billing_event || 'IMPRESSIONS'),
      optimization_goal: String(adset.optimization_goal || 'LEAD_GENERATION'),
      targeting: JSON.stringify(jsonObject(adset.targeting, { geo_locations: { countries: ['BR'] } })),
      status: 'PAUSED',
    });
    created.push({ level: 'adset', id: String(result.id), name: String(adset.name || result.id), status: 'PAUSED' });
  }

  const ads = Array.isArray(draft?.ads) ? draft.ads : [];
  for (const ad of ads) {
    const creativeId = ad.creative_id || ad.meta_creative_id;
    const adsetId = ad.adset_id || created.find((item) => item.level === 'adset')?.id;
    if (!creativeId || !adsetId) {
      skipped.push({ level: 'ad', name: ad.name || 'Anuncio', reason: creativeId ? 'Nenhum conjunto criado para vincular o anuncio.' : 'Informe um creative_id da Meta; uma pasta do Drive sozinha nao cria o criativo na Meta.' });
      continue;
    }
    const result = await graphPost(`${adsetId}/ads`, {
      name: String(ad.name || 'Anuncio Orion'),
      adset_id: String(adsetId),
      creative: JSON.stringify({ creative_id: String(creativeId) }),
      status: 'PAUSED',
    });
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
    const result = await createPaused(accountId, body.draft);
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
    await graphPost(String(body.object_id), { status: 'ACTIVE' });
    return NextResponse.json({ success: true, object_id: String(body.object_id), level, status: 'ACTIVE' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel ativar o item na Meta.' }, { status: 502 });
  }
}
