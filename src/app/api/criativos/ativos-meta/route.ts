import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { fetchWithTimeout } from '@/lib/meta/fetchWithTimeout';

function normalizeAccountId(value?: string | null) {
  return String(value || '').replace(/^act_/, '').trim();
}

function graphUrl(path: string) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  return `https://graph.facebook.com/${version}/${path.replace(/^\//, '')}`;
}

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, 'criativos:ativos-meta', { limit: 30, windowMs: 5 * 60_000 });
    if (limited) return limited;

    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(header.slice(7));
    if (authError || !user) {
      return NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, tipo_usuario, corretor_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !['corretor', 'corretor_admin', 'corretor_membro'].includes(profile.tipo_usuario)) {
      return NextResponse.json({ error: 'Acesso restrito ao cliente.' }, { status: 403 });
    }
    if (!profile.corretor_id) {
      return NextResponse.json({ success: true, concessionaria: null, creatives: [] });
    }

    const { data: currentBroker } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, nome_empresa, meta_ad_account_id, meta_ad_account_name')
      .eq('id', profile.corretor_id)
      .maybeSingle();

    if (!currentBroker) {
      return NextResponse.json({ success: true, concessionaria: null, creatives: [] });
    }

    let metaOwner = currentBroker;
    if (!normalizeAccountId(currentBroker.meta_ad_account_id) && currentBroker.nome_empresa) {
      const { data: companyAccount } = await supabaseAdmin
        .from('corretores')
        .select('id, nome, nome_empresa, meta_ad_account_id, meta_ad_account_name')
        .eq('nome_empresa', currentBroker.nome_empresa)
        .not('meta_ad_account_id', 'is', null)
        .limit(1)
        .maybeSingle();
      if (companyAccount) metaOwner = companyAccount;
    }

    const accountId = normalizeAccountId(metaOwner.meta_ad_account_id);
    if (!accountId) {
      return NextResponse.json({
        success: true,
        concessionaria: currentBroker.nome_empresa || currentBroker.nome,
        account_connected: false,
        creatives: [],
      });
    }

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: 'Integracao Meta indisponivel no servidor.' }, { status: 503 });
    }

    const url = new URL(graphUrl(`act_${accountId}/ads`));
    url.searchParams.set(
      'fields',
      'id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,title,body,object_story_spec}'
    );
    url.searchParams.set('filtering', JSON.stringify([
      { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
    ]));
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', accessToken);

    const response = await fetchWithTimeout(url.toString(), { next: { revalidate: 300 } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      return NextResponse.json({
        error: payload.error?.message || 'Nao foi possivel consultar os criativos ativos na Meta.',
      }, { status: 502 });
    }

    const creatives = (payload.data || [])
      .filter((ad: any) => String(ad.effective_status || '').toUpperCase() === 'ACTIVE')
      .map((ad: any) => ({
        id: String(ad.id),
        ad_name: ad.name || 'Anuncio sem nome',
        creative_name: ad.creative?.name || null,
        title: ad.creative?.title || ad.creative?.object_story_spec?.link_data?.name || null,
        body: ad.creative?.body || ad.creative?.object_story_spec?.link_data?.message || null,
        image_url: ad.creative?.image_url || null,
        thumbnail_url: ad.creative?.thumbnail_url || null,
        status: 'ACTIVE',
      }));

    return NextResponse.json({
      success: true,
      concessionaria: currentBroker.nome_empresa || currentBroker.nome,
      meta_ad_account_name: metaOwner.meta_ad_account_name || null,
      account_connected: true,
      creatives,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar criativos ativos.' }, { status: 500 });
  }
}
