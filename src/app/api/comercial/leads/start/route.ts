import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/api/security';

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  if (guard.commercialRole !== 'sdr') {
    return NextResponse.json({ error: 'Somente SDRs podem iniciar um lead.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'Lead obrigatorio.' }, { status: 400 });

  // The null check makes the first click win when two SDRs start the same lead.
  const { data, error } = await supabaseAdmin
    .from('comercial_leads')
    .update({ sdr_id: guard.profile.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('sdr_id', null)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    const { data: current } = await supabaseAdmin.from('comercial_leads').select('sdr_id').eq('id', id).maybeSingle();
    return NextResponse.json({ error: current?.sdr_id ? 'Este lead ja foi iniciado por outro SDR.' : 'Lead nao encontrado.' }, { status: 409 });
  }

  await writeAuditLog(request, guard.profile, {
    action: 'commercial.lead.start',
    entity_type: 'commercial_lead',
    entity_id: id,
  });
  return NextResponse.json({ lead: data, sdr_id: guard.profile.id, sdr_nome: guard.profile.nome || 'SDR' });
}
