'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadAtividade, LeadTarefa } from '@/types';
import {
  Activity,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';

type TimelineLead = Pick<
  Lead,
  | 'id'
  | 'nome'
  | 'telefone'
  | 'email'
  | 'status'
  | 'cidade'
  | 'corretor_id'
  | 'responsavel_profile_id'
  | 'data_entrada'
  | 'created_at'
  | 'updated_at'
  | 'idades'
  | 'possui_cnpj'
  | 'cnpj'
  | 'tem_plano_ativo'
  | 'plano_atual'
  | 'investimento'
  | 'operadora'
  | 'etiqueta'
  | 'observacoes'
  | 'motivo_busca'
  | 'hospital_preferencia'
  | 'valor_negociacao'
  | 'operadora_negociacao'
>;

type ProfileRow = {
  id: string;
  nome: string | null;
  email: string | null;
};

type TimelineEvent = {
  id: string;
  lead_id: string;
  type: LeadAtividade['tipo'];
  title: string;
  description?: string | null;
  created_at: string;
  actorProfileId?: string | null;
  responsibleProfileId?: string | null;
};

type ResponsibleFilter = 'todos' | 'sem_responsavel' | string;

const TYPE_LABELS: Record<string, string> = {
  nota: 'Observacao',
  status: 'Etapa',
  ligacao: 'Ligacao',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  tarefa: 'Tarefa',
  sistema: 'Sistema',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function activityTone(tipo: string) {
  if (tipo === 'nota') return 'border-violet-400 bg-violet-500 text-violet-50';
  if (tipo === 'status') return 'border-emerald-400 bg-emerald-500 text-emerald-950';
  if (tipo === 'tarefa') return 'border-amber-300 bg-amber-300 text-amber-950';
  if (tipo === 'ligacao') return 'border-orange-300 bg-orange-400 text-orange-950';
  if (tipo === 'whatsapp') return 'border-cyan-300 bg-cyan-400 text-cyan-950';
  if (tipo === 'email') return 'border-blue-300 bg-blue-400 text-blue-950';
  return 'border-slate-300 bg-slate-300 text-slate-950';
}

function eventIcon(tipo: string) {
  if (tipo === 'nota') return <FileText size={16} />;
  if (tipo === 'status') return <ArrowRightLeft size={16} />;
  if (tipo === 'tarefa') return <CheckCircle2 size={16} />;
  if (tipo === 'ligacao') return <Phone size={16} />;
  if (tipo === 'whatsapp') return <MessageSquare size={16} />;
  if (tipo === 'email') return <Mail size={16} />;
  return <Activity size={16} />;
}

function normalize(value?: string | null) {
  return String(value || '').trim();
}

function dateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function LeadInfoLine({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-400" />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
        <p className="break-words font-bold text-slate-200">{value || '-'}</p>
      </div>
    </div>
  );
}

export default function HistoricoPage() {
  const { profile } = useAuth();
  const [activities, setActivities] = useState<LeadAtividade[]>([]);
  const [tasks, setTasks] = useState<LeadTarefa[]>([]);
  const [leads, setLeads] = useState<TimelineLead[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [responsibleFilter, setResponsibleFilter] = useState<ResponsibleFilter>('todos');
  const [stageFilter, setStageFilter] = useState('todos');
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return dateInputValue(date);
  });
  const [endDate, setEndDate] = useState(() => dateInputValue(new Date()));
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const isTeamMember = profile?.tipo_usuario === 'corretor_membro';
  const canFilterResponsible = !isTeamMember;

  async function fetchHistory() {
    if (!profile) return;
    setLoading(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada. Entre novamente.');

      const simulatedId = typeof window !== 'undefined' ? window.sessionStorage.getItem('orion:viewing_corretor_id') : null;
      const params = new URLSearchParams();
      if (simulatedId) params.set('corretor_id', simulatedId);

      const response = await fetch(`/api/historico/leads${params.toString() ? `?${params.toString()}` : ''}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao carregar historico.');

      const nextLeads = (payload.leads || []) as TimelineLead[];
      const nextActivities = (payload.activities || []) as LeadAtividade[];
      const nextTasks = (payload.tasks || []) as LeadTarefa[];
      const nextProfiles = (payload.profiles || []) as Array<ProfileRow & { email_real?: string | null }>;

      setLeads(nextLeads);
      setActivities(nextActivities);
      setTasks(nextTasks);
      setProfilesById(Object.fromEntries(nextProfiles.map((item) => [item.id, { ...item, email: item.email_real || item.email }])));

      setSelectedLeadId((current) => {
        if (current && nextLeads.some((lead) => lead.id === current)) return current;
        return nextLeads[0]?.id || null;
      });
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar historico.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchHistory();
  }, [profile?.id, profile?.tipo_usuario, profile?.corretor_id]);

  const leadsById = useMemo(() => Object.fromEntries(leads.map((lead) => [lead.id, lead])), [leads]);

  const responsibleOptions = useMemo(() => {
    const options = new Map<string, ProfileRow>();
    let hasUnassigned = false;

    leads.forEach((lead) => {
      if (!lead.responsavel_profile_id) {
        hasUnassigned = true;
        return;
      }
      options.set(lead.responsavel_profile_id, profilesById[lead.responsavel_profile_id] || {
        id: lead.responsavel_profile_id,
        nome: 'Responsavel sem perfil',
        email: null,
      });
    });

    return {
      people: Array.from(options.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')),
      hasUnassigned,
    };
  }, [leads, profilesById]);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(leads.map((lead) => lead.status).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  }, [leads]);

  const events = useMemo<TimelineEvent[]>(() => {
    const activityEvents = activities.map((activity) => ({
      id: activity.id,
      lead_id: activity.lead_id,
      type: activity.tipo,
      title: activity.titulo,
      description: activity.descricao,
      created_at: activity.created_at,
      actorProfileId: activity.profile_id,
      responsibleProfileId: leadsById[activity.lead_id]?.responsavel_profile_id || null,
    }));

    const taskEvents = tasks.map((task) => ({
      id: `task-${task.id}`,
      lead_id: task.lead_id,
      type: 'tarefa' as const,
      title: task.status === 'concluida' ? 'Tarefa concluida' : 'Tarefa criada',
      description: [
        task.titulo,
        task.vencimento ? `Prazo: ${formatDateTime(task.vencimento)}` : null,
        task.prioridade ? `Prioridade: ${task.prioridade}` : null,
      ].filter(Boolean).join('\n'),
      created_at: task.updated_at || task.created_at,
      actorProfileId: task.responsavel_profile_id,
      responsibleProfileId: task.responsavel_profile_id,
    }));

    return [...activityEvents, ...taskEvents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [activities, tasks, leadsById]);

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const end = endDate ? new Date(`${endDate}T23:59:59`).getTime() : null;

    return leads.filter((lead) => {
      const leadDate = new Date(lead.data_entrada || lead.created_at).getTime();
      const responsibleId = lead.responsavel_profile_id || null;
      const leadEvents = events.filter((event) => event.lead_id === lead.id);
      const haystack = [
        lead.nome,
        lead.telefone,
        lead.email,
        lead.cidade,
        lead.status,
        lead.observacoes,
        leadEvents.map((event) => `${event.title} ${event.description || ''}`).join(' '),
      ].join(' ').toLowerCase();

      if (Number.isFinite(leadDate)) {
        if (start && leadDate < start) return false;
        if (end && leadDate > end) return false;
      }

      if (canFilterResponsible && responsibleFilter !== 'todos') {
        if (responsibleFilter === 'sem_responsavel') {
          if (responsibleId) return false;
        } else if (responsibleId !== responsibleFilter) {
          return false;
        }
      }

      if (stageFilter !== 'todos' && lead.status !== stageFilter) return false;
      return !normalizedSearch || haystack.includes(normalizedSearch);
    });
  }, [leads, events, search, startDate, endDate, responsibleFilter, stageFilter, canFilterResponsible]);

  useEffect(() => {
    if (!filteredLeads.length) {
      setSelectedLeadId(null);
      return;
    }
    if (!selectedLeadId || !filteredLeads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(filteredLeads[0].id);
    }
  }, [filteredLeads, selectedLeadId]);

  const selectedLead = selectedLeadId ? leadsById[selectedLeadId] : null;
  const selectedEvents = selectedLead
    ? events.filter((event) => event.lead_id === selectedLead.id)
    : [];
  const selectedResponsible = selectedLead?.responsavel_profile_id ? profilesById[selectedLead.responsavel_profile_id] : null;

  return (
    <InternalLayout>
      <div className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">
            <Clock size={14} /> Historico
          </p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Historico dos Leads</h1>
          <p className="mt-1 max-w-3xl font-bold text-slate-400">
            Linha do tempo por lead com mudancas de etapa, anotacoes, tarefas, ligacoes e eventos do Inbox.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchHistory}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar
        </button>
      </div>

      <section className="mb-5 rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4">
        <div className="grid gap-3 lg:grid-cols-[1.15fr_220px_220px_210px_210px_auto]">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar lead..."
              className="h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-12 text-sm font-bold text-white outline-none focus:border-cyan-400/70"
            />
          </label>

          {canFilterResponsible && (
            <select
              value={responsibleFilter}
              onChange={(event) => setResponsibleFilter(event.target.value)}
              className="h-12 rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-black text-white outline-none focus:border-cyan-400/70"
            >
              <option value="todos">Responsavel: todos</option>
              {responsibleOptions.people.map((person) => (
                <option key={person.id} value={person.id}>{person.nome || person.email || 'Sem nome'}</option>
              ))}
              {responsibleOptions.hasUnassigned && <option value="sem_responsavel">Sem responsavel</option>}
            </select>
          )}

          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="h-12 rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-black text-white outline-none focus:border-cyan-400/70"
          />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-12 rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-black text-white outline-none focus:border-cyan-400/70"
          />
          <select
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value)}
            className="h-12 rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-black text-white outline-none focus:border-cyan-400/70"
          >
            <option value="todos">Etapa: todas</option>
            {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setResponsibleFilter('todos');
              setStageFilter('todos');
            }}
            className="h-12 rounded-xl border border-cyan-400/10 bg-cyan-400/10 px-5 text-xs font-black uppercase tracking-widest text-cyan-300 transition hover:bg-cyan-400/20"
          >
            Limpar
          </button>
        </div>
      </section>

      <section className="min-h-[620px] rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-4 shadow-2xl">
        {loading ? (
          <div className="flex h-[520px] items-center justify-center">
            <Loader2 className="animate-spin text-cyan-400" size={40} />
          </div>
        ) : error ? (
          <div className="flex h-[520px] flex-col items-center justify-center text-center">
            <p className="text-lg font-black text-rose-400">Erro ao carregar historico.</p>
            <p className="mt-2 text-sm font-bold text-slate-400">{error}</p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex h-[520px] flex-col items-center justify-center text-center">
            <Activity className="mb-4 text-slate-600" size={44} />
            <p className="text-lg font-black text-white">Nenhum lead encontrado</p>
            <p className="mt-2 text-sm font-bold text-slate-500">Crie uma anotacao, mova uma etapa ou ajuste os filtros.</p>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[300px_360px_1fr]">
            <aside className="rounded-2xl border border-white/10 bg-[#07111f]">
              <div className="border-b border-white/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Mostrando {filteredLeads.length} de {leads.length} leads
                </p>
              </div>
              <div className="max-h-[620px] overflow-y-auto p-2">
                {filteredLeads.map((lead) => {
                  const active = lead.id === selectedLeadId;
                  const responsible = lead.responsavel_profile_id ? profilesById[lead.responsavel_profile_id] : null;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`mb-2 w-full rounded-xl border p-3 text-left transition ${
                        active
                          ? 'border-cyan-400 bg-cyan-400/12 shadow-lg shadow-cyan-950/30'
                          : 'border-white/5 bg-slate-950/40 hover:border-cyan-400/30 hover:bg-cyan-400/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">{lead.nome || 'Sem nome'}</p>
                          <p className="mt-1 truncate text-[11px] font-bold text-slate-400">{lead.operadora || lead.cidade || 'Sem pagina'}</p>
                        </div>
                        <span className="shrink-0 text-[10px] font-bold text-slate-500">{formatTime(lead.data_entrada || lead.created_at)}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="truncate rounded-lg bg-cyan-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-cyan-300">
                          {lead.status || '-'}
                        </span>
                        <span className="truncate text-[9px] font-black uppercase tracking-wider text-slate-500">
                          {responsible?.nome || 'Sem responsavel'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <aside className="rounded-2xl border border-white/10 bg-[#07111f] p-5">
              {selectedLead ? (
                <>
                  <div className="mb-5 border-b border-white/10 pb-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-black text-white">{selectedLead.nome}</h2>
                        <p className="mt-1 text-xs font-bold text-slate-500">{selectedLead.operadora || selectedLead.status || '-'}</p>
                      </div>
                      <span className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-300">
                        {selectedLead.etiqueta || selectedLead.status}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <LeadInfoLine label="Telefone" value={selectedLead.telefone} />
                    <LeadInfoLine label="E-mail" value={selectedLead.email} />
                    <LeadInfoLine label="Responsavel" value={selectedResponsible?.nome || 'Sem responsavel'} />
                    <LeadInfoLine label="Etapa atual" value={selectedLead.status} />
                    <LeadInfoLine label="Idade" value={selectedLead.idades} />
                    <LeadInfoLine label="CNPJ" value={selectedLead.cnpj || selectedLead.possui_cnpj} />
                    <LeadInfoLine label="Plano ativo" value={selectedLead.tem_plano_ativo} />
                    <LeadInfoLine label="Plano atual" value={selectedLead.plano_atual} />
                    <LeadInfoLine label="Investimento" value={selectedLead.investimento} />
                    <LeadInfoLine label="Cidade" value={selectedLead.cidade} />
                    <LeadInfoLine label="Motivo da busca" value={selectedLead.motivo_busca} />
                    <LeadInfoLine label="Hospital/regiao" value={selectedLead.hospital_preferencia} />
                    <LeadInfoLine label="Criado em" value={formatDateTime(selectedLead.data_entrada || selectedLead.created_at)} />
                  </div>

                  {normalize(selectedLead.observacoes) && (
                    <div className="mt-6 rounded-2xl border border-cyan-400/10 bg-cyan-400/5 p-4">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-300">Observacao atual</p>
                      <p className="whitespace-pre-wrap text-xs font-bold leading-relaxed text-slate-300">{selectedLead.observacoes}</p>
                    </div>
                  )}
                </>
              ) : null}
            </aside>

            <main className="rounded-2xl border border-white/10 bg-[#07111f] p-5">
              <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Linha do tempo</p>
                  <h2 className="mt-1 text-xl font-black text-white">{selectedLead?.nome || 'Selecione um lead'}</h2>
                </div>
                <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
                  {selectedEvents.length} eventos
                </span>
              </div>

              {selectedEvents.length === 0 ? (
                <div className="flex h-[420px] flex-col items-center justify-center text-center">
                  <FileText className="mb-3 text-slate-600" size={36} />
                  <p className="font-black text-white">Sem eventos para este lead</p>
                  <p className="mt-1 text-sm font-bold text-slate-500">As proximas observacoes e mudancas vao aparecer aqui.</p>
                </div>
              ) : (
                <div className="relative max-h-[620px] overflow-y-auto pr-2">
                  <div className="absolute bottom-0 left-5 top-0 w-px bg-white/10" />
                  <div className="space-y-4">
                    {selectedEvents.map((event) => {
                      const actor = event.actorProfileId ? profilesById[event.actorProfileId] : null;
                      const responsible = event.responsibleProfileId ? profilesById[event.responsibleProfileId] : selectedResponsible;
                      return (
                        <article key={event.id} className="relative pl-14">
                          <span className={`absolute left-0 top-4 flex h-10 w-10 items-center justify-center rounded-full border-4 border-[#07111f] ${activityTone(event.type)}`}>
                            {eventIcon(event.type)}
                          </span>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">
                                  {TYPE_LABELS[event.type] || event.type}
                                </p>
                                <h3 className="mt-1 text-base font-black text-white">{event.title}</h3>
                              </div>
                              <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
                                <CalendarDays size={13} /> {formatDateTime(event.created_at)}
                              </span>
                            </div>
                            {event.description && (
                              <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-300">{event.description}</p>
                            )}
                            <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                              <span>Autor: {actor?.nome || 'Sistema'}</span>
                              <span>Responsavel: {responsible?.nome || 'Sem responsavel'}</span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </main>
          </div>
        )}
      </section>
    </InternalLayout>
  );
}
