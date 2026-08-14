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
    const rawColor = String(value.color || base?.color || '').trim();
    const color = /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor.toUpperCase() : undefined;
    return { id, label, desc: String(value.desc || base?.desc || 'Etapa personalizada'), protected: protectedStage, color };
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

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const oldId = String(body.old_id || '').trim();
  const label = String(body.label || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const color = String(body.color || '').trim().toUpperCase();
  if (!oldId || !label) return NextResponse.json({ error: 'Informe a etapa e o novo nome.' }, { status: 400 });
  if (color && !/^#[0-9A-F]{6}$/.test(color)) return NextResponse.json({ error: 'Informe uma cor valida.' }, { status: 400 });

  const { data: config, error: configError } = await supabaseAdmin.from('comercial_config').select('etapas').eq('id', 1).maybeSingle();
  if (configError) return NextResponse.json({ error: configError.message }, { status: 500 });
  const current = normalizeStages(config?.etapas?.length ? config.etapas : COMMERCIAL_STAGES);
  const target = current.find((stage) => stage.id === oldId);
  if (!target) return NextResponse.json({ error: 'Etapa nao encontrada.' }, { status: 404 });
  if (target.protected && label !== target.label) return NextResponse.json({ error: 'Esta etapa e fixa e nao pode ser renomeada.' }, { status: 400 });
  if (current.some((stage) => stage.id !== oldId && stage.label.toLowerCase() === label.toLowerCase())) {
    return NextResponse.json({ error: 'Ja existe uma etapa com este nome.' }, { status: 409 });
  }

  const next = current.map((stage) => stage.id === oldId ? { ...stage, id: label, label, color: color || stage.color } : stage);
  if (label !== oldId) {
    const { error: leadError } = await supabaseAdmin.from('comercial_leads').update({ status: label, updated_at: new Date().toISOString() }).eq('status', oldId);
    if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });
  }
  const { error: saveError } = await supabaseAdmin.from('comercial_config').upsert({ id: 1, etapas: next, updated_at: new Date().toISOString() });
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  return NextResponse.json({ stages: next });
}

export async function DELETE(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const stageId = String(body.id || '').trim();
  const fallbackId = String(body.fallback_id || '').trim();
  if (!stageId || !fallbackId || stageId === fallbackId) {
    return NextResponse.json({ error: 'Informe a etapa e o destino dos leads.' }, { status: 400 });
  }

  const { data: config, error: configError } = await supabaseAdmin.from('comercial_config').select('etapas').eq('id', 1).maybeSingle();
  if (configError) return NextResponse.json({ error: configError.message }, { status: 500 });
  const current = normalizeStages(config?.etapas?.length ? config.etapas : COMMERCIAL_STAGES);
  const target = current.find((stage) => stage.id === stageId);
  const fallback = current.find((stage) => stage.id === fallbackId);
  if (!target) return NextResponse.json({ error: 'Etapa nao encontrada.' }, { status: 404 });
  if (!fallback) return NextResponse.json({ error: 'Etapa de destino nao encontrada.' }, { status: 404 });
  if (target.protected) return NextResponse.json({ error: 'Esta etapa e fixa e nao pode ser excluida.' }, { status: 400 });

  const { error: leadError } = await supabaseAdmin
    .from('comercial_leads')
    .update({ status: fallback.id, updated_at: new Date().toISOString() })
    .eq('status', stageId);
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });

  const next = current.filter((stage) => stage.id !== stageId);
  const { error: saveError } = await supabaseAdmin.from('comercial_config').upsert({ id: 1, etapas: next, updated_at: new Date().toISOString() });
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  return NextResponse.json({ stages: next, moved_to: fallback.id });
}
