'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import GoogleTaskList from '@/components/tasks/GoogleTaskList';
import { supabase } from '@/lib/supabase/client';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileImage,
  Filter,
  LayoutDashboard,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

type TaskStatus = 'a_fazer' | 'fazendo' | 'feito';
type TaskPriority = 'baixa' | 'normal' | 'alta' | 'urgente';

type Member = {
  id: string;
  nome: string | null;
  email: string | null;
  email_real: string | null;
  tipo_usuario: string;
  is_admin_master?: boolean | null;
};

type ApolloTask = {
  id: string;
  titulo: string;
  descricao: string;
  prazo: string;
  status: TaskStatus;
  prioridade: TaskPriority;
  responsavel_profile_id: string;
  criado_por_profile_id: string;
  anexo_path: string | null;
  anexo_nome: string | null;
  anexo_url: string | null;
  concluida_em: string | null;
  created_at: string;
  updated_at: string;
  responsavel: Member | null;
  criado_por: Member | null;
};

type TasksPayload = {
  tasks: ApolloTask[];
  members: Member[];
  view: 'mine' | 'all';
  canManageAll: boolean;
  currentProfileId: string;
  currentProfileName: string | null;
};

const columns: Array<{
  status: TaskStatus;
  title: string;
  description: string;
  icon: typeof CircleDashed;
  tone: string;
  rail: string;
}> = [
  {
    status: 'a_fazer',
    title: 'A fazer',
    description: 'Entregas que ainda nao comecaram',
    icon: CircleDashed,
    tone: 'text-sky-300',
    rail: 'bg-sky-400',
  },
  {
    status: 'fazendo',
    title: 'Fazendo',
    description: 'Trabalho em andamento agora',
    icon: Clock3,
    tone: 'text-amber-300',
    rail: 'bg-amber-400',
  },
  {
    status: 'feito',
    title: 'Feito',
    description: 'Entregas finalizadas pelo time',
    icon: CheckCircle2,
    tone: 'text-emerald-300',
    rail: 'bg-emerald-400',
  },
];

const priorityOptions: Array<{ value: TaskPriority; label: string; className: string }> = [
  { value: 'urgente', label: 'Urgente', className: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  { value: 'alta', label: 'Alta', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  { value: 'normal', label: 'Normal', className: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  { value: 'baixa', label: 'Baixa', className: 'border-slate-600 bg-slate-800 text-slate-300' },
];

const priorityWeight: Record<TaskPriority, number> = { baixa: 0, normal: 1, alta: 2, urgente: 3 };

function defaultDeadline() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(18, 0, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayName(member: Member | null | undefined) {
  return member?.nome || member?.email_real || member?.email || 'Usuario Apollo';
}

function deadlineLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function deadlineInputValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function deadlineState(task: ApolloTask) {
  if (task.status === 'feito') return { label: 'Concluida', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' };
  const deadline = new Date(task.prazo).getTime();
  const now = Date.now();
  const today = new Date();
  const dueDate = new Date(task.prazo);
  const sameDay = today.toDateString() === dueDate.toDateString();
  if (deadline < now) return { label: 'Atrasada', className: 'text-rose-300 bg-rose-500/10 border-rose-500/20' };
  if (sameDay) return { label: 'Hoje', className: 'text-amber-300 bg-amber-500/10 border-amber-500/20' };
  return { label: 'No prazo', className: 'text-sky-300 bg-sky-500/10 border-sky-500/20' };
}

export default function ApolloTasksPage() {
  const [tasks, setTasks] = useState<ApolloTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [canManageAll, setCanManageAll] = useState(false);
  const [currentProfileId, setCurrentProfileId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ApolloTask | null>(null);
  const [deleteTask, setDeleteTask] = useState<ApolloTask | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [prazo, setPrazo] = useState(defaultDeadline);
  const [prioridade, setPrioridade] = useState<TaskPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const apiRequest = useCallback(async (url: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessao expirada. Entre novamente.');
    const formDataRequest = init?.body instanceof FormData;
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(!formDataRequest ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Nao foi possivel concluir a acao.');
    return payload;
  }, []);

  const loadTasks = useCallback(async (requestedView: 'mine' | 'all') => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest(`/api/equipe/apollo/tasks?view=${requestedView}`) as TasksPayload;
      setTasks(payload.tasks || []);
      setMembers(payload.members || []);
      setCanManageAll(Boolean(payload.canManageAll));
      setCurrentProfileId(payload.currentProfileId || '');
      setView(payload.view || 'mine');
      setAssigneeId((current) => current || payload.currentProfileId || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel carregar as tarefas.');
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadTasks('mine'));
    return () => window.cancelAnimationFrame(frame);
  }, [loadTasks]);

  const tasksByStatus = useMemo(() => {
    return columns.reduce<Record<TaskStatus, ApolloTask[]>>((result, column) => {
      result[column.status] = tasks
        .filter((task) => task.status === column.status
          && (assigneeFilter === 'all' || task.responsavel_profile_id === assigneeFilter))
        .sort((a, b) => {
          const priorityDifference = priorityWeight[b.prioridade || 'normal'] - priorityWeight[a.prioridade || 'normal'];
          return priorityDifference || new Date(a.prazo).getTime() - new Date(b.prazo).getTime();
        });
      return result;
    }, { a_fazer: [], fazendo: [], feito: [] });
  }, [assigneeFilter, tasks]);

  function closeTaskModal() {
    setModalOpen(false);
    setEditingTask(null);
    setAttachment(null);
    setRemoveAttachment(false);
  }

  function openCreateTask() {
    setEditingTask(null);
    setTitulo('');
    setDescricao('');
    setPrazo(defaultDeadline());
    setPrioridade('normal');
    setAssigneeId(currentProfileId);
    setAttachment(null);
    setRemoveAttachment(false);
    setModalOpen(true);
  }

  function openEditTask(task: ApolloTask) {
    setEditingTask(task);
    setTitulo(task.titulo);
    setDescricao(task.descricao || '');
    setPrazo(deadlineInputValue(task.prazo));
    setPrioridade(task.prioridade || 'normal');
    setAssigneeId(task.responsavel_profile_id);
    setAttachment(null);
    setRemoveAttachment(false);
    setModalOpen(true);
  }

  async function uploadTaskAttachment(taskId: string, file: File) {
    const form = new FormData();
    form.set('task_id', taskId);
    form.set('file', file);
    await apiRequest('/api/equipe/apollo/tasks/attachment', { method: 'POST', body: form });
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = editingTask
        ? await apiRequest('/api/equipe/apollo/tasks', {
            method: 'PATCH',
            body: JSON.stringify({
              task_id: editingTask.id,
              titulo,
              descricao,
              prazo: new Date(prazo).toISOString(),
              prioridade,
              responsavel_profile_id: assigneeId,
              remove_attachment: removeAttachment && !attachment,
            }),
          })
        : await apiRequest('/api/equipe/apollo/tasks', {
            method: 'POST',
            body: JSON.stringify({
              action: 'create',
              titulo,
              descricao,
              prazo: new Date(prazo).toISOString(),
              prioridade,
              responsavel_profile_id: canManageAll ? assigneeId : currentProfileId,
            }),
          });
      const taskId = editingTask?.id || String(payload.task?.id || '');
      if (attachment && taskId) {
        try {
          await uploadTaskAttachment(taskId, attachment);
        } catch (uploadError) {
          if (!editingTask) {
            await apiRequest(`/api/equipe/apollo/tasks?task_id=${encodeURIComponent(taskId)}`, { method: 'DELETE' }).catch(() => undefined);
          }
          throw uploadError;
        }
      }
      closeTaskModal();
      await loadTasks(view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel salvar a tarefa.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteTask() {
    if (!deleteTask) return;
    setDeleting(true);
    setError('');
    try {
      await apiRequest(`/api/equipe/apollo/tasks?task_id=${encodeURIComponent(deleteTask.id)}`, { method: 'DELETE' });
      setTasks((current) => current.filter((task) => task.id !== deleteTask.id));
      setDeleteTask(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel excluir a tarefa.');
    } finally {
      setDeleting(false);
    }
  }

  async function moveTask(taskId: string, status: TaskStatus) {
    const previous = tasks;
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, status } : task));
    try {
      await apiRequest('/api/equipe/apollo/tasks', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_status', task_id: taskId, status }),
      });
    } catch (cause) {
      setTasks(previous);
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel mover a tarefa.');
    }
  }

  function switchView(nextView: 'mine' | 'all') {
    if (nextView === view) return;
    if (nextView === 'mine') setAssigneeFilter('all');
    setView(nextView);
    void loadTasks(nextView);
  }

  const currentMember = members.find((member) => member.id === currentProfileId);

  return (
    <InternalLayout>
      <main className="min-h-screen bg-[#030b14] px-4 py-8 text-white sm:px-7 lg:px-10">
        <div className="mx-auto max-w-[1680px]">
          <header className="mb-8 flex flex-col gap-6 border-b border-slate-800/80 pb-7 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.3em] text-cyan-400">
                <LayoutDashboard size={15} /> Rotina Apollo
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Central de entregas</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Organize seus prazos e acompanhe o trabalho do pedido ate a entrega.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canManageAll && (
                <div className="flex rounded-xl border border-slate-700 bg-slate-950/80 p-1">
                  <button
                    type="button"
                    onClick={() => switchView('mine')}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-black uppercase tracking-wider transition ${view === 'mine' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  >
                    <UserRound size={15} /> Minhas tarefas
                  </button>
                  <button
                    type="button"
                    onClick={() => switchView('all')}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-black uppercase tracking-wider transition ${view === 'all' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  >
                    <UsersRound size={15} /> Geral
                  </button>
                </div>
              )}
              {canManageAll && view === 'all' && (
                <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-slate-400 focus-within:border-cyan-500">
                  <Filter size={15} className="shrink-0 text-cyan-400" />
                  <span className="sr-only">Filtrar por responsavel Apollo</span>
                  <select
                    value={assigneeFilter}
                    onChange={(event) => setAssigneeFilter(event.target.value)}
                    className="min-w-40 bg-transparent text-xs font-bold text-slate-200 outline-none"
                    aria-label="Filtrar por responsavel Apollo"
                  >
                    <option value="all">Todos os responsaveis</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{displayName(member)}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                onClick={() => void loadTasks(view)}
                aria-label="Atualizar tarefas"
                className="grid h-11 w-11 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300"
              >
                <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={openCreateTask}
                className="flex h-11 items-center gap-2 rounded-xl bg-cyan-500 px-5 text-sm font-black text-slate-950 shadow-[0_0_30px_rgba(6,182,212,0.18)] transition hover:bg-cyan-300"
              >
                <Plus size={18} /> Nova tarefa
              </button>
            </div>
          </header>

          {error && (
            <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm font-semibold text-rose-200">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Fechar aviso"><X size={16} /></button>
            </div>
          )}

          {loading && tasks.length === 0 ? (
            <div className="grid min-h-[420px] place-items-center rounded-2xl border border-slate-800 bg-slate-950/30">
              <div className="text-center text-slate-400">
                <Loader2 size={34} className="mx-auto mb-3 animate-spin text-cyan-400" />
                <p className="text-sm font-bold">Carregando quadro...</p>
              </div>
            </div>
          ) : (
            <section className="gt-board">
              {columns.map((column) => {
                const columnTasks = tasksByStatus[column.status];
                const index = columns.findIndex((item) => item.status === column.status);
                return (
                  <div
                    key={column.status}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggingId) void moveTask(draggingId, column.status);
                      setDraggingId(null);
                    }}
                  >
                    <GoogleTaskList
                      titulo={column.title}
                      itens={columnTasks.map((task) => {
                        const deadline = deadlineState(task);
                        const priority = priorityOptions.find((option) => option.value === (task.prioridade || 'normal')) || priorityOptions[2];
                        return {
                          id: task.id,
                          titulo: task.titulo,
                          nota: [displayName(task.responsavel), task.descricao].filter(Boolean).join(' - ') || null,
                          prazo: deadlineLabel(task.prazo),
                          atrasada: deadline.label.toLowerCase().includes('atras'),
                          concluida: task.status === 'feito',
                          lateral: priority.value === 'normal' ? null : <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${priority.className}`}>{priority.label}</span>,
                          extra: (
                            <div className="mt-1 flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                              {task.anexo_url && (
                                <a href={task.anexo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-500/25 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/10">
                                  <FileImage size={11} /> {task.anexo_nome || 'Print'} <ExternalLink size={10} />
                                </a>
                              )}
                              {index > 0 && (
                                <button type="button" onClick={() => void moveTask(task.id, columns[index - 1].status)} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-cyan-300">
                                  <ArrowLeft size={11} /> Voltar
                                </button>
                              )}
                              {index < columns.length - 1 && (
                                <button type="button" onClick={() => void moveTask(task.id, columns[index + 1].status)} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:text-cyan-300">
                                  Avancar <ArrowRight size={11} />
                                </button>
                              )}
                              {canManageAll && (
                                <>
                                  <button type="button" onClick={() => openEditTask(task)} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:text-cyan-300">
                                    <Pencil size={11} /> Editar
                                  </button>
                                  <button type="button" onClick={() => setDeleteTask(task)} className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/10">
                                    <Trash2 size={11} /> Excluir
                                  </button>
                                </>
                              )}
                            </div>
                          ),
                        };
                      })}
                      onAlternar={(item) => {
                        const task = columnTasks.find((current) => current.id === item.id);
                        if (task) void moveTask(task.id, task.status === 'feito' ? 'a_fazer' : 'feito');
                      }}
                      onAbrir={canManageAll ? (item) => {
                        const task = columnTasks.find((current) => current.id === item.id);
                        if (task) openEditTask(task);
                      } : undefined}
                      onAdicionar={column.status === "a_fazer" ? openCreateTask : undefined}
                      vazio={{ titulo: 'Nenhuma tarefa nesta etapa', descricao: column.description }}
                      arrastavel
                      aoIniciarArraste={(item) => setDraggingId(item.id)}
                      aoTerminarArraste={() => setDraggingId(null)}
                    />
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && closeTaskModal()}>
            <form onSubmit={saveTask} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#081522] p-6 shadow-2xl sm:p-7" aria-labelledby="apollo-task-modal-title">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-400">{editingTask ? 'Gestao da entrega' : 'Nova entrega'}</p>
                  <h2 id="apollo-task-modal-title" className="mt-2 text-2xl font-black">{editingTask ? 'Editar tarefa' : 'Criar tarefa'}</h2>
                  <p className="mt-2 text-xs text-slate-400">
                    {editingTask
                      ? 'Atualize os detalhes, o responsavel e o print da entrega.'
                      : canManageAll ? 'Defina o responsavel, os detalhes e o prazo da entrega.' : `A tarefa sera criada para ${displayName(currentMember)}.`}
                  </p>
                </div>
                <button type="button" onClick={closeTaskModal} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-400 hover:text-white" aria-label="Fechar">
                  <X size={17} />
                </button>
              </div>

              <div className="space-y-5">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Titulo</span>
                  <input
                    value={titulo}
                    onChange={(event) => setTitulo(event.target.value)}
                    required
                    minLength={2}
                    maxLength={180}
                    placeholder="Ex: Revisar relatorio da concessionaria"
                    className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-semibold outline-none transition placeholder:text-slate-700 focus:border-cyan-500"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Descricao</span>
                  <textarea
                    value={descricao}
                    onChange={(event) => setDescricao(event.target.value)}
                    maxLength={4000}
                    rows={5}
                    placeholder="Detalhe o que precisa ser feito, criterios e links importantes."
                    className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold leading-6 outline-none transition placeholder:text-slate-700 focus:border-cyan-500"
                  />
                  <span className="mt-2 block text-right text-[10px] text-slate-600">{descricao.length}/4000</span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Prazo de entrega</span>
                  <input
                    type="datetime-local"
                    value={prazo}
                    onChange={(event) => setPrazo(event.target.value)}
                    required
                    className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-semibold text-white outline-none transition focus:border-cyan-500 [color-scheme:dark]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Prioridade</span>
                  <select
                    value={prioridade}
                    onChange={(event) => setPrioridade(event.target.value as TaskPriority)}
                    required
                    className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-semibold text-white outline-none transition focus:border-cyan-500"
                  >
                    {priorityOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="mt-2 block text-[11px] text-slate-500">Urgentes e altas aparecem primeiro no quadro.</span>
                </label>

                {canManageAll && (
                  <>
                    <label className="block">
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Responsavel Apollo</span>
                      <select
                        value={assigneeId}
                        onChange={(event) => setAssigneeId(event.target.value)}
                        required
                        className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-semibold text-white outline-none transition focus:border-cyan-500"
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>{displayName(member)}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Print da tarefa</span>
                      <span className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-600 bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-400 transition hover:border-cyan-500 hover:text-cyan-200">
                        <FileImage size={18} className="shrink-0 text-cyan-400" />
                        <span className="truncate">{attachment?.name || 'Selecionar imagem de ate 8 MB'}</span>
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => setAttachment(event.target.files?.[0] || null)}
                        className="sr-only"
                      />
                    </label>

                    {editingTask?.anexo_path && !attachment && (
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs font-bold text-rose-200">
                        <input
                          type="checkbox"
                          checked={removeAttachment}
                          onChange={(event) => setRemoveAttachment(event.target.checked)}
                          className="h-4 w-4 accent-rose-500"
                        />
                        Remover o print atual ao salvar
                      </label>
                    )}
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={saving || !titulo.trim() || !prazo}
                className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 text-sm font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 size={17} className="animate-spin" /> : editingTask ? <Save size={17} /> : <Plus size={17} />}
                {saving ? 'Salvando...' : editingTask ? 'Salvar alteracoes' : 'Criar tarefa'}
              </button>
            </form>
          </div>
        )}

        {deleteTask && (
          <div
            className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm"
            onMouseDown={(event) => event.target === event.currentTarget && !deleting && setDeleteTask(null)}
          >
            <div role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-[#0b1622] p-6 shadow-2xl sm:p-7">
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300">
                <Trash2 size={21} />
              </div>
              <h2 id="delete-task-title" className="mt-5 text-xl font-black">Excluir tarefa?</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                A tarefa <strong className="text-slate-200">{deleteTask.titulo}</strong> e seu print serao removidos definitivamente.
              </p>
              <div className="mt-7 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteTask(null)}
                  disabled={deleting}
                  className="min-h-11 rounded-xl border border-slate-700 text-sm font-black text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDeleteTask()}
                  disabled={deleting}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-500 text-sm font-black text-white transition hover:bg-rose-400 disabled:opacity-50"
                >
                  {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {deleting ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </InternalLayout>
  );
}
