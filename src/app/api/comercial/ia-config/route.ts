import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const { data, error } = await supabaseAdmin.from('comercial_config').select('ia_sdr_ativa,ia_sdr_prompt,ia_sdr_profile_id').eq('id', 1).maybeSingle();
  if (error && !/comercial_config|schema cache/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ active: data?.ia_sdr_ativa !== false, prompt: data?.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT, instanceProfileId: data?.ia_sdr_profile_id || null });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const prompt = String(body.prompt || '').trim();
  if (prompt.length < 40) return NextResponse.json({ error: 'O prompt precisa ter pelo menos 40 caracteres.' }, { status: 400 });
  const active = body.active !== false;
  const instanceProfileId = String(body.instanceProfileId || '').trim() || null;
  const { error } = await supabaseAdmin.from('comercial_config').upsert({ id: 1, ia_sdr_ativa: active, ia_sdr_prompt: prompt, ia_sdr_profile_id: instanceProfileId, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ active, prompt, instanceProfileId });
}
