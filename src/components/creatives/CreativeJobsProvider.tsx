'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, CheckCircle2, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';

export type CreativeGenerationJob = {
  id: string;
  corretor_id: string;
  gestor_id: string;
  concessionaria: string;
  operadora: string;
  regiao: string;
  quantidade: number;
  origem: string;
  status: 'na_fila' | 'gerando' | 'pronto' | 'falhou' | 'cancelado';
  progresso: number;
  erro: string | null;
  created_at: string;
  finished_at: string | null;
};

type CreativeJobsContextValue = {
  jobs: CreativeGenerationJob[];
  jobsVersion: number;
  refreshJobs: () => Promise<void>;
};

const CreativeJobsContext = createContext<CreativeJobsContextValue>({
  jobs: [],
  jobsVersion: 0,
  refreshJobs: async () => {},
});

export function useCreativeJobs() {
  return useContext(CreativeJobsContext);
}

async function authToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

function jobSignature(jobs: CreativeGenerationJob[]) {
  return jobs
    .map((job) => `${job.id}:${job.status}:${job.progresso}:${job.finished_at || ''}`)
    .join('|');
}

function CreativeJobsProgress({
  jobs,
  recentTerminalIds,
  onCancel,
  canceling,
}: {
  jobs: CreativeGenerationJob[];
  recentTerminalIds: string[];
  onCancel: (jobIds: string[]) => Promise<void>;
  canceling: boolean;
}) {
  const activeJobs = jobs.filter((job) => job.status === 'na_fila' || job.status === 'gerando');
  const recentFinished = jobs.filter((job) => recentTerminalIds.includes(job.id));
  const visibleJobs = activeJobs.length > 0 ? activeJobs : recentFinished.slice(0, 3);
  if (visibleJobs.length === 0) return null;

  const total = activeJobs.reduce((sum, job) => sum + Math.max(1, job.quantidade), 0);
  const completed = activeJobs.reduce(
    (sum, job) => sum + Math.min(Math.max(0, job.progresso), Math.max(1, job.quantidade)),
    0
  );
  const failed = visibleJobs.some((job) => job.status === 'falhou');
  const canceled = activeJobs.length === 0 && visibleJobs.every((job) => job.status === 'cancelado');
  const finished = activeJobs.length === 0 && visibleJobs.every((job) => job.status === 'pronto');
  const percent = activeJobs.length > 0
    ? Math.min(100, Math.round((completed / Math.max(1, total)) * 100))
    : finished ? 100 : 0;

  return (
    <aside
      className="fixed bottom-4 left-1/2 z-[115] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#07111f]/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
      aria-live="polite"
      aria-label="Progresso da geração de criativos"
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          failed
            ? 'bg-red-400/10 text-red-300'
            : canceled
              ? 'bg-amber-400/10 text-amber-300'
            : finished
              ? 'bg-emerald-400/10 text-emerald-300'
              : 'bg-cyan-400/10 text-cyan-300'
        }`}>
          {failed ? <TriangleAlert size={19} /> : canceled ? <Ban size={19} /> : finished ? <CheckCircle2 size={19} /> : <Loader2 className="animate-spin" size={19} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <Sparkles size={15} className="text-cyan-400" />
              {failed ? 'Falha na geração' : canceled ? 'Geração cancelada' : finished ? 'Criativos finalizados' : 'Criando em segundo plano'}
            </p>
            <p className="text-xs font-black tabular-nums text-cyan-300">
              {activeJobs.length > 0 ? `${completed} de ${total} criados · ${percent}%` : canceled ? 'Interrompida' : finished ? '100%' : 'Verifique o erro'}
            </p>
          </div>
          {activeJobs.length > 0 && (
            <button
              type="button"
              disabled={canceling}
              onClick={() => void onCancel(activeJobs.map((job) => job.id))}
              className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs font-black text-rose-200 transition hover:bg-rose-500/20 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {canceling ? <Loader2 className="animate-spin" size={15} /> : <Ban size={15} />}
              {canceling ? 'Cancelando...' : 'Cancelar geração'}
            </button>
          )}
          <div className="mt-2 space-y-1">
            {visibleJobs.slice(0, 3).map((job) => (
              <p key={job.id} className="truncate text-xs font-semibold text-slate-400">
                <span className="font-black text-slate-200">{job.concessionaria || 'Concessionária'}</span>
                {' · '}{job.regiao} → {job.operadora}
                {job.status === 'gerando' ? ` · ${job.progresso}/${job.quantidade}` : ''}
                {job.status === 'na_fila' ? ' · na fila' : ''}
                {job.status === 'falhou' && job.erro ? ` · ${job.erro}` : ''}
              </p>
            ))}
            {visibleJobs.length > 3 && (
              <p className="text-xs font-bold text-slate-500">+{visibleJobs.length - 3} lote(s) em andamento</p>
            )}
          </div>
        </div>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`h-full transition-[width] duration-700 ${
            failed
              ? 'bg-red-400'
              : finished
                ? 'bg-emerald-400'
                : 'bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-300'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </aside>
  );
}

export default function CreativeJobsProvider({ children }: { children: React.ReactNode }) {
  const { profile, actualProfile, loading } = useAuth();
  const [jobs, setJobs] = useState<CreativeGenerationJob[]>([]);
  const [jobsVersion, setJobsVersion] = useState(0);
  const [recentTerminalIds, setRecentTerminalIds] = useState<string[]>([]);
  const signatureRef = useRef<string | null>(null);
  const previousJobsRef = useRef<Map<string, CreativeGenerationJob>>(new Map());
  const pollingRef = useRef(false);
  const [canceling, setCanceling] = useState(false);

  const managerId = profile?.tipo_usuario === 'gestor_trafego' ? profile.id : null;
  const canTrack = Boolean(
    !loading
    && managerId
    && ['admin', 'gestor_trafego'].includes(String(actualProfile?.tipo_usuario))
  );

  const refreshJobs = useCallback(async () => {
    if (!canTrack || !managerId || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const token = await authToken();
      if (!token) return;
      const params = new URLSearchParams();
      if (actualProfile?.tipo_usuario === 'admin') params.set('gestor_id', managerId);
      const response = await fetch(`/api/criativos/jobs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      const nextJobs = (payload.jobs || []) as CreativeGenerationJob[];
      const nextSignature = jobSignature(nextJobs);
      if (signatureRef.current !== null && signatureRef.current !== nextSignature) {
        setJobsVersion((current) => current + 1);
      }
      const newlyFinished = nextJobs.filter((job) => {
        const previous = previousJobsRef.current.get(job.id);
        return Boolean(
          previous
          && ['na_fila', 'gerando'].includes(previous.status)
          && ['pronto', 'falhou', 'cancelado'].includes(job.status)
        );
      });
      if (newlyFinished.length > 0) {
        const finishedIds = newlyFinished.map((job) => job.id);
        setRecentTerminalIds((current) => [...new Set([...current, ...finishedIds])]);
        window.setTimeout(() => {
          setRecentTerminalIds((current) => current.filter((id) => !finishedIds.includes(id)));
        }, 20_000);
      }
      signatureRef.current = nextSignature;
      previousJobsRef.current = new Map(nextJobs.map((job) => [job.id, job]));
      setJobs(nextJobs);
    } finally {
      pollingRef.current = false;
    }
  }, [actualProfile?.tipo_usuario, canTrack, managerId]);

  const cancelJobs = useCallback(async (jobIds: string[]) => {
    if (!managerId || jobIds.length === 0 || canceling) return;
    if (!window.confirm('Cancelar os lotes em andamento? Os criativos já concluídos serão mantidos.')) return;
    setCanceling(true);
    try {
      const token = await authToken();
      if (!token) return;
      const response = await fetch('/api/criativos/jobs', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          job_ids: jobIds,
          gestor_id: actualProfile?.tipo_usuario === 'admin' ? managerId : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível cancelar a geração.');
      await refreshJobs();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Não foi possível cancelar a geração.');
    } finally {
      setCanceling(false);
    }
  }, [actualProfile?.tipo_usuario, canceling, managerId, refreshJobs]);

  useEffect(() => {
    if (!canTrack) {
      signatureRef.current = null;
      previousJobsRef.current = new Map();
      return;
    }
    void refreshJobs();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshJobs();
    }, 2500);
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refreshJobs();
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [canTrack, refreshJobs]);

  const value = useMemo(
    () => ({ jobs, jobsVersion, refreshJobs }),
    [jobs, jobsVersion, refreshJobs]
  );

  return (
    <CreativeJobsContext.Provider value={value}>
      {children}
      {canTrack && (
        <CreativeJobsProgress
          jobs={jobs}
          recentTerminalIds={recentTerminalIds}
          onCancel={cancelJobs}
          canceling={canceling}
        />
      )}
    </CreativeJobsContext.Provider>
  );
}
