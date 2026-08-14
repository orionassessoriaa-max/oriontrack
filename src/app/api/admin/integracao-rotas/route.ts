import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  isMissingLeadRoutingTable,
  LEAD_SOURCE_TYPES,
  normalizeLeadSourceId,
  type LeadSourceType,
} from '@/lib/n8nLeadRouting';

function value(input: unknown) {
  return String(input || '').trim();
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | null)?.message || fallback);
}

function isSourceType(input: string): input is LeadSourceType {
  return (LEAD_SOURCE_TYPES as readonly string[]).includes(input);
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const { searchParams } = new URL(request.url);
    const corretoraId = value(searchParams.get('corretora_id'));
    if (!corretoraId) return NextResponse.json({ error: 'Informe a concessionaria.' }, { status: 400 });

    const [{ data: routes, error }, { count: quarantineCount, error: quarantineError }] = await Promise.all([
      supabaseAdmin
        .from('lead_source_routes')
        .select('id, source_type, source_id, label, corretora_id, active, metadata, created_at, updated_at')
        .eq('corretora_id', corretoraId)
        .order('source_type')
        .order('label'),
      supabaseAdmin
        .from('lead_routing_quarantine')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('resolved_corretora_id', corretoraId),
    ]);

    if (error) throw error;
    if (quarantineError) throw quarantineError;
    return NextResponse.json({ routes: routes || [], quarantine_count: quarantineCount || 0 });
  } catch (error: unknown) {
    if (isMissingLeadRoutingTable(error)) {
      return NextResponse.json({ routes: [], quarantine_count: 0, migration_pending: true });
    }
    return NextResponse.json({ error: errorMessage(error, 'Erro ao carregar origens.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:lead-source-routes:create', { limit: 60, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;
    const body = await request.json().catch(() => ({}));
    const corretoraId = value(body.corretora_id);
    const sourceType = value(body.source_type);
    const label = value(body.label) || null;

    if (!corretoraId || !isSourceType(sourceType)) {
      return NextResponse.json({ error: 'Informe a concessionaria e o tipo da origem.' }, { status: 400 });
    }
    const sourceId = normalizeLeadSourceId(sourceType, body.source_id);
    if (!sourceId) return NextResponse.json({ error: 'Informe o identificador da origem.' }, { status: 400 });

    const { data: corretora, error: corretoraError } = await supabaseAdmin
      .from('corretoras')
      .select('id, nome')
      .eq('id', corretoraId)
      .maybeSingle();
    if (corretoraError) throw corretoraError;
    if (!corretora) return NextResponse.json({ error: 'Concessionaria nao encontrada.' }, { status: 404 });

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('lead_source_routes')
      .select('id, corretora_id, corretoras:corretora_id(nome)')
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.corretora_id !== corretoraId) {
      const relation = existing.corretoras as unknown as { nome?: string } | Array<{ nome?: string }> | null;
      const ownerName = Array.isArray(relation) ? relation[0]?.nome : relation?.nome;
      return NextResponse.json({
        error: `Esta origem ja pertence a ${ownerName || 'outra concessionaria'}.`,
      }, { status: 409 });
    }

    const mutation = existing
      ? supabaseAdmin
        .from('lead_source_routes')
        .update({ label, active: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single()
      : supabaseAdmin
        .from('lead_source_routes')
        .insert({
          corretora_id: corretoraId,
          source_type: sourceType,
          source_id: sourceId,
          label,
          created_by: guard.profile.id,
        })
        .select('*')
        .single();

    const { data, error } = await mutation;
    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: existing ? 'lead_source_route.reactivate' : 'lead_source_route.create',
      entity_type: 'lead_source_routes',
      entity_id: data.id,
      metadata: { corretora_id: corretoraId, source_type: sourceType, source_id: sourceId, label },
    });
    return NextResponse.json({ success: true, route: data });
  } catch (error: unknown) {
    if (isMissingLeadRoutingTable(error)) {
      return NextResponse.json({ error: 'Aplique a migration de roteamento global no Supabase.', migration_pending: true }, { status: 503 });
    }
    return NextResponse.json({ error: errorMessage(error, 'Erro ao cadastrar origem.') }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;
    const body = await request.json().catch(() => ({}));
    const id = value(body.id);
    if (!id) return NextResponse.json({ error: 'Informe a rota.' }, { status: 400 });

    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (Object.prototype.hasOwnProperty.call(body, 'active')) changes.active = Boolean(body.active);
    if (Object.prototype.hasOwnProperty.call(body, 'label')) changes.label = value(body.label) || null;

    const { data, error } = await supabaseAdmin
      .from('lead_source_routes')
      .update(changes)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: 'lead_source_route.update',
      entity_type: 'lead_source_routes',
      entity_id: id,
      metadata: changes,
    });
    return NextResponse.json({ success: true, route: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error, 'Erro ao atualizar origem.') }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;
    const { searchParams } = new URL(request.url);
    const id = value(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Informe a rota.' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('lead_source_routes')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, source_type, source_id, corretora_id')
      .single();
    if (error) throw error;

    await writeAuditLog(request, guard.profile, {
      action: 'lead_source_route.disable',
      entity_type: 'lead_source_routes',
      entity_id: id,
      metadata: data,
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error, 'Erro ao desativar origem.') }, { status: 500 });
  }
}
