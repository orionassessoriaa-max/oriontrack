import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';

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
    .select('id, tipo_usuario')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['admin', 'gestor_trafego', 'account_manager', 'corretor', 'corretor_admin'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

function getMetaCompatibleRange(since: string, until: string) {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : today;
  const endDate = new Date(`${end}T00:00:00`);
  const minDate = new Date(endDate.getFullYear(), endDate.getMonth() - 36, 1);
  const minSince = minDate.toISOString().slice(0, 10);
  const validSince = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : minSince;

  return {
    since: validSince > minSince ? validSince : minSince,
    until: end,
  };
}

async function resolveBrokerageMetaAccount(corretor: any) {
  if (String(corretor.meta_ad_account_id || '').trim()) {
    return corretor;
  }

  const corretoraNome = String(corretor.nome_empresa || '').trim();
  if (!corretoraNome) {
    return corretor;
  }

  const { data: metaOwner } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name')
    .eq('nome_empresa', corretoraNome)
    .not('meta_ad_account_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return metaOwner || corretor;
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:spend', { limit: 60, windowMs: 5 * 60_000 });
    if (limited) return limited;

    const guard = await requireTrafficAccess(request);
    if ('error' in guard) return guard.error;

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: 'META_ACCESS_TOKEN nao configurado no servidor.' }, { status: 500 });
    }

    const body = await request.json();
    const corretorId = String(body.corretor_id || '');
    const since = String(body.data_inicio || '');
    const until = String(body.data_fim || '');

    if (!corretorId || !since || !until) {
      return NextResponse.json({ error: 'Informe corretor e periodo.' }, { status: 400 });
    }

    const { data: corretor, error: corretorError } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name')
      .eq('id', corretorId)
      .maybeSingle();

    if (corretorError || !corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    if (guard.profile.tipo_usuario === 'gestor_trafego' && corretor.gestor_trafego_id !== guard.user.id) {
      return NextResponse.json({ error: 'Este corretor nao esta vinculado ao seu gestor.' }, { status: 403 });
    }

    if (guard.profile.tipo_usuario === 'corretor' || guard.profile.tipo_usuario === 'corretor_admin') {
      const { data: requester } = await supabaseAdmin
        .from('profiles')
        .select('corretor_id')
        .eq('id', guard.user.id)
        .maybeSingle();

      if (requester?.corretor_id !== corretor.id) {
        return NextResponse.json({ error: 'Voce so pode consultar a sua propria conta Meta.' }, { status: 403 });
      }
    }

    const metaAccount = await resolveBrokerageMetaAccount(corretor);

    if (!metaAccount.meta_ad_account_id) {
      return NextResponse.json({ error: 'Esta corretora ainda nao tem conta Meta vinculada.' }, { status: 400 });
    }

    const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
    const metaRange = getMetaCompatibleRange(since, until);
    const accountId = String(metaAccount.meta_ad_account_id).replace(/^act_/, '');
    const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
    url.searchParams.set('fields', 'spend');
    url.searchParams.set('time_range', JSON.stringify({ since: metaRange.since, until: metaRange.until }));
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url.toString(), { next: { revalidate: 300 } });
    const payload = await response.json();

    if (!response.ok || payload.error) {
      return NextResponse.json({ error: payload.error?.message || 'Erro ao consultar investimento Meta.' }, { status: 400 });
    }

    const spend = (payload.data || []).reduce((total: number, item: any) => total + Number(item.spend || 0), 0);

    return NextResponse.json({
      success: true,
      corretor_id: corretor.id,
      meta_ad_account_id: metaAccount.meta_ad_account_id,
      meta_ad_account_name: metaAccount.meta_ad_account_name,
      spend
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar investimento Meta.' }, { status: 500 });
  }
}
