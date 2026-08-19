'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCw,
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
  prazo: string;
  status: TaskStatus;
  prioridade: TaskPriority;
  responsavel_profile_id: string;
  criado_por_profile_id: string;
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
  const [titulo, setTitulo] = useState('');
  const [prazo, setPrazo] = useState(defaultDeadline);
  const [prioridade, setPrioridade] = useState<TaskPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const apiRequest = useCallback(async (url: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessao expirada. Entre novamente.');
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
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
    void loadTasks('mine');
  }, [loadTasks]);

  const tasksByStatus = useMemo(() => {
    return columns.reduce<Record<TaskStatus, ApolloTask[]>>((result, column) => {
      result[column.status] = tasks
        .filter((task) => task.status === column.status)
        .sort((a, b) => {
          const priorityDifference = priorityWeight[b.prioridade || 'normal'] - priorityWeight[a.prioridade || 'normal'];
          return priorityDifference || new Date(a.prazo).getTime() - new Date(b.prazo).getTime();
        });
      return result;
    }, { a_fazer: [], fazendo: [], feito: [] });
  }, [tasks]);

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/equipe/apollo/tasks', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          titulo,
          prazo: new Date(prazo).toISOString(),
          prioridade,
          responsavel_profile_id: canManageAll ? assigneeId : currentProfileId,
        }),
      });
      setTitulo('');
      setPrazo(defaultDeadline());
      setPrioridade('normal');
      setAssigneeId(currentProfileId);
      setModalOpen(false);
      await loadTasks(view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel criar a tarefa.');
    } finally {
      setSaving(false);
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
                onClick={() => {
                  setAssigneeId(currentProfileId);
                  setModalOpen(true);
                }}
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
            <section className="grid gap-4 xl:grid-cols-3">
              {columns.map((column) => {
                const Icon = column.icon;
                const columnTasks = tasksByStatus[column.status];
                return (
                  <div
                    key={column.status}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggingId) void moveTask(draggingId, column.status);
                      setDraggingId(null);
                    }}
                    className="min-h-[500px] rounded-2xl border border-slate-800 bg-[#071321] p-3 sm:p-4"
                  >
                    <div className="mb-4 flex items-start justify-between gap-4 px-1 py-1">
                      <div className="flex items-start gap-3">
                        <div className={`grid h-10 w-10 place-items-center rounded-xl border border-slate-700 bg-slate-950 ${column.tone}`}>
                          <Icon size={19} />
                        </div>
                        <div>
                          <h2 className="text-base font-black">{column.title}</h2>
                          <p className="mt-1 text-xs text-slate-500">{column.description}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-slate-300">{columnTasks.length}</span>
                    </div>

                    <div className="space-y-3">
                      {columnTasks.map((task) => {
                        const deadline = deadlineState(task);
                        const priority = priorityOptions.find((option) => option.value === (task.prioridade || 'normal')) || priorityOptions[2];
                        const index = columns.findIndex((item) => item.status === task.status);
                        return (
                          <article
                            key={task.id}
                            draggable
                            onDragStart={() => setDraggingId(task.id)}
                            onDragEnd={() => setDraggingId(null)}
                            className="group relative overflow-hidden rounded-xl border border-slate-800 bg-[#0a1929] p-4 transition hover:-translate-y-0.5 hover:border-slate-600"
                          >
                            <span className={`absolute inset-y-0 left-0 w-1 ${column.rail}`} />
                            <div className="pl-2">
                              <div className="mb-4 flex items-start justify-between gap-3">
                                <h3 className="text-sm font-extrabold leading-5 text-slate-100">{task.titulo}</h3>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                  <span className={`rounded-md border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${priority.className}`}>
                                    {priority.label}
                                  </span>
                                  <span className={`rounded-md border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${deadline.className}`}>
                                    {deadline.label}
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-2 border-t border-slate-800 pt-3 text-xs">
                                <div className="flex items-center gap-2 text-slate-300">
                                  <CalendarClock size={14} className="text-cyan-400" />
                                  <span className="font-bold">{deadlineLabel(task.prazo)}</span>
                                </div>
                                <div className="flex items-center gap-2 text-slate-400">
                                  <UserRound size={14} />
                                  <span>{displayName(task.responsavel)}</span>
                                </div>
                                {view === 'all' && task.criado_por_profile_id !== task.responsavel_profile_id && (
                                  <div className="text-[10px] text-slate-600">Criada por {displayName(task.criado_por)}</div>
                                )}
                              </div>

                              <div className="mt-4 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => index > 0 && void moveTask(task.id, columns[index - 1].status)}
                                  className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-20"
                                >
                                  <ArrowLeft size={13} /> Voltar
                                </button>
                                <button
                                  type="button"
                                  disabled={index === columns.length - 1}
                                  onClick={() => index < columns.length - 1 && void moveTask(task.id, columns[index + 1].status)}
                                  className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-2 text-[10px] font-black uppercase tracking-wider text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-20"
                                >
                                  Avancar <ArrowRight size={13} />
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}

                      {columnTasks.length === 0 && (
                        <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-slate-800 bg-slate-950/20 px-5 text-center">
                          <div>
                            <Icon size={22} className={`mx-auto mb-2 opacity-50 ${column.tone}`} />
                            <p className="text-xs font-bold text-slate-600">Nenhuma tarefa nesta etapa</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}>
            <form onSubmit={createTask} className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#081522] p-6 shadow-2xl sm:p-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-400">Nova entrega</p>
                  <h2 className="mt-2 text-2xl font-black">Criar tarefa</h2>
                  <p className="mt-2 text-xs text-slate-400">
                    {canManageAll ? 'Defina o responsavel e o prazo da entrega.' : `A tarefa sera criada para ${displayName(currentMember)}.`}
                  </p>
                </div>
                <button type="button" onClick={() => setModalOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 text-slate-400 hover:text-white" aria-label="Fechar">
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
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Responsavel</span>
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
                )}
              </div>

              <button
                type="submit"
                disabled={saving || !titulo.trim() || !prazo}
                className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 text-sm font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />}
                Criar tarefa
              </button>
            </form>
          </div>
        )}
      </main>
    </InternalLayout>
  );
}
