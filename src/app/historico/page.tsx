'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadAtividade } from '@/types';
import { Activity, ArrowRight, Clock, Loader2, RefreshCw, Search, UserRound } from 'lucide-react';

type TimelineLead = Pick<Lead, 'id' | 'nome' | 'telefone' | 'status' | 'cidade' | 'corretor_id' | 'responsavel_profile_id'>;

type ProfileRow = {
  id: string;
  nome: string | null;
  email: string | null;
};

type ResponsibleFilter = 'todos' | 'sem_responsavel' | string;

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

function activityTone(tipo: string) {
  if (tipo === 'nota') return 'border-cyan-400 bg-cyan-400';
  if (tipo === 'status') return 'border-blue-400 bg-blue-400';
  if (tipo === 'tarefa') return 'border-amber-300 bg-amber-300';
  if (tipo === 'whatsapp') return 'border-emerald-300 bg-emerald-300';
  return 'border-slate-300 bg-slate-300';
}

export default function HistoricoPage() {
  const { profile } = useAuth();
  const [activities, setActivities] = useState<LeadAtividade[]>([]);
  const [leadsById, setLeadsById] = useState<Record<string, TimelineLead>>({});
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [responsibleFilter, setResponsibleFilter] = useState<ResponsibleFilter>('todos');

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
      const nextProfiles = (payload.profiles || []) as Array<ProfileRow & { email_real?: string | null }>;

      setActivities(nextActivities);
      setLeadsById(Object.fromEntries(nextLeads.map((lead) => [lead.id, lead])));
      setProfilesById(Object.fromEntries(nextProfiles.map((item) => [item.id, { ...item, email: item.email_real || item.email }])));
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar historico.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchHistory();
  }, [profile?.id, profile?.tipo_usuario, profile?.corretor_id]);

  const responsibleOptions = useMemo(() => {
    const options = new Map<string, ProfileRow>();
    let hasUnassigned = false;

    Object.values(leadsById).forEach((lead) => {
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
  }, [leadsById, profilesById]);

  const visibleActivities = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return activities.filter((activity) => {
      const lead = leadsById[activity.lead_id];
      if (!lead) return false;
      const actor = activity.profile_id ? profilesById[activity.profile_id] : null;
      const responsibleId = lead.responsavel_profile_id || null;

      if (canFilterResponsible && responsibleFilter !== 'todos') {
        if (responsibleFilter === 'sem_responsavel') {
          if (responsibleId) return false;
        } else if (responsibleId !== responsibleFilter) {
          return false;
        }
      }

      const haystack = [
        lead.nome,
        lead.telefone,
        lead.cidade,
        lead.status,
        activity.titulo,
        activity.descricao,
        actor?.nome,
      ].join(' ').toLowerCase();

      return !normalizedSearch || haystack.includes(normalizedSearch);
    });
  }, [activities, leadsById, profilesById, search, responsibleFilter, canFilterResponsible]);

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Linha do tempo comercial</p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Historico dos Leads</h1>
          <p className="mt-1 max-w-3xl font-bold text-slate-400">
            Acompanhe mudancas de etapa, anotacoes, tarefas, etiquetas, campos personalizados e eventos do Inbox em ordem cronologica.
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

      <div className={`mb-6 grid gap-3 ${canFilterResponsible ? 'lg:grid-cols-[1fr_260px]' : 'lg:grid-cols-1'}`}>
        <label className="relative block">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por lead, telefone, evento ou anotacao..."
            className="w-full rounded-2xl border border-white/10 bg-slate-950 px-12 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400/70"
          />
        </label>

        {canFilterResponsible && (
          <select
            value={responsibleFilter}
            onChange={(event) => setResponsibleFilter(event.target.value)}
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400/70"
          >
            <option value="todos">Todos responsaveis</option>
            {responsibleOptions.people.map((person) => (
              <option key={person.id} value={person.id}>{person.nome || person.email || 'Sem nome'}</option>
            ))}
            {responsibleOptions.hasUnassigned && <option value="sem_responsavel">Sem responsavel</option>}
          </select>
        )}
      </div>

      <section className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-5 shadow-2xl">
        {loading ? (
          <div className="flex h-72 items-center justify-center">
            <Loader2 className="animate-spin text-cyan-400" size={40} />
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="text-lg font-black text-rose-400">Erro ao carregar historico.</p>
            <p className="mt-2 text-sm font-bold text-slate-400">{error}</p>
          </div>
        ) : visibleActivities.length === 0 ? (
          <div className="p-12 text-center">
            <Activity className="mx-auto mb-4 text-slate-600" size={44} />
            <p className="text-lg font-black text-white">Nenhum evento encontrado</p>
            <p className="mt-2 text-sm font-bold text-slate-500">Movimente um lead, crie uma anotacao ou ajuste os filtros.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute bottom-0 left-5 top-0 w-px bg-white/10" />
            <div className="space-y-4">
              {visibleActivities.map((activity) => {
                const lead = leadsById[activity.lead_id];
                const actor = activity.profile_id ? profilesById[activity.profile_id] : null;
                const responsible = lead?.responsavel_profile_id ? profilesById[lead.responsavel_profile_id] : null;
                return (
                  <div key={activity.id} className="relative grid gap-4 pl-14 lg:grid-cols-[1fr_220px]">
                    <span className={`absolute left-[13px] top-5 h-4 w-4 rounded-full border-4 border-slate-950 ${activityTone(activity.tipo)}`} />
                    <div className="rounded-[1.5rem] border border-white/10 bg-[#07111f] p-5">
                      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">{activity.tipo}</p>
                          <h2 className="mt-1 text-lg font-black text-white">{activity.titulo}</h2>
                        </div>
                        <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
                          <Clock size={13} /> {formatDateTime(activity.created_at)}
                        </span>
                      </div>
                      {activity.descricao && (
                        <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-300">{activity.descricao}</p>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <span>Autor: {actor?.nome || 'Sistema'}</span>
                        <span>Responsavel: {responsible?.nome || 'Sem responsavel'}</span>
                      </div>
                    </div>
                    <Link
                      href={`/crm?lead=${activity.lead_id}`}
                      className="group flex items-center justify-between rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 transition hover:border-cyan-400/40 hover:bg-cyan-400/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{lead?.nome || 'Lead nao encontrado'}</p>
                        <p className="mt-1 truncate text-xs font-bold text-slate-500">{lead?.telefone || lead?.cidade || '-'}</p>
                        <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-cyan-300">{lead?.status || '-'}</p>
                      </div>
                      <ArrowRight className="text-slate-500 transition group-hover:text-cyan-300" size={18} />
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </InternalLayout>
  );
}
