import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';

async function requireAdmin(request: Request) {
  return requireApiUser(request, ['admin']);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ('error' in guard) return guard.error;

  const { id } = await context.params;
  const leadId = String(id || '').trim();

  if (!leadId) {
    return NextResponse.json({ error: 'Lead invalido.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .delete()
    .eq('id', leadId)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Lead nao encontrado ou ja removido.' }, { status: 404 });
  }

  await writeAuditLog(request, guard.profile, {
    action: 'lead.delete',
    entity_type: 'lead',
    entity_id: data.id,
  });

  return NextResponse.json({ ok: true, lead_id: data.id });
}
