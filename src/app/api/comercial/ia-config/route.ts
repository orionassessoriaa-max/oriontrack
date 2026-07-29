import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const [{ data, error }, { data: memberRows, error: memberError }] = await Promise.all([
    supabaseAdmin
      .from('comercial_config')
      .select('ia_sdr_ativa,ia_sdr_prompt,ia_sdr_profile_id,bot_comercial_ativo,bot_comercial_prompt,distribuicao_automatica_ativa,proximo_sdr_id')
      .eq('id', 1)
      .maybeSingle(),
    supabaseAdmin
      .from('comercial_membros')
      .select('profile_id,papel,ativo,distribuicao_ativa,created_at')
      .eq('ativo', true)
      .order('created_at', { ascending: true }),
  ]);
  if (error && !/comercial_config|schema cache/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
  if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });

  const profileIds = (memberRows || []).map((member) => member.profile_id);
  const { data: profiles } = profileIds.length
    ? await supabaseAdmin
      .from('profiles')
      .select('id,nome,foto_url,status')
      .in('id', profileIds)
    : { data: [] };
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const distributionMembers = (memberRows || []).map((member) => ({
    profile_id: member.profile_id,
    nome: profileMap.get(member.profile_id)?.nome || 'Integrante',
    foto_url: profileMap.get(member.profile_id)?.foto_url || null,
    papel: member.papel,
    eligible: member.papel === 'sdr',
    enabled: member.papel === 'sdr' && member.distribuicao_ativa !== false,
  }));
  const nextProfileId = distributionMembers.some((member) =>
    member.profile_id === data?.proximo_sdr_id && member.eligible && member.enabled
  )
    ? data?.proximo_sdr_id
    : distributionMembers.find((member) => member.eligible && member.enabled)?.profile_id || null;

  return NextResponse.json({
    active: data?.ia_sdr_ativa !== false,
    prompt: data?.ia_sdr_prompt || DEFAULT_COMMERCIAL_SDR_PROMPT,
    instanceProfileId: data?.ia_sdr_profile_id || null,
    botActive: data?.bot_comercial_ativo === true,
    botPrompt: data?.bot_comercial_prompt || '',
    distribution: {
      active: data?.distribuicao_automatica_ativa !== false,
      nextProfileId,
      members: distributionMembers,
    },
  });
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
  const hasDistributionUpdate = Object.prototype.hasOwnProperty.call(body, 'distributionParticipantIds');
  const { data: currentConfig } = await supabaseAdmin
    .from('comercial_config')
    .select('distribuicao_automatica_ativa,proximo_sdr_id')
    .eq('id', 1)
    .maybeSingle();
  const distributionActive = hasDistributionUpdate
    ? body.distributionActive !== false
    : currentConfig?.distribuicao_automatica_ativa !== false;
  const requestedParticipants = Array.isArray(body.distributionParticipantIds)
    ? body.distributionParticipantIds.map((id: unknown) => String(id)).filter(Boolean)
    : null;
  const requestedNextProfileId = hasDistributionUpdate
    ? String(body.nextProfileId || '').trim() || null
    : currentConfig?.proximo_sdr_id || null;

  const { data: sdrRows, error: sdrError } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id')
    .eq('papel', 'sdr')
    .eq('ativo', true)
    .order('created_at', { ascending: true });
  if (sdrError) return NextResponse.json({ error: sdrError.message }, { status: 500 });
  const sdrIds = (sdrRows || []).map((member) => member.profile_id);
  let enabledIds = sdrIds;
  if (hasDistributionUpdate && requestedParticipants) {
    enabledIds = sdrIds.filter((id) => requestedParticipants.includes(id));
    const participantUpdates = sdrIds.map((profileId) =>
      supabaseAdmin
        .from('comercial_membros')
        .update({ distribuicao_ativa: enabledIds.includes(profileId), updated_at: new Date().toISOString() })
        .eq('profile_id', profileId)
    );
    const participantResults = await Promise.all(participantUpdates);
    const participantError = participantResults.find((result) => result.error)?.error;
    if (participantError) return NextResponse.json({ error: participantError.message }, { status: 500 });
  } else {
    const { data: enabledRows } = await supabaseAdmin
      .from('comercial_membros')
      .select('profile_id')
      .eq('papel', 'sdr')
      .eq('ativo', true)
      .eq('distribuicao_ativa', true);
    enabledIds = (enabledRows || []).map((member) => member.profile_id);
  }

  const nextProfileId = enabledIds.includes(requestedNextProfileId || '')
    ? requestedNextProfileId
    : enabledIds[0] || null;
  const { error } = await supabaseAdmin.from('comercial_config').upsert({
    id: 1,
    ia_sdr_ativa: active,
    ia_sdr_prompt: prompt,
    ia_sdr_profile_id: instanceProfileId,
    bot_comercial_ativo: botActive,
    bot_comercial_prompt: botPrompt,
    distribuicao_automatica_ativa: distributionActive,
    proximo_sdr_id: nextProfileId,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    active,
    prompt,
    instanceProfileId,
    botActive,
    botPrompt,
    distribution: { active: distributionActive, nextProfileId, participantIds: enabledIds },
  });
}
