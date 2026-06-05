import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';

function normalizeName(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isMissingCorretorasTable(error?: { message?: string | null } | null) {
  return /corretoras|schema cache|does not exist|could not find/i.test(String(error?.message || ''));
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const { data, error } = await supabaseAdmin
      .from('corretoras')
      .select('*')
      .order('nome', { ascending: true });

    if (error) {
      if (isMissingCorretorasTable(error)) {
        return NextResponse.json({ corretoras: [], migration_pending: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ corretoras: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao listar corretoras.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:corretoras:create', { limit: 30, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const nome = normalizeName(body.nome);
    const descricao = normalizeName(body.descricao) || null;

    if (!nome) {
      return NextResponse.json({ error: 'Informe o nome da corretora.' }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin
      .from('corretoras')
      .select('*')
      .ilike('nome', nome)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, corretora: existing, already_exists: true });
    }

    const { data, error } = await supabaseAdmin
      .from('corretoras')
      .insert([{
        nome,
        descricao,
        status: 'ativo',
        created_by: guard.profile.id,
      }])
      .select('*')
      .single();

    if (error) {
      if (isMissingCorretorasTable(error)) {
        return NextResponse.json({
          error: 'A migration de corretoras ainda nao foi aplicada no Supabase.',
          migration_pending: true,
        }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'corretora.create',
      entity_type: 'corretoras',
      entity_id: data.id,
      metadata: { nome },
    });

    return NextResponse.json({ success: true, corretora: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao criar corretora.' }, { status: 500 });
  }
}
