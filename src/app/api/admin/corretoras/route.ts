import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';

function normalizeName(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeOperationMode(value: unknown) {
  const mode = String(value || '').trim();
  return ['individual', 'grupo_rodizio', 'grupo_rodizio_admin'].includes(mode)
    ? mode
    : 'individual';
}

function isMissingCorretorasTable(error?: { message?: string | null } | null) {
  return /corretoras|schema cache|does not exist|could not find/i.test(String(error?.message || ''));
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
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
    return NextResponse.json({ error: error.message || 'Erro ao listar concessionarias.' }, { status: 500 });
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
    const modo_operacao = normalizeOperationMode(body.modo_operacao);

    if (!nome) {
      return NextResponse.json({ error: 'Informe o nome da concessionaria.' }, { status: 400 });
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
        modo_operacao,
        created_by: guard.profile.id,
      }])
      .select('*')
      .single();

    if (error) {
      if (isMissingCorretorasTable(error)) {
        return NextResponse.json({
          error: 'A migration de concessionarias ainda nao foi aplicada no Supabase.',
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
    return NextResponse.json({ error: error.message || 'Erro ao criar concessionaria.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:corretoras:update', { limit: 60, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const body = await request.json().catch(() => ({}));
    const id = normalizeName(body.id);
    const modo_operacao = normalizeOperationMode(body.modo_operacao);

    if (!id) {
      return NextResponse.json({ error: 'Informe a concessionaria.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('corretoras')
      .update({ modo_operacao })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (isMissingCorretorasTable(error)) {
        return NextResponse.json({
          error: 'A migration de concessionarias ainda nao foi aplicada no Supabase.',
          migration_pending: true,
        }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'corretora.operation_mode.update',
      entity_type: 'corretoras',
      entity_id: data.id,
      metadata: { nome: data.nome, modo_operacao },
    });

    return NextResponse.json({ success: true, corretora: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao atualizar concessionaria.' }, { status: 500 });
  }
}
