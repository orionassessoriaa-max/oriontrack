import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { rateLimit } from '@/lib/api/security';
import { buildRegionalCplPayload } from '@/lib/meta/regionalCpl';

const KRIPTO_META_ACCOUNT_ID = '1531044161152262';

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function defaultSince() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const guard = await requireCommercialUser(request);
    if ('error' in guard) return guard.error;
    const limited = rateLimit(request, 'commercial:regional-cpl', {
      limit: 20,
      windowMs: 5 * 60_000,
      key: guard.profile.id,
    });
    if (limited) return limited;

    const url = new URL(request.url);
    const until = validDate(url.searchParams.get('ate')) || new Date().toISOString().slice(0, 10);
    const since = validDate(url.searchParams.get('de')) || defaultSince();
    return NextResponse.json(await buildRegionalCplPayload({
      accounts: [{ id: KRIPTO_META_ACCOUNT_ID, name: 'Kripto Hunters' }],
      since,
      until,
    }));
  } catch (error) {
    console.error('[commercial_regional_cpl] GET error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Não foi possível carregar a Bolsa de CPL.',
    }, { status: 500 });
  }
}
