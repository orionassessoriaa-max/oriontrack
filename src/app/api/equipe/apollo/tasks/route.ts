import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser, writeAuditLog, type ApiProfile } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isDevOpsManagerProfile, isOperationalCoordinatorProfile } from '@/lib/users';

const APOLLO_ROLES = ['admin', 'gestor_trafego', 'designer', 'account_manager'] as const;
const TASK_STATUSES = new Set(['a_fazer', 'fazendo', 'feito']);

type ApolloMember = {
  id: string;
  nome: string | null;
  email: string | null;
  email_real: string | null;
  tipo_usuario: string;
  is_admin_master?: boolean | null;
  equipe_orion?: string | null;
};

function isActiveApolloProfile(profile: ApiProfile) {
  return APOLLO_ROLES.includes(profile.tipo_usuario as (typeof APOLLO_ROLES)[number]);
}

function canManageAllTasks(profile: ApiProfile) {
  if (isDevOpsManagerProfile(profile)) return false;
  return profile.tipo_usuario === 'admin' || isOperationalCoordinatorProfile(profile);
}

async function loadApolloMembers() {
  const initial = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, status, is_admin_master, equipe_orion')
    .in('tipo_usuario', [...APOLLO_ROLES])
    .in('status', ['active', 'ativo', 'Ativo'])
    .order('nome', { ascending: true });

  let memberData = (initial.data || []) as ApolloMember[];
  let memberError = initial.error;

  if (memberError && String(memberError.message || '').includes('equipe_orion')) {
    const fallback = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, tipo_usuario, status, is_admin_master')
      .in('tipo_usuario', [...APOLLO_ROLES])
      .in('status', ['active', 'ativo', 'Ativo'])
      .order('nome', { ascending: true });
    memberData = (fallback.data || []).map((member) => ({ ...member, equipe_orion: null })) as ApolloMember[];
    memberError = fallback.error;
  }

  if (memberError) throw memberError;

  return memberData.filter((member) => {
    const isDev = isDevOpsManagerProfile(member);
    return isDev || member.equipe_orion === 'apollo' || member.tipo_usuario === 'admin';
  }) as ApolloMember[];
}

function missingMigration(error: unknown) {
  const message = String((error as { message?: string })?.message || error || '');
  return message.includes('apollo_tasks') && (message.includes('does not exist') || message.includes('schema cache'));
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...APOLLO_ROLES]);
  if ('error' in guard) return guard.error;
  if (!isActiveApolloProfile(guard.profile)) {
    return NextResponse.json({ error: 'Acesso exclusivo do time Apollo.' }, { status: 403 });
  }

  const manager = canManageAllTasks(guard.profile);
  const url = new URL(request.url);
  const requestedView = url.searchParams.get('view') === 'all' ? 'all' : 'mine';
  const view = manager ? requestedView : 'mine';

  try {
    const members = await loadApolloMembers();
    let tasksQuery = supabaseAdmin
      .from('apollo_tasks')
      .select('id, titulo, prazo, status, responsavel_profile_id, criado_por_profile_id, concluida_em, created_at, updated_at')
      .eq('equipe', 'apollo')
      .order('prazo', { ascending: true })
      .limit(500);

    if (view === 'mine') {
      tasksQuery = tasksQuery.eq('responsavel_profile_id', guard.profile.id);
    }

    const { data: tasks, error } = await tasksQuery;
    if (error) throw error;

    const memberById = new Map(members.map((member) => [member.id, member]));
    const hydratedTasks = (tasks || []).map((task) => ({
      ...task,
      responsavel: memberById.get(task.responsavel_profile_id) || null,
      criado_por: memberById.get(task.criado_por_profile_id) || null,
    }));

    return NextResponse.json({
      tasks: hydratedTasks,
      members,
      view,
      canManageAll: manager,
      currentProfileId: guard.profile.id,
      currentProfileName: guard.profile.nome,
    });
  } catch (error) {
    if (missingMigration(error)) {
      return NextResponse.json({ error: 'A migration das tarefas do Apollo ainda nao foi aplicada.' }, { status: 503 });
    }
    console.error('Apollo tasks GET failed:', error);
    return NextResponse.json({ error: 'Nao foi possivel carregar as tarefas do Apollo.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, [...APOLLO_ROLES]);
  if ('error' in guard) return guard.error;
  if (!isActiveApolloProfile(guard.profile)) {
    return NextResponse.json({ error: 'Acesso exclusivo do time Apollo.' }, { status: 403 });
  }

  const limited = rateLimit(request, 'apollo-tasks-write', {
    limit: 60,
    windowMs: 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  const manager = canManageAllTasks(guard.profile);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || 'create');

  try {
    if (action === 'create') {
      const titulo = String(body.titulo || '').trim();
      const prazo = new Date(String(body.prazo || ''));
      const requestedAssignee = String(body.responsavel_profile_id || guard.profile.id);
      const responsavelProfileId = manager ? requestedAssignee : guard.profile.id;

      if (titulo.length < 2 || titulo.length > 180) {
        return NextResponse.json({ error: 'Informe um titulo entre 2 e 180 caracteres.' }, { status: 400 });
      }
      if (Number.isNaN(prazo.getTime())) {
        return NextResponse.json({ error: 'Informe uma data e hora de entrega validas.' }, { status: 400 });
      }

      const members = await loadApolloMembers();
      if (!members.some((member) => member.id === responsavelProfileId)) {
        return NextResponse.json({ error: 'O responsavel precisa fazer parte do time Apollo.' }, { status: 400 });
      }

      const { data: task, error } = await supabaseAdmin
        .from('apollo_tasks')
        .insert({
          equipe: 'apollo',
          titulo,
          prazo: prazo.toISOString(),
          status: 'a_fazer',
          responsavel_profile_id: responsavelProfileId,
          criado_por_profile_id: guard.profile.id,
        })
        .select('id, titulo, prazo, status, responsavel_profile_id, criado_por_profile_id, concluida_em, created_at, updated_at')
        .single();
      if (error) throw error;

      await writeAuditLog(request, guard.profile, {
        action: 'apollo.task.create',
        entity_type: 'apollo_task',
        entity_id: task.id,
        metadata: { titulo, prazo: prazo.toISOString(), responsavel_profile_id: responsavelProfileId },
      });

      return NextResponse.json({ task }, { status: 201 });
    }

    if (action === 'update_status') {
      const taskId = String(body.task_id || '');
      const status = String(body.status || '');
      if (!taskId || !TASK_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Tarefa ou status invalido.' }, { status: 400 });
      }

      let ownershipQuery = supabaseAdmin
        .from('apollo_tasks')
        .select('id, responsavel_profile_id, status')
        .eq('id', taskId)
        .eq('equipe', 'apollo');
      if (!manager) ownershipQuery = ownershipQuery.eq('responsavel_profile_id', guard.profile.id);
      const { data: currentTask, error: ownershipError } = await ownershipQuery.maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!currentTask) return NextResponse.json({ error: 'Tarefa nao encontrada.' }, { status: 404 });

      const now = new Date().toISOString();
      const { data: task, error } = await supabaseAdmin
        .from('apollo_tasks')
        .update({
          status,
          concluida_em: status === 'feito' ? now : null,
          updated_at: now,
        })
        .eq('id', taskId)
        .select('id, titulo, prazo, status, responsavel_profile_id, criado_por_profile_id, concluida_em, created_at, updated_at')
        .single();
      if (error) throw error;

      await writeAuditLog(request, guard.profile, {
        action: 'apollo.task.status.update',
        entity_type: 'apollo_task',
        entity_id: taskId,
        metadata: { de: currentTask.status, para: status },
      });

      return NextResponse.json({ task });
    }

    return NextResponse.json({ error: 'Acao nao suportada.' }, { status: 400 });
  } catch (error) {
    if (missingMigration(error)) {
      return NextResponse.json({ error: 'A migration das tarefas do Apollo ainda nao foi aplicada.' }, { status: 503 });
    }
    console.error('Apollo tasks POST failed:', error);
    return NextResponse.json({ error: 'Nao foi possivel salvar a tarefa.' }, { status: 500 });
  }
}
