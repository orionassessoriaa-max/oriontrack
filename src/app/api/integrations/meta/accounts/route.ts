import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

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

function validUuid(value: unknown) {
  const normalized = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
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

export async function GET(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;

  const { data, error } = await supabaseAdmin
    .from('meta_ad_accounts')
    .select('id, meta_account_id, nome, currency, timezone_name, status, last_synced_at')
    .order('nome', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data || [] });
}

export async function PATCH(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'meta:accounts:bind', {
    limit: 40,
    windowMs: 10 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const corretorId = validUuid(body.corretor_id);
    const accountId = normalizeAccountId(String(body.meta_account_id || ''));
    if (!corretorId) {
      return NextResponse.json({ error: 'Concessionaria invalida.' }, { status: 400 });
    }

    const { data: concessionaria, error: concessionariaError } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, nome_empresa, gestor_trafego_id, time_operacional')
      .eq('id', corretorId)
      .maybeSingle();
    if (concessionariaError) throw concessionariaError;
    if (!concessionaria?.nome_empresa) {
      return NextResponse.json({ error: 'Concessionaria nao encontrada.' }, { status: 404 });
    }
    if (
      guard.profile.tipo_usuario === 'gestor_trafego'
      && !isGestorLinkedToConcessionariaCorretor(concessionaria, guard.profile)
    ) {
      return NextResponse.json({ error: 'Esta concessionaria nao esta atribuida a voce.' }, { status: 403 });
    }

    let account: MetaAccount | null = null;
    if (accountId) {
      const { data: selectedAccount, error: accountError } = await supabaseAdmin
        .from('meta_ad_accounts')
        .select('meta_account_id, nome, status, currency, timezone_name')
        .eq('meta_account_id', accountId)
        .maybeSingle();
      if (accountError) throw accountError;
      if (!selectedAccount) {
        return NextResponse.json({ error: 'Conta de anuncios nao encontrada. Sincronize-a pela aba Meta Ads.' }, { status: 404 });
      }
      account = {
        id: selectedAccount.meta_account_id,
        name: selectedAccount.nome,
        account_status: selectedAccount.status ? Number(selectedAccount.status) : undefined,
        currency: selectedAccount.currency || undefined,
        timezone_name: selectedAccount.timezone_name || undefined,
      };
    }

    const companyName = String(concessionaria.nome_empresa).trim();
    const update = {
      meta_ad_account_id: accountId || null,
      meta_ad_account_name: account?.name || null,
    };
    const { error: corretoresError } = await supabaseAdmin
      .from('corretores')
      .update(update)
      .ilike('nome_empresa', companyName);
    if (corretoresError) throw corretoresError;

    const { error: corretoraError } = await supabaseAdmin
      .from('corretoras')
      .update(update)
      .ilike('nome', companyName);
    if (corretoraError) throw corretoraError;

    await writeAuditLog(request, guard.profile, {
      action: accountId ? 'meta.account.bind' : 'meta.account.unbind',
      entity_type: 'corretor',
      entity_id: corretorId,
      metadata: {
        concessionaria: companyName,
        meta_account_id: accountId || null,
        meta_account_name: account?.name || null,
      },
    });

    return NextResponse.json({
      success: true,
      concessionaria: companyName,
      meta_ad_account_id: accountId || null,
      meta_ad_account_name: account?.name || null,
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao vincular conta de anuncios.',
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:accounts:sync', { limit: 8, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
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
