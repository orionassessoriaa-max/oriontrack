import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const { data, error } = await supabaseAdmin.from('comercial_config').select('ia_sdr_ativa,ia_sdr_prompt,ia_sdr_profile_id,bot_comercial_ativo,bot_comercial_prompt').eq('id', 1).maybeSingle();
  if (error && !/comercial_config|schema cache/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ active: data?.ia_sdr_ativa !== false, prompt: data?.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT, instanceProfileId: data?.ia_sdr_profile_id || null, botActive: data?.bot_comercial_ativo === true, botPrompt: data?.bot_comercial_prompt || '' });
}

export async function PATCH(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const prompt = String(body.prompt || '').trim();
  if (prompt.length < 40) return NextResponse.json({ error: 'O prompt precisa ter pelo menos 40 caracteres.' }, { status: 400 });
  const active = body.active !== false;
  const botActive = body.botActive === true && !active;
  const botPrompt = String(body.botPrompt || '').trim();
  if (botActive && botPrompt.length < 20) return NextResponse.json({ error: 'O prompt da primeira mensagem precisa ter pelo menos 20 caracteres.' }, { status: 400 });
  const instanceProfileId = String(body.instanceProfileId || '').trim() || null;
  const { error } = await supabaseAdmin.from('comercial_config').upsert({ id: 1, ia_sdr_ativa: active, ia_sdr_prompt: prompt, ia_sdr_profile_id: instanceProfileId, bot_comercial_ativo: botActive, bot_comercial_prompt: botPrompt, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ active, prompt, instanceProfileId, botActive, botPrompt });
}
