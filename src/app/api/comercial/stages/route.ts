import { NextResponse } from 'next/server';
import { COMMERCIAL_STAGES, type CommercialStage } from '@/lib/comercial';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';

function normalizeStages(input: unknown): CommercialStage[] {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  return source.map((item) => {
    const value = item as Partial<CommercialStage>;
    const label = String(value.label || value.id || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const id = String(value.id || label).trim().slice(0, 80);
    if (!label || !id || seen.has(id)) return null;
    seen.add(id);
    const base = COMMERCIAL_STAGES.find((stage) => stage.id === id);
    const protectedStage = Boolean(value.protected) || ['Oportunidade', 'Em negociacao', 'Negocio fechado', 'Venda realizada', 'Sem interesse'].includes(id) || /negoci|negocio|venda realizada/i.test(label.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    return { id, label, desc: String(value.desc || base?.desc || 'Etapa personalizada'), protected: protectedStage };
  }).filter(Boolean) as CommercialStage[];
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const { data, error } = await supabaseAdmin.from('comercial_config').select('etapas').eq('id', 1).maybeSingle();
  if (error && !/comercial_config|schema cache/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stages: normalizeStages(data?.etapas?.length ? data.etapas : COMMERCIAL_STAGES) });
}

export async function PUT(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const stages = normalizeStages(body.stages).slice(0, 40);
  if (!stages.length) return NextResponse.json({ error: 'Inclua pelo menos uma etapa.' }, { status: 400 });
  const { error } = await supabaseAdmin.from('comercial_config').upsert({ id: 1, etapas: stages, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stages });
}
