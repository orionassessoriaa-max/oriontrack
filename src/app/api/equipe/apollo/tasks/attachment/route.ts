import { NextResponse } from 'next/server';
import {
  APOLLO_ROLES,
  APOLLO_TASK_ASSETS_BUCKET,
  APOLLO_TASK_MAX_IMAGE_SIZE,
  canManageApolloTasks,
  isActiveApolloProfile,
  safeApolloTaskFileName,
} from '@/lib/apolloTasks';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function ensureBucket() {
  const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
  if (listError) throw listError;
  if (buckets.some((bucket) => bucket.name === APOLLO_TASK_ASSETS_BUCKET)) return;

  const { error } = await supabaseAdmin.storage.createBucket(APOLLO_TASK_ASSETS_BUCKET, {
    public: false,
    fileSizeLimit: APOLLO_TASK_MAX_IMAGE_SIZE,
    allowedMimeTypes: ['image/*'],
  });
  if (error) throw error;
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, [...APOLLO_ROLES]);
  if ('error' in guard) return guard.error;
  if (!isActiveApolloProfile(guard.profile)) {
    return NextResponse.json({ error: 'Acesso exclusivo do time Apollo.' }, { status: 403 });
  }
  if (!canManageApolloTasks(guard.profile)) {
    return NextResponse.json({ error: 'Apenas administradores e o coordenador podem anexar prints.' }, { status: 403 });
  }

  const limited = rateLimit(request, 'apollo-task-attachment', {
    limit: 20,
    windowMs: 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  const form = await request.formData();
  const taskId = String(form.get('task_id') || '').trim();
  const file = form.get('file');
  if (!taskId || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Selecione uma tarefa e um print valido.' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'O anexo precisa ser uma imagem.' }, { status: 400 });
  }
  if (file.size > APOLLO_TASK_MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: 'A imagem deve ter no maximo 8 MB.' }, { status: 400 });
  }

  const { data: currentTask, error: taskError } = await supabaseAdmin
    .from('apollo_tasks')
    .select('id, anexo_path')
    .eq('id', taskId)
    .eq('equipe', 'apollo')
    .maybeSingle();
  if (taskError) throw taskError;
  if (!currentTask) return NextResponse.json({ error: 'Tarefa nao encontrada.' }, { status: 404 });

  await ensureBucket();
  const path = `${taskId}/${crypto.randomUUID()}-${safeApolloTaskFileName(file.name)}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(APOLLO_TASK_ASSETS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const now = new Date().toISOString();
  const { data: task, error: updateError } = await supabaseAdmin
    .from('apollo_tasks')
    .update({ anexo_path: path, anexo_nome: file.name.slice(0, 180), updated_at: now })
    .eq('id', taskId)
    .eq('equipe', 'apollo')
    .select('id, anexo_path, anexo_nome')
    .single();
  if (updateError) {
    await supabaseAdmin.storage.from(APOLLO_TASK_ASSETS_BUCKET).remove([path]);
    throw updateError;
  }

  if (currentTask.anexo_path) {
    await supabaseAdmin.storage.from(APOLLO_TASK_ASSETS_BUCKET).remove([currentTask.anexo_path]);
  }

  const { data: signed, error: signedError } = await supabaseAdmin.storage
    .from(APOLLO_TASK_ASSETS_BUCKET)
    .createSignedUrl(path, 60 * 60);

  await writeAuditLog(request, guard.profile, {
    action: 'apollo.task.attachment.update',
    entity_type: 'apollo_task',
    entity_id: taskId,
    metadata: { anexo_nome: task.anexo_nome },
  });

  return NextResponse.json({
    attachment: {
      ...task,
      anexo_url: signedError ? null : signed.signedUrl,
    },
  });
}
