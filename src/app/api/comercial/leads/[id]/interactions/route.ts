import { NextResponse } from 'next/server';
import { requireCommercialUser, applyCommercialLeadScope } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function allowedLead(id: string, guard: Awaited<ReturnType<typeof requireCommercialUser>>) {
  if ('error' in guard) return null;
  let query = supabaseAdmin.from('comercial_leads').select('id,sdr_id,closer_id').eq('id', id);
  if (guard.commercialRole !== 'coordenador') query = applyCommercialLeadScope(query, guard.commercialRole, guard.profile.id);
  const { data } = await query.maybeSingle();
  return data;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const { id } = await context.params;
  if (!await allowedLead(id, guard)) return NextResponse.json({ error: 'Lead sem permissao.' }, { status: 403 });
  const { data, error } = await supabaseAdmin.from('comercial_lead_interacoes').select('id,lead_id,autor_id,comentario,anexo_url,anexo_nome,created_at').eq('lead_id', id).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const authorIds = Array.from(new Set((data || []).map((item) => item.autor_id).filter(Boolean)));
  const { data: authors } = authorIds.length ? await supabaseAdmin.from('profiles').select('id,nome').in('id', authorIds) : { data: [] };
  const authorMap = new Map((authors || []).map((author) => [author.id, author.nome]));
  return NextResponse.json({ interactions: (data || []).map((item) => ({ ...item, autor_nome: authorMap.get(item.autor_id) || 'Equipe comercial' })) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const { id } = await context.params;
  if (!await allowedLead(id, guard)) return NextResponse.json({ error: 'Lead sem permissao.' }, { status: 403 });
  const form = await request.formData();
  const comentario = String(form.get('comentario') || '').trim() || null;
  const file = form.get('anexo');
  let anexoUrl: string | null = null;
  let anexoNome: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'O anexo precisa ser uma imagem.' }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'A imagem deve ter no maximo 8 MB.' }, { status: 400 });
    await supabaseAdmin.storage.createBucket('comercial-lead-assets', { public: true }).catch(() => undefined);
    const path = `${id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const upload = await supabaseAdmin.storage.from('comercial-lead-assets').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
    anexoUrl = supabaseAdmin.storage.from('comercial-lead-assets').getPublicUrl(path).data.publicUrl;
    anexoNome = file.name;
  }
  if (!comentario && !anexoUrl) return NextResponse.json({ error: 'Adicione um comentario ou uma imagem.' }, { status: 400 });
  const { data, error } = await supabaseAdmin.from('comercial_lead_interacoes').insert({ lead_id: id, autor_id: guard.profile.id, comentario, anexo_url: anexoUrl, anexo_nome: anexoNome }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ interaction: { ...data, autor_nome: guard.profile.nome || 'Equipe comercial' } }, { status: 201 });
}
