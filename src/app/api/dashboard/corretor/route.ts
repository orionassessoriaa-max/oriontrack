import { NextResponse } from 'next/server';
import { type ApiProfile, requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = [
  'admin',
  'gestor_trafego',
  'account_manager',
  'corretor',
  'corretor_admin',
  'corretor_membro',
] as const;

const LEAD_METRIC_COLUMNS = [
  'status',
  'conta_como_venda',
  'data_entrada',
  'origem',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'operadora',
  'observacoes',
  'cidade',
  'valor_negociacao',
  'responsavel_profile_id',
  'cadencia_ativa',
  'cadencia_inicio',
  'cadencia_fim',
].join(',');

const READ_TIMEOUT_MS = 4_000;
const READ_ATTEMPTS = 2;
const BROKER_ROLES = ['corretor', 'corretor_admin', 'corretor_membro'] as const;

type ReadResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

function isTransientReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /abort|timeout|timed out|fetch|network|load failed/i.test(message);
}

async function readWithRetry<T>(
  operation: (signal: AbortSignal) => PromiseLike<ReadResult<T>>,
): Promise<ReadResult<T>> {
  let lastResult: ReadResult<T> = { data: null, error: { message: 'Falha temporaria na consulta.' } };

  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
      lastResult = await operation(controller.signal);
      if (!lastResult.error || !isTransientReadError(lastResult.error.message) || attempt === READ_ATTEMPTS) {
        return lastResult;
      }
    } catch (error) {
      lastResult = { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
      if (!isTransientReadError(error) || attempt === READ_ATTEMPTS) return lastResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  return lastResult;
}

async function resolveViewedProfile(request: Request, actor: ApiProfile, requestedCorretorId: string) {
  const targetProfileId = String(request.headers.get('x-orion-view-profile-id') || '').trim();
  if (!targetProfileId || targetProfileId === actor.id) return actor;

  if (!['admin', 'gestor_trafego', 'account_manager'].includes(actor.tipo_usuario)) {
    return null;
  }

  const { data: target, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,email_real,nome,tipo_usuario,corretor_id,telefone,status,is_admin_master,equipe_orion')
    .eq('id', targetProfileId)
    .in('tipo_usuario', [...BROKER_ROLES])
    .maybeSingle();

  if (error || !target || target.corretor_id !== requestedCorretorId) return null;

  if (actor.tipo_usuario === 'gestor_trafego') {
    const { data: broker } = await supabaseAdmin
      .from('corretores')
      .select('gestor_trafego_id')
      .eq('id', requestedCorretorId)
      .maybeSingle();
    if (broker?.gestor_trafego_id !== actor.id) return null;
  }

  return target as ApiProfile;
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request, [...ALLOWED_ROLES]);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const requestedCorretorId = url.searchParams.get('corretor_id');
  if (!requestedCorretorId) {
    return NextResponse.json({ error: 'Corretor nao informado.' }, { status: 400 });
  }

  // A permissao vem do usuario autenticado, mas os numeros devem representar
  // o perfil escolhido no modo de visualizacao administrativa.
  const viewedProfile = await resolveViewedProfile(request, auth.profile, requestedCorretorId);
  if (!viewedProfile) {
    return NextResponse.json({ error: 'Perfil visualizado nao autorizado.' }, { status: 403 });
  }

  const isBroker = BROKER_ROLES.includes(auth.profile.tipo_usuario as typeof BROKER_ROLES[number]);
  if (isBroker && auth.profile.corretor_id !== requestedCorretorId) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const { data: corretor, error: corretorError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, email, telefone, link_pagina, gestor_trafego_id, time_operacional')
    .eq('id', requestedCorretorId)
    .maybeSingle();

  if (corretorError) {
    return NextResponse.json({ error: corretorError.message }, { status: 500 });
  }
  if (!corretor) {
    return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
  }

  let brokerIds = [requestedCorretorId];
  if (corretor.nome_empresa) {
    const { data: siblings, error: siblingsError } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('nome_empresa', corretor.nome_empresa);

    if (siblingsError) {
      return NextResponse.json({ error: siblingsError.message }, { status: 500 });
    }
    if (siblings?.length) brokerIds = siblings.map((item) => item.id);
  }

  const responsibleProfileId = viewedProfile.tipo_usuario === 'corretor_membro'
    ? viewedProfile.id
    : null;

  if (url.searchParams.get('range_only') === '1') {
    let oldestLeadQuery = supabaseAdmin
      .from('leads')
      .select('data_entrada')
      .in('corretor_id', brokerIds)
      .not('data_entrada', 'is', null)
      .order('data_entrada', { ascending: true })
      .limit(1);

    if (responsibleProfileId) {
      oldestLeadQuery = oldestLeadQuery.eq('responsavel_profile_id', responsibleProfileId);
    }

    const { data: oldestLead, error: oldestLeadError } = await oldestLeadQuery.maybeSingle();

    if (oldestLeadError) {
      return NextResponse.json({ error: oldestLeadError.message }, { status: 500 });
    }

    return NextResponse.json(
      { oldestDate: oldestLead?.data_entrada?.slice(0, 10) || null },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const pageSize = 1000;
  const leads = [];

  const pendingTasksPromise = readWithRetry((signal) => {
    let query = supabaseAdmin
      .from('lead_tarefas')
      .select('id, vencimento')
      .in('corretor_id', brokerIds)
      .eq('status', 'pendente');

    if (responsibleProfileId) {
      query = query.eq('responsavel_profile_id', responsibleProfileId);
    }

    return query.abortSignal(signal);
  });

  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    let leadsQuery = supabaseAdmin
      .from('leads')
      .select(LEAD_METRIC_COLUMNS)
      .in('corretor_id', brokerIds)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (responsibleProfileId) {
      leadsQuery = leadsQuery.eq('responsavel_profile_id', responsibleProfileId);
    }

    const { data: pageRows, error: leadsError } = await readWithRetry((signal) =>
      leadsQuery.abortSignal(signal),
    );
    if (leadsError) {
      return NextResponse.json({ error: leadsError.message }, { status: 500 });
    }

    leads.push(...(pageRows || []));
    if (!pageRows || pageRows.length < pageSize) break;
  }

  const { data: pendingTasks, error: tasksError } = await pendingTasksPromise;
  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 500 });
  }

  return NextResponse.json(
    { corretor, leads, pendingTasks: pendingTasks || [] },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
