import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { rateLimit } from '@/lib/api/security';

async function requireUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, tipo_usuario, corretor_id, nome, email, email_real')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return { error: NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 403 }) };
  }

  return { user, profile };
}

export async function GET(request: Request) {
  const guard = await requireUser(request);
  if ('error' in guard) return guard.error;

  const allowedRoles = ['admin', 'gestor_trafego', 'designer', 'account_manager', 'corretor'];
  if (!allowedRoles.includes(guard.profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let query = supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, email, telefone, gestor_trafego_id, time_operacional, meta_ad_account_id, meta_ad_account_name, facebook_login, facebook_senha, regioes_campanha, campanhas_ativas, onboarding_status, operadoras_info, observacoes, status')
    .order('nome', { ascending: true });

  if (guard.profile.tipo_usuario === 'corretor') {
    query = query.eq('id', guard.profile.corretor_id);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const corretores = guard.profile.tipo_usuario === 'gestor_trafego'
    ? (data || []).filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, guard.profile))
    : (data || []);

  return NextResponse.json({ corretores });
}

export async function PATCH(request: Request) {
  try {
    const guard = await requireUser(request);
    if ('error' in guard) return guard.error;
    if (!['admin', 'gestor_trafego'].includes(guard.profile.tipo_usuario)) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }

    const limited = rateLimit(request, 'corretores:entrada:update', { limit: 60, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const corretorId = String(body.corretor_id || '').trim();
    if (!corretorId) {
      return NextResponse.json({ error: 'Concessionaria nao informada.' }, { status: 400 });
    }

    const { data: selected, error: selectedError } = await supabaseAdmin
      .from('corretores')
      .select('id,nome_empresa,gestor_trafego_id,time_operacional')
      .eq('id', corretorId)
      .maybeSingle();

    if (selectedError) throw selectedError;
    if (!selected) {
      return NextResponse.json({ error: 'Concessionaria nao encontrada.' }, { status: 404 });
    }
    if (guard.profile.tipo_usuario === 'gestor_trafego' && !isGestorLinkedToConcessionariaCorretor(selected, guard.profile)) {
      return NextResponse.json({ error: 'Concessionaria fora da carteira deste gestor.' }, { status: 403 });
    }

    const companyName = String(selected.nome_empresa || '').trim();
    if (!companyName) {
      return NextResponse.json({ error: 'Concessionaria sem nome cadastrado.' }, { status: 400 });
    }
    const campaignsActive = body.campanhas_ativas === true;
    const onboardingStatus = campaignsActive ? 'campanhas_ativas' : 'dados_completos';
    const selectedOperators = Array.isArray(body.operadoras)
      ? body.operadoras.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 40)
      : [];

    let companyQuery = supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', companyName);
    if (guard.profile.tipo_usuario === 'gestor_trafego') {
      companyQuery = companyQuery.eq('gestor_trafego_id', guard.profile.id);
    }
    const { data: companyRows, error: companyError } = await companyQuery;
    if (companyError) throw companyError;
    const companyIds = (companyRows || []).map((row) => row.id);
    if (!companyIds.length) {
      return NextResponse.json({ error: 'Nenhum registro autorizado para atualizar.' }, { status: 403 });
    }

    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from('corretores')
      .update({
        facebook_login: String(body.facebook_login || '').trim() || null,
        facebook_senha: String(body.facebook_senha || '') || null,
        regioes_campanha: String(body.regioes_campanha || '').trim() || null,
        operadoras_info: { selecionadas: selectedOperators },
        campanhas_ativas: campaignsActive,
        onboarding_status: onboardingStatus,
        observacoes: String(body.observacoes || '').trim() || null,
      })
      .in('id', companyIds)
      .select('id,campanhas_ativas,onboarding_status');

    if (updateError) throw updateError;
    if (!updatedRows?.length || updatedRows.some((row) => row.campanhas_ativas !== campaignsActive || row.onboarding_status !== onboardingStatus)) {
      return NextResponse.json({ error: 'O banco nao confirmou a atualizacao da entrada.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      updated_ids: updatedRows.map((row) => row.id),
      campanhas_ativas: campaignsActive,
      onboarding_status: onboardingStatus,
    });
  } catch (error: any) {
    console.error('[api_corretores_options] PATCH error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao salvar a entrada.' },
      { status: 500 },
    );
  }
}
