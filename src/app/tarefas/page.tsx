'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { LeadTarefa } from '@/types';
import { ArrowLeft, CalendarDays, CheckCircle2, Clock, Loader2, RefreshCw, Search, UserRound } from 'lucide-react';

type TaskLead = {
  id: string;
  nome: string | null;
  telefone: string | null;
  status: string | null;
  cidade: string | null;
  valor_negociacao: string | number | null;
  corretor_id: string | null;
  responsavel_profile_id: string | null;
};

type BrokerRow = {
  id: string;
  nome: string | null;
  email: string | null;
  nome_empresa: string | null;
};

type ProfileRow = {
  id: string;
  nome: string | null;
  email: string | null;
};

type TaskFilter = 'pendentes' | 'hoje' | 'atrasadas' | 'concluidas' | 'todas';
type ResponsibleFilter = 'todos' | 'sem_responsavel' | string;

function formatDateTime(value?: string | null) {
  if (!value) return 'Sem prazo';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Sem prazo';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTaskBadge(task: LeadTarefa) {
  if (task.status === 'concluida') return { label: 'Concluida', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' };
  if (task.status === 'cancelada') return { label: 'Cancelada', className: 'bg-slate-500/15 text-slate-300 border-slate-500/25' };
  if (!task.vencimento) return { label: 'Pendente', className: 'bg-blue-500/15 text-blue-300 border-blue-500/25' };

  const due = new Date(task.vencimento);
  if (!Number.isFinite(due.getTime())) return { label: 'Pendente', className: 'bg-blue-500/15 text-blue-300 border-blue-500/25' };

  const today = new Date();
  const dueDay = dayKey(due);
  const todayDay = dayKey(today);
  if (due.getTime() < today.getTime() && dueDay !== todayDay) {
    return { label: 'Atrasada', className: 'bg-rose-500 text-white border-rose-400' };
  }
  if (dueDay === todayDay) return { label: 'Hoje', className: 'bg-amber-400/15 text-amber-200 border-amber-400/25' };
  return { label: 'Pendente', className: 'bg-blue-500/15 text-blue-300 border-blue-500/25' };
}

function matchesTaskFilter(task: LeadTarefa, filter: TaskFilter) {
  const badge = getTaskBadge(task).label.toLowerCase();
  if (filter === 'todas') return true;
  if (filter === 'concluidas') return task.status === 'concluida';
  if (filter === 'pendentes') return task.status === 'pendente';
  if (filter === 'hoje') return task.status === 'pendente' && badge === 'hoje';
  if (filter === 'atrasadas') return task.status === 'pendente' && badge === 'atrasada';
  return true;
}

export default function TarefasPage() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<LeadTarefa[]>([]);
  const [leadsById, setLeadsById] = useState<Record<string, TaskLead>>({});
  const [brokersById, setBrokersById] = useState<Record<string, BrokerRow>>({});
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [availableProfiles, setAvailableProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('pendentes');
  const [responsibleFilter, setResponsibleFilter] = useState<ResponsibleFilter>('todos');
  const canManageTaskResponsible = ['admin', 'dev', 'corretor_admin'].includes(profile?.tipo_usuario || '');

  async function resolveBrokerScope() {
    const simulatedId = typeof window !== 'undefined' ? window.sessionStorage.getItem('orion:viewing_corretor_id') : null;
    const brokerRole = ['corretor', 'corretor_admin', 'corretor_membro'].includes(profile?.tipo_usuario || '');
    const baseBrokerId = simulatedId || (brokerRole ? profile?.corretor_id : null);
    if (!baseBrokerId) return [] as string[];

    let brokerIds = [baseBrokerId];
    const { data: brokerRow } = await supabase
      .from('corretores')
      .select('id,nome,email,nome_empresa')
      .eq('id', baseBrokerId)
      .maybeSingle();

    if (brokerRow?.nome_empresa) {
      const { data: siblings } = await supabase
        .from('corretores')
        .select('id')
        .eq('nome_empresa', brokerRow.nome_empresa);
      if (siblings?.length) brokerIds = siblings.map((item) => item.id);
    }

    return brokerIds;
  }

  async function fetchTasks() {
    if (!profile) return;
    setLoading(true);
    setError(null);

    try {
      const brokerIds = await resolveBrokerScope();
      let query = supabase
        .from('lead_tarefas')
        .select('*')
        .order('status', { ascending: false })
        .order('vencimento', { ascending: true, nullsFirst: false })
        .limit(500);

      if (brokerIds.length > 0) query = query.in('corretor_id', brokerIds);
      if (profile.tipo_usuario === 'corretor_membro') query = query.eq('responsavel_profile_id', profile.id);

      const { data, error: taskError } = await query;
      if (taskError) throw taskError;

      const nextTasks = (data || []) as LeadTarefa[];
      setTasks(nextTasks);

      const leadIds = Array.from(new Set(nextTasks.map((task) => task.lead_id).filter(Boolean)));
      const brokerTaskIds = Array.from(new Set(nextTasks.map((task) => task.corretor_id).filter(Boolean))) as string[];

      const [leadsResult, brokersResult] = await Promise.all([
        leadIds.length
          ? supabase
              .from('leads')
              .select('id,nome,telefone,status,cidade,valor_negociacao,corretor_id,responsavel_profile_id')
              .in('id', leadIds)
          : Promise.resolve({ data: [], error: null }),
        brokerTaskIds.length
          ? supabase
              .from('corretores')
              .select('id,nome,email,nome_empresa')
              .in('id', brokerTaskIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (leadsResult.error) throw leadsResult.error;
      if (brokersResult.error) throw brokersResult.error;

      const nextLeads = (leadsResult.data || []) as TaskLead[];
      const profileIds = Array.from(new Set([
        ...nextTasks.map((task) => task.responsavel_profile_id).filter(Boolean),
        ...nextLeads.map((lead) => lead.responsavel_profile_id).filter(Boolean),
      ])) as string[];

      const profilesMap: Record<string, ProfileRow> = {};

      if (profile.corretor_id) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token) {
          try {
            const teamRes = await fetch(`/api/corretor/times?corretor_id=${encodeURIComponent(profile.corretor_id)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (teamRes.ok) {
              const payload = await teamRes.json().catch(() => ({}));
              const membros = (payload.membros || []) as any[];
              const ownerProfiles = (payload.settings?.owner_profiles || []) as any[];

              membros.forEach((m) => {
                if (m.profile_id) {
                  profilesMap[m.profile_id] = { id: m.profile_id, nome: m.nome, email: m.email };
                }
              });

              ownerProfiles.forEach((o) => {
                if (o.id) {
                  profilesMap[o.id] = { id: o.id, nome: o.nome, email: o.email_real || o.email };
                }
              });
            }
          } catch (e) {
            console.error('Erro ao buscar perfis do time via API:', e);
          }
        }
      }

      const profilesResult = profileIds.length
        ? await supabase
            .from('profiles')
            .select('id,nome,email')
            .in('id', profileIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;

      const directProfiles = (profilesResult.data || []) as ProfileRow[];
      directProfiles.forEach((item) => {
        profilesMap[item.id] = item;
      });

      if (profile.tipo_usuario === 'admin') {
        const { data: allProfiles, error: profilesErr } = await supabase
          .from('profiles')
          .select('id, nome, email')
          .eq('status', 'ativo')
          .order('nome', { ascending: true });
        if (!profilesErr && allProfiles) {
          const activeList = allProfiles as ProfileRow[];
          profileIds.forEach((pid) => {
            if (pid && !activeList.some((ap) => ap.id === pid)) {
              const extraProfile = profilesMap[pid];
              if (extraProfile) {
                activeList.push(extraProfile);
              }
            }
          });
          setAvailableProfiles(activeList);
          allProfiles.forEach((item) => {
            profilesMap[item.id] = item as ProfileRow;
          });
        }
      }

      setLeadsById(Object.fromEntries(nextLeads.map((lead) => [lead.id, lead])));
      setBrokersById(Object.fromEntries(((brokersResult.data || []) as BrokerRow[]).map((broker) => [broker.id, broker])));
      setProfilesById(profilesMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar tarefas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchTasks();
  }, [profile?.id]);

  async function completeTask(taskId: string) {
    setSavingId(taskId);
    const { error: updateError } = await supabase
      .from('lead_tarefas')
      .update({ status: 'concluida', updated_at: new Date().toISOString() })
      .eq('id', taskId);
    setSavingId(null);

    if (updateError) {
      alert(updateError.message);
      return;
    }
    await fetchTasks();
  }

  async function handleUpdateResponsible(taskId: string, newProfileId: string | null) {
    setSavingId(taskId);
    const { error: updateError } = await supabase
      .from('lead_tarefas')
      .update({ responsavel_profile_id: newProfileId, updated_at: new Date().toISOString() })
      .eq('id', taskId);
    setSavingId(null);

    if (updateError) {
      alert('Erro ao atualizar responsável: ' + updateError.message);
      return;
    }
    await fetchTasks();
  }

  function getTaskResponsibleId(task: LeadTarefa) {
    const lead = leadsById[task.lead_id];
    return task.responsavel_profile_id || lead?.responsavel_profile_id || null;
  }

  const responsibleOptions = useMemo(() => {
    const options = new Map<string, ProfileRow>();
    let hasUnassigned = false;

    tasks.forEach((task) => {
      const responsibleId = getTaskResponsibleId(task);
      if (!responsibleId) {
        hasUnassigned = true;
        return;
      }

      const responsible = profilesById[responsibleId];
      options.set(responsibleId, responsible || { id: responsibleId, nome: 'Responsavel sem perfil', email: null });
    });

    return {
      people: Array.from(options.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')),
      hasUnassigned,
    };
  }, [tasks, leadsById, profilesById]);

  const tasksByResponsible = useMemo(() => {
    if (responsibleFilter === 'todos') return tasks;
    return tasks.filter((task) => {
      const responsibleId = getTaskResponsibleId(task);
      if (responsibleFilter === 'sem_responsavel') return !responsibleId;
      return responsibleId === responsibleFilter;
    });
  }, [tasks, leadsById, responsibleFilter]);

  const stats = useMemo(() => {
    return {
      total: tasksByResponsible.length,
      pending: tasksByResponsible.filter((task) => task.status === 'pendente').length,
      today: tasksByResponsible.filter((task) => matchesTaskFilter(task, 'hoje')).length,
      late: tasksByResponsible.filter((task) => matchesTaskFilter(task, 'atrasadas')).length,
    };
  }, [tasksByResponsible]);

  const visibleTasks = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return tasksByResponsible.filter((task) => {
      const lead = leadsById[task.lead_id];
      const broker = task.corretor_id ? brokersById[task.corretor_id] : null;
      const responsibleId = getTaskResponsibleId(task);
      const responsible = responsibleId ? profilesById[responsibleId] : null;
      const haystack = [
        task.titulo,
        task.descricao,
        lead?.nome,
        lead?.telefone,
        lead?.cidade,
        broker?.nome,
        broker?.nome_empresa,
        responsible?.nome,
      ].join(' ').toLowerCase();

      return matchesTaskFilter(task, filter) && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
  }, [tasksByResponsible, leadsById, brokersById, profilesById, filter, search]);

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <Link href="/crm" className="mb-5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300">
            <ArrowLeft size={15} /> Voltar ao CRM
          </Link>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Follow up comercial</p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Tarefas</h1>
          <p className="mt-1 font-bold text-slate-400">Lista de retornos, ligacoes e proximas acoes do CRM.</p>
        </div>
        <button
          type="button"
          onClick={fetchTasks}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Pendentes" value={stats.pending} icon={Clock} />
        <SummaryCard label="Hoje" value={stats.today} icon={CalendarDays} />
        <SummaryCard label="Atrasadas" value={stats.late} icon={Clock} danger />
        <SummaryCard label="Total" value={stats.total} icon={CheckCircle2} />
      </div>

      <div className="mb-6 rounded-[1.5rem] border border-white/10 bg-slate-950/40 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_240px_220px]">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por tarefa, cliente, responsavel ou concessionaria..."
              className="w-full rounded-2xl border border-white/10 bg-slate-950 px-11 py-3.5 text-sm font-bold text-white outline-none focus:border-cyan-400/70"
            />
          </label>
          <select
            value={responsibleFilter}
            onChange={(event) => setResponsibleFilter(event.target.value)}
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3.5 text-sm font-black text-white outline-none focus:border-cyan-400/70"
          >
            <option value="todos">Todos responsaveis</option>
            {responsibleOptions.people.map((person) => (
              <option key={person.id} value={person.id}>{person.nome || person.email || 'Sem nome'}</option>
            ))}
            {responsibleOptions.hasUnassigned && <option value="sem_responsavel">Sem responsavel</option>}
          </select>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as TaskFilter)}
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3.5 text-sm font-black text-white outline-none focus:border-cyan-400/70"
          >
            <option value="pendentes">Pendentes</option>
            <option value="hoje">Hoje</option>
            <option value="atrasadas">Atrasadas</option>
            <option value="concluidas">Concluidas</option>
            <option value="todas">Todas</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/40 shadow-2xl">
        <div className="grid grid-cols-[42px_minmax(260px,1.4fr)_130px_190px_minmax(160px,0.8fr)_minmax(180px,0.9fr)_150px] border-b border-white/10 bg-slate-900/80 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <span />
          <span>Tarefa</span>
          <span>Status</span>
          <span>Data e hora</span>
          <span>Responsavel</span>
          <span>Negociacao</span>
          <span>Acao</span>
        </div>

        {loading ? (
          <div className="flex h-72 items-center justify-center">
            <Loader2 className="animate-spin text-cyan-400" size={38} />
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="text-lg font-black text-rose-400">Erro ao carregar tarefas.</p>
            <p className="mt-2 text-sm font-bold text-slate-400">{error}</p>
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="p-12 text-center">
            <CalendarDays className="mx-auto mb-4 text-slate-600" size={42} />
            <p className="text-lg font-black text-white">Nenhuma tarefa encontrada</p>
            <p className="mt-2 text-sm font-bold text-slate-500">Ajuste os filtros ou crie um follow up dentro do lead.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {visibleTasks.map((task) => {
              const lead = leadsById[task.lead_id];
              const broker = task.corretor_id ? brokersById[task.corretor_id] : null;
              const responsibleId = getTaskResponsibleId(task);
              const responsible = responsibleId ? profilesById[responsibleId] : null;
              const badge = getTaskBadge(task);

              return (
                <div
                  key={task.id}
                  onClick={() => {
                    if (task.lead_id) window.location.href = `/crm?lead=${task.lead_id}`;
                  }}
                  className="grid cursor-pointer grid-cols-[42px_minmax(260px,1.4fr)_130px_190px_minmax(160px,0.8fr)_minmax(180px,0.9fr)_150px] items-center px-4 py-4 text-sm transition hover:bg-white/5"
                >
                  <div>
                    <span className="block h-4 w-4 rounded border border-slate-600 bg-slate-950" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-black text-cyan-300">{task.titulo}</p>
                    <p className="mt-1 truncate text-xs font-bold text-slate-500">
                      {broker?.nome_empresa || broker?.nome || 'Sem concessionaria'}
                    </p>
                  </div>
                  <div>
                    <span className={`inline-flex rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-widest border ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="font-black text-white">{formatDateTime(task.vencimento)}</p>
                  <div className="flex min-w-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    {canManageTaskResponsible ? (
                      <select
                        value={task.responsavel_profile_id || lead?.responsavel_profile_id || ''}
                        disabled={savingId === task.id}
                        onChange={(event) => {
                          void handleUpdateResponsible(task.id, event.target.value || null);
                        }}
                        className="w-full truncate rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-400/70"
                      >
                        <option value="">Sem responsável</option>
                        {availableProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome || p.email || 'Sem nome'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-black text-cyan-200">
                          {(responsible?.nome || 'NA').slice(0, 2).toUpperCase()}
                        </span>
                        <span className="truncate font-bold text-slate-300">{responsible?.nome || 'Sem responsavel'}</span>
                      </>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-black text-cyan-300">{lead?.nome || 'Lead nao encontrado'}</p>
                    <p className="mt-1 truncate text-xs font-bold text-slate-500">{lead?.telefone || lead?.cidade || '-'}</p>
                  </div>
                  <div>
                    {task.status === 'pendente' ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void completeTask(task.id);
                        }}
                        disabled={savingId === task.id}
                        className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {savingId === task.id ? <Loader2 className="animate-spin" size={13} /> : <CheckCircle2 size={13} />}
                        Concluir
                      </button>
                    ) : (
                      <span className="text-xs font-black text-slate-500">Finalizada</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </InternalLayout>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  danger = false,
}: {
  label: string;
  value: number;
  icon: typeof Clock | typeof CalendarDays | typeof CheckCircle2 | typeof UserRound;
  danger?: boolean;
}) {
  return (
    <div className={`rounded-[1.75rem] border p-5 ${danger ? 'border-rose-500/20 bg-rose-500/10' : 'border-white/10 bg-slate-950/45'}`}>
      <p className={`mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${danger ? 'text-rose-300' : 'text-cyan-300'}`}>
        <Icon size={14} /> {label}
      </p>
      <p className="text-3xl font-black text-white">{value}</p>
    </div>
  );
}
