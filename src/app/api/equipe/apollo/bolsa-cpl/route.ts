import { NextResponse } from 'next/server';
import { forbidden, rateLimit, requireApiUser } from '@/lib/api/security';
import { buildRegionalCplPayload, type RegionalCplAccount } from '@/lib/meta/regionalCpl';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { UserRole } from '@/types';

const ALLOWED_ROLES: UserRole[] = ['admin', 'gestor_trafego', 'designer', 'account_manager'];

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function defaultSince() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
}

function normalizeAccountId(value: unknown) {
  return String(value || '').replace(/^act_/, '').trim();
}

async function loadApolloAccounts() {
  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('nome,nome_empresa,meta_ad_account_id,meta_ad_account_name,status')
    .not('meta_ad_account_id', 'is', null);
  if (error) throw new Error(error.message);

  const accounts = new Map<string, RegionalCplAccount>();
  for (const row of data || []) {
    const status = String(row.status || '').toLowerCase();
    if (status && !['active', 'ativo'].includes(status)) continue;
    const id = normalizeAccountId(row.meta_ad_account_id);
    if (!id || accounts.has(id)) continue;
    accounts.set(id, {
      id,
      name: row.nome_empresa || row.meta_ad_account_name || row.nome || 'Conta Meta',
    });
  }
  return Array.from(accounts.values());
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ALLOWED_ROLES);
    if ('error' in guard) return guard.error;
    if (guard.profile.tipo_usuario !== 'admin' && guard.profile.equipe_orion && guard.profile.equipe_orion !== 'apollo') {
      return forbidden('Página exclusiva do time Apollo.');
    }
    const limited = rateLimit(request, 'apollo:regional-cpl', {
      limit: 20,
      windowMs: 5 * 60_000,
      key: guard.profile.id,
    });
    if (limited) return limited;

    const url = new URL(request.url);
    const until = validDate(url.searchParams.get('ate')) || new Date().toISOString().slice(0, 10);
    const since = validDate(url.searchParams.get('de')) || defaultSince();
    const accounts = await loadApolloAccounts();
    if (!accounts.length) {
      return NextResponse.json({ error: 'Nenhuma conta Meta ativa está vinculada aos clientes.' }, { status: 404 });
    }
    return NextResponse.json(await buildRegionalCplPayload({ accounts, since, until }));
  } catch (error) {
    console.error('[apollo_regional_cpl] GET error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Não foi possível carregar a Bolsa de CPL.',
    }, { status: 500 });
  }
}
