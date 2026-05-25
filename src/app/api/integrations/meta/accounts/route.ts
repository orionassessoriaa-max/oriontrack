import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';

type MetaAccount = {
  id: string;
  name: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
};

function normalizeAccountId(id: string) {
  return String(id || '').replace(/^act_/, '').trim();
}

async function requireAdmin(request: Request) {
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
    .select('tipo_usuario')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.tipo_usuario !== 'admin') {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user };
}

async function fetchMetaAccounts(path: string, accessToken: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  const fields = 'id,name,account_status,currency,timezone_name';
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url.toString(), { next: { revalidate: 300 } });
  const payload = await response.json();

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Erro ao consultar Meta em ${path}.`);
  }

  return (payload.data || []) as MetaAccount[];
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:accounts:sync', { limit: 8, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const accessToken = process.env.META_ACCESS_TOKEN;
    const businessId = process.env.META_BUSINESS_ID;

    if (!accessToken) {
      return NextResponse.json({ error: 'META_ACCESS_TOKEN nao configurado no servidor.' }, { status: 500 });
    }

    const paths = businessId
      ? [`${businessId}/owned_ad_accounts`, `${businessId}/client_ad_accounts`, 'me/adaccounts']
      : ['me/adaccounts'];

    const results = await Promise.allSettled(paths.map((path) => fetchMetaAccounts(path, accessToken)));
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason?.message || 'Erro desconhecido.');

    const uniqueAccounts = new Map<string, MetaAccount>();
    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      result.value.forEach((account) => {
        const id = normalizeAccountId(account.id);
        if (id) uniqueAccounts.set(id, account);
      });
    });

    const accounts = Array.from(uniqueAccounts.values()).map((account) => ({
      meta_account_id: normalizeAccountId(account.id),
      nome: account.name,
      currency: account.currency || null,
      timezone_name: account.timezone_name || null,
      status: account.account_status ? String(account.account_status) : null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (accounts.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from('meta_ad_accounts')
        .upsert(accounts, { onConflict: 'meta_account_id' });

      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      accounts,
      count: accounts.length,
      warnings: errors,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao sincronizar contas Meta.' }, { status: 500 });
  }
}
