import { NextResponse } from 'next/server';
import {
  APOLLO_ROLES,
  APOLLO_TASK_ASSETS_BUCKET,
  canManageApolloTasks,
  isActiveApolloProfile,
} from '@/lib/apolloTasks';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notificarAndamentoTarefa, notificarRevisaoTarefa, notificarTarefaAtribuida } from '@/lib/taskNotifications';
import { encontrarPreset } from '@/lib/apolloTaskPresets';
import { isDevOpsManagerProfile } from '@/lib/users';

const TASK_STATUSES = new Set(['a_fazer', 'fazendo', 'feito']);
const TASK_PRIORITIES = new Set(['baixa', 'normal', 'alta', 'urgente']);
const PRIORITY_WEIGHT: Record<string, number> = { baixa: 0, normal: 1, alta: 2, urgente: 3 };
const TASK_SELECT = 'id, titulo, descricao, prazo, status, prioridade, responsavel_profile_id, criado_por_profile_id, anexo_path, anexo_nome, iniciada_em, concluida_em, predefinicao, created_at, updated_at';

type ApolloMember = {
  id: string;
  nome: string | null;
  email: string | null;
  email_real: string | null;
  tipo_usuario: string;
  is_admin_master?: boolean | null;
  equipe_orion?: string | null;
};

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
  return ['apollo_tasks', 'descricao', 'anexo_path', 'anexo_nome'].some((field) => message.includes(field))
    && (message.includes('does not exist') || message.includes('schema cache') || message.includes('column'));
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...APOLLO_ROLES]);
  if ('error' in guard) return guard.error;
  if (!isActiveApolloProfile(guard.profile)) {
    return NextResponse.json({ error: 'Acesso exclusivo do time Apollo.' }, { status: 403 });
  }

  const manager = canManageApolloTasks(guard.profile);
  const url = new URL(request.url);
  const requestedView = url.searchParams.get('view') === 'all' ? 'all' : 'mine';
  const view = manager ? requestedView : 'mine';

  try {
    const members = await loadApolloMembers();
    let tasksQuery = supabaseAdmin
      .from('apollo_tasks')
      .select(TASK_SELECT)
      .eq('equipe', 'apollo')
      .order('prazo', { ascending: true })
      .limit(500);

    if (view === 'mine') {
      tasksQuery = tasksQuery.eq('responsavel_profile_id', guard.profile.id);
    }

    const { data: tasks, error } = await tasksQuery;
    if (error) throw error;

    const attachmentPaths = Array.from(new Set((tasks || []).map((task) => task.anexo_path).filter(Boolean))) as string[];
    const { data: signedAttachments, error: signedError } = attachmentPaths.length
      ? await supabaseAdmin.storage.from(APOLLO_TASK_ASSETS_BUCKET).createSignedUrls(attachmentPaths, 60 * 60)
      : { data: [], error: null };
    if (signedError) console.error('Apollo task signed URLs failed:', signedError);
    const attachmentUrlByPath = new Map((signedAttachments || [])
      .filter((attachment) => attachment.path && attachment.signedUrl)
      .map((attachment) => [attachment.path as string, attachment.signedUrl as string]));
    const memberById = new Map(members.map((member) => [member.id, member]));

    // Revisoes pedidas por quem criou a tarefa, para aparecerem no detalhe.
    const taskIds = (tasks || []).map((task) => task.id);
    const { data: revisoes } = taskIds.length
      ? await supabaseAdmin
          .from('apollo_task_revisoes')
          .select('id, task_id, autor_profile_id, titulo, comentario, created_at')
          .in('task_id', taskIds)
          .order('created_at', { ascending: false })
      : { data: [] };
    type RevisaoHidratada = {
      id: string;
      task_id: string;
      autor_profile_id: string | null;
      titulo: string;
      comentario: string | null;
      created_at: string;
      autor: ApolloMember | null;
    };
    const revisoesPorTarefa = new Map<string, RevisaoHidratada[]>();
    for (const revisao of revisoes || []) {
      const lista = revisoesPorTarefa.get(revisao.task_id) || [];
      lista.push({ ...revisao, autor: memberById.get(revisao.autor_profile_id) || null });
      revisoesPorTarefa.set(revisao.task_id, lista);
    }

    const { data: itens } = taskIds.length
      ? await supabaseAdmin
          .from('apollo_task_itens')
          .select('id, task_id, ordem, titulo, concluido, concluido_em')
          .in('task_id', taskIds)
          .order('ordem', { ascending: true })
      : { data: [] };
    const itensPorTarefa = new Map<string, typeof itens>();
    for (const item of itens || []) {
      const lista = itensPorTarefa.get(item.task_id) || [];
      lista.push(item);
      itensPorTarefa.set(item.task_id, lista);
    }

    const hydratedTasks = (tasks || [])
      .map((task) => ({
        ...task,
        anexo_url: task.anexo_path ? attachmentUrlByPath.get(task.anexo_path) || null : null,
        responsavel: memberById.get(task.responsavel_profile_id) || null,
        criado_por: memberById.get(task.criado_por_profile_id) || null,
        revisoes: revisoesPorTarefa.get(task.id) || [],
        itens: itensPorTarefa.get(task.id) || [],
      }))
      .sort((a, b) => {
        const priorityDifference = (PRIORITY_WEIGHT[b.prioridade] ?? 1) - (PRIORITY_WEIGHT[a.prioridade] ?? 1);
        return priorityDifference || new Date(a.prazo).getTime() - new Date(b.prazo).getTime();
      });

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

  const manager = canManageApolloTasks(guard.profile);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || 'create');

  try {
    if (action === 'create') {
      // A predefinicao manda: o titulo vira "Criar funil {nome}" e o checklist
      // vem do catalogo do servidor, nao do que o navegador enviar.
      const preset = encontrarPreset(String(body.predefinicao || ''));
      const nomeDemanda = String(body.nome_demanda || '').trim();
      const titulo = preset && nomeDemanda
        ? `${preset.prefixoTitulo} ${nomeDemanda}`.trim()
        : String(body.titulo || '').trim();
      const descricao = String(body.descricao || '').trim();
      const prazo = preset && !body.prazo
        ? new Date(Date.now() + preset.prazoHoras * 3600_000)
        : new Date(String(body.prazo || ''));
      const prioridade = String(body.prioridade || 'normal');
      const requestedAssignee = String(body.responsavel_profile_id || guard.profile.id);
      const responsavelProfileId = manager ? requestedAssignee : guard.profile.id;

      if (titulo.length < 2 || titulo.length > 180) {
        return NextResponse.json({ error: 'Informe um titulo entre 2 e 180 caracteres.' }, { status: 400 });
      }
      if (descricao.length > 4000) {
        return NextResponse.json({ error: 'A descricao deve ter no maximo 4000 caracteres.' }, { status: 400 });
      }
      if (Number.isNaN(prazo.getTime())) {
        return NextResponse.json({ error: 'Informe uma data e hora de entrega validas.' }, { status: 400 });
      }
      if (!TASK_PRIORITIES.has(prioridade)) {
        return NextResponse.json({ error: 'Informe uma prioridade valida.' }, { status: 400 });
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
          descricao,
          prazo: prazo.toISOString(),
          status: 'a_fazer',
          prioridade,
          responsavel_profile_id: responsavelProfileId,
          criado_por_profile_id: guard.profile.id,
          predefinicao: preset?.chave || null,
        })
        .select(TASK_SELECT)
        .single();
      if (error) throw error;

      // Checklist vem da predefinicao ou do que a pessoa digitou no formulario.
      const checklistManual = Array.isArray(body.checklist)
        ? (body.checklist as unknown[])
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0 && item.length <= 180)
            .slice(0, 20)
        : [];
      const checklist = preset?.checklist.length ? preset.checklist : checklistManual;
      if (checklist.length) {
        const { error: itensError } = await supabaseAdmin.from('apollo_task_itens').insert(
          checklist.map((item, indice) => ({ task_id: task.id, ordem: indice, titulo: item })),
        );
        if (itensError) throw itensError;
      }

      // Notificar nao pode derrubar a criacao: se o WhatsApp falhar, a tarefa
      // continua criada e o erro fica no log.
      void notificarTarefaAtribuida({
        titulo,
        descricao,
        prazo: prazo.toISOString(),
        responsavelProfileId,
        autorProfileId: guard.profile.id,
        origem: 'apollo',
      }).catch((erro) => console.error('[apollo tasks] notificacao falhou:', erro));

      await writeAuditLog(request, guard.profile, {
        action: 'apollo.task.create',
        entity_type: 'apollo_task',
        entity_id: task.id,
        metadata: { titulo, prazo: prazo.toISOString(), prioridade, responsavel_profile_id: responsavelProfileId, tem_descricao: Boolean(descricao) },
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
        .select('id, titulo, status, responsavel_profile_id, criado_por_profile_id, iniciada_em')
        .eq('id', taskId)
        .eq('equipe', 'apollo');
      if (!manager) ownershipQuery = ownershipQuery.eq('responsavel_profile_id', guard.profile.id);
      const { data: currentTask, error: ownershipError } = await ownershipQuery.maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!currentTask) return NextResponse.json({ error: 'Tarefa nao encontrada.' }, { status: 404 });

      const now = new Date().toISOString();
      // O relogio da entrega comeca na primeira vez que a tarefa vai para
      // "fazendo" e nao reinicia se ela voltar e avancar de novo.
      const iniciadaEm = status === 'fazendo' ? currentTask.iniciada_em || now : currentTask.iniciada_em;
      const { data: task, error } = await supabaseAdmin
        .from('apollo_tasks')
        .update({
          status,
          iniciada_em: status === 'a_fazer' ? null : iniciadaEm,
          concluida_em: status === 'feito' ? now : null,
          updated_at: now,
        })
        .eq('id', taskId)
        .select(TASK_SELECT)
        .single();
      if (error) throw error;

      // Quem criou a tarefa acompanha: aviso ao iniciar e ao entregar.
      if (currentTask.status !== status && (status === 'fazendo' || status === 'feito')) {
        void notificarAndamentoTarefa({
          titulo: currentTask.titulo,
          status,
          criadorProfileId: currentTask.criado_por_profile_id,
          responsavelProfileId: currentTask.responsavel_profile_id,
          quemMoveuProfileId: guard.profile.id,
          iniciadaEm,
          concluidaEm: status === 'feito' ? now : null,
        }).catch((erro) => console.error('[apollo tasks] aviso de andamento falhou:', erro));
      }

      await writeAuditLog(request, guard.profile, {
        action: 'apollo.task.status.update',
        entity_type: 'apollo_task',
        entity_id: taskId,
        metadata: { de: currentTask.status, para: status },
      });

      return NextResponse.json({ task });
    }

    if (action === 'toggle_item') {
      const itemId = String(body.item_id || '').trim();
      if (!itemId) return NextResponse.json({ error: 'Informe o item.' }, { status: 400 });

      const { data: item, error: itemError } = await supabaseAdmin
        .from('apollo_task_itens')
        .select('id, task_id, concluido')
        .eq('id', itemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) return NextResponse.json({ error: 'Item nao encontrado.' }, { status: 404 });

      // Marcar item e do responsavel pela tarefa, ou da coordenacao.
      const { data: dona } = await supabaseAdmin
        .from('apollo_tasks')
        .select('id, responsavel_profile_id')
        .eq('id', item.task_id)
        .maybeSingle();
      if (!manager && dona?.responsavel_profile_id !== guard.profile.id) {
        return NextResponse.json({ error: 'Apenas o responsavel marca o checklist.' }, { status: 403 });
      }

      const concluido = !item.concluido;
      const { error: updateError } = await supabaseAdmin
        .from('apollo_task_itens')
        .update({ concluido, concluido_em: concluido ? new Date().toISOString() : null })
        .eq('id', itemId);
      if (updateError) throw updateError;

      return NextResponse.json({ item_id: itemId, concluido });
    }

    if (action === 'revisar') {
      const taskId = String(body.task_id || '').trim();
      const tituloRevisao = String(body.titulo || '').trim();
      const comentario = String(body.comentario || '').trim();
      if (!taskId || tituloRevisao.length < 2) {
        return NextResponse.json({ error: 'Informe a tarefa e um titulo para a revisao.' }, { status: 400 });
      }
      if (comentario.length > 2000) {
        return NextResponse.json({ error: 'O comentario deve ter no maximo 2000 caracteres.' }, { status: 400 });
      }

      const { data: alvo, error: alvoError } = await supabaseAdmin
        .from('apollo_tasks')
        .select('id, titulo, responsavel_profile_id, criado_por_profile_id')
        .eq('id', taskId)
        .eq('equipe', 'apollo')
        .maybeSingle();
      if (alvoError) throw alvoError;
      if (!alvo) return NextResponse.json({ error: 'Tarefa nao encontrada.' }, { status: 404 });

      // Revisao e do dono da demanda: quem pediu a tarefa, ou a coordenacao.
      if (!manager && alvo.criado_por_profile_id !== guard.profile.id) {
        return NextResponse.json({ error: 'Apenas quem criou a tarefa pode pedir revisao.' }, { status: 403 });
      }

      const { error: revisaoError } = await supabaseAdmin.from('apollo_task_revisoes').insert({
        task_id: taskId,
        autor_profile_id: guard.profile.id,
        titulo: tituloRevisao,
        comentario: comentario || null,
      });
      if (revisaoError) throw revisaoError;

      // A tarefa volta para "fazendo": entregue com pendencia nao e entregue.
      const agora = new Date().toISOString();
      const { data: task, error: statusError } = await supabaseAdmin
        .from('apollo_tasks')
        .update({ status: 'fazendo', concluida_em: null, updated_at: agora })
        .eq('id', taskId)
        .select(TASK_SELECT)
        .single();
      if (statusError) throw statusError;

      void notificarRevisaoTarefa({
        tituloTarefa: alvo.titulo,
        tituloRevisao,
        comentario,
        responsavelProfileId: alvo.responsavel_profile_id,
        autorProfileId: guard.profile.id,
      }).catch((erro) => console.error('[apollo tasks] aviso de revisao falhou:', erro));

      await writeAuditLog(request, guard.profile, {
        action: 'apollo.task.revisao',
        entity_type: 'apollo_task',
        entity_id: taskId,
        metadata: { titulo: tituloRevisao, tem_comentario: Boolean(comentario) },
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

export async function PATCH(request: Request) {
  const guard = await requireApiUser(request, [...APOLLO_ROLES]);
  if ('error' in guard) return guard.error;
  if (!isActiveApolloProfile(guard.profile)) {
    return NextResponse.json({ error: 'Acesso exclusivo do time Apollo.' }, { status: 403 });
  }
  if (!canManageApolloTasks(guard.profile)) {
    return NextResponse.json({ error: 'Apenas administradores e o coordenador podem editar tarefas.' }, { status: 403 });
  }

  const limited = rateLimit(request, 'apollo-tasks-edit', {
    limit: 60,
    windowMs: 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const taskId = String(body.task_id || '').trim();
  const titulo = String(body.titulo || '').trim();
  const descricao = String(body.descricao || '').trim();
  const prazo = new Date(String(body.prazo || ''));
  const prioridade = String(body.prioridade || 'normal');
  const responsavelProfileId = String(body.responsavel_profile_id || '').trim();
  const removeAttachment = body.remove_attachment === true;

  if (!taskId) return NextResponse.json({ error: 'Informe a tarefa.' }, { status: 400 });
  if (titulo.length < 2 || titulo.length > 180) {
    return NextResponse.json({ error: 'Informe um titulo entre 2 e 180 caracteres.' }, { status: 400 });
  }
  if (descricao.length > 4000) {
    return NextResponse.json({ error: 'A descricao deve ter no maximo 4000 caracteres.' }, { status: 400 });
  }
  if (Number.isNaN(prazo.getTime())) {
    return NextResponse.json({ error: 'Informe uma data e hora de entrega validas.' }, { status: 400 });
  }
  if (!TASK_PRIORITIES.has(prioridade)) {
    return NextResponse.json({ error: 'Informe uma prioridade valida.' }, { status: 400 });
  }

  try {
    const members = await loadApolloMembers();
    if (!members.some((member) => member.id === responsavelProfileId)) {
      return NextResponse.json({ error: 'O responsavel precisa fazer parte do time Apollo.' }, { status: 400 });
    }

    const { data: currentTask, error: currentError } = await supabaseAdmin
      .from('apollo_tasks')
      .select('id, titulo, anexo_path, responsavel_profile_id')
      .eq('id', taskId)
      .eq('equipe', 'apollo')
      .maybeSingle();
    if (currentError) throw currentError;
    if (!currentTask) return NextResponse.json({ error: 'Tarefa nao encontrada.' }, { status: 404 });

    const now = new Date().toISOString();
    const update: Record<string, string | null> = {
      titulo,
      descricao,
      prazo: prazo.toISOString(),
      prioridade,
      responsavel_profile_id: responsavelProfileId,
      updated_at: now,
    };
    if (removeAttachment) {
      update.anexo_path = null;
      update.anexo_nome = null;
    }

    const { data: task, error } = await supabaseAdmin
      .from('apollo_tasks')
      .update(update)
      .eq('id', taskId)
      .eq('equipe', 'apollo')
      .select(TASK_SELECT)
      .single();
    if (error) throw error;

    // Trocar o dono da tarefa avisa quem passou a ser responsavel. Editar
    // titulo ou prazo sem trocar o dono nao dispara nada.
    if (currentTask.responsavel_profile_id !== responsavelProfileId) {
      void notificarTarefaAtribuida({
        titulo,
        descricao,
        prazo: prazo.toISOString(),
        responsavelProfileId,
        autorProfileId: guard.profile.id,
        origem: 'apollo',
      }).catch((erro) => console.error('[apollo tasks] notificacao falhou:', erro));
    }

    if (removeAttachment && currentTask.anexo_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from(APOLLO_TASK_ASSETS_BUCKET)
        .remove([currentTask.anexo_path]);
      if (storageError) console.error('Apollo task attachment removal failed:', storageError);
    }

    await writeAuditLog(request, guard.profile, {
      action: 'apollo.task.update',
      entity_type: 'apollo_task',
      entity_id: taskId,
      metadata: {
        titulo_anterior: currentTask.titulo,
        titulo,
        prazo: prazo.toISOString(),
        prioridade,
        responsavel_profile_id: responsavelProfileId,
        removeu_anexo: removeAttachment,
      },
    });

    return NextResponse.json({ task });
  } catch (error) {
    if (missingMigration(error)) {
      return NextResponse.json({ error: 'A migration de detalhes das tarefas do Apollo ainda nao foi aplicada.' }, { status: 503 });
    }
    console.error('Apollo tasks PATCH failed:', error);
    return NextResponse.json({ error: 'Nao foi possivel editar a tarefa.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireApiUser(request, [...APOLLO_ROLES]);
  if ('error' in guard) return guard.error;
  if (!isActiveApolloProfile(guard.profile)) {
    return NextResponse.json({ error: 'Acesso exclusivo do time Apollo.' }, { status: 403 });
  }
  if (!canManageApolloTasks(guard.profile)) {
    return NextResponse.json({ error: 'Apenas administradores e o coordenador podem excluir tarefas.' }, { status: 403 });
  }

  const limited = rateLimit(request, 'apollo-tasks-delete', {
    limit: 30,
    windowMs: 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  const taskId = new URL(request.url).searchParams.get('task_id') || '';
  if (!taskId) return NextResponse.json({ error: 'Informe a tarefa.' }, { status: 400 });

  try {
    const { data: currentTask, error: currentError } = await supabaseAdmin
      .from('apollo_tasks')
      .select('id, titulo, anexo_path, responsavel_profile_id')
      .eq('id', taskId)
      .eq('equipe', 'apollo')
      .maybeSingle();
    if (currentError) throw currentError;
    if (!currentTask) return NextResponse.json({ error: 'Tarefa nao encontrada.' }, { status: 404 });

    const { error } = await supabaseAdmin
      .from('apollo_tasks')
      .delete()
      .eq('id', taskId)
      .eq('equipe', 'apollo');
    if (error) throw error;

    if (currentTask.anexo_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from(APOLLO_TASK_ASSETS_BUCKET)
        .remove([currentTask.anexo_path]);
      if (storageError) console.error('Apollo task attachment cleanup failed:', storageError);
    }

    await writeAuditLog(request, guard.profile, {
      action: 'apollo.task.delete',
      entity_type: 'apollo_task',
      entity_id: taskId,
      metadata: { titulo: currentTask.titulo },
    });

    return NextResponse.json({ deleted: true, task_id: taskId });
  } catch (error) {
    if (missingMigration(error)) {
      return NextResponse.json({ error: 'A migration de detalhes das tarefas do Apollo ainda nao foi aplicada.' }, { status: 503 });
    }
    console.error('Apollo tasks DELETE failed:', error);
    return NextResponse.json({ error: 'Nao foi possivel excluir a tarefa.' }, { status: 500 });
  }
}
