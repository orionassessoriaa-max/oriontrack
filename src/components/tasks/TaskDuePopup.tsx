'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlarmClock, CalendarDays, ChevronRight, Clock3, X } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';

type DueTask = {
  id: string;
  titulo: string;
  descricao: string | null;
  vencimento: string;
  prioridade: string;
  lead_nome: string | null;
  minutes_until_due: number;
};

type ReminderPayload = {
  todayTasks?: DueTask[];
  imminentTasks?: DueTask[];
};

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TaskDuePopup() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<DueTask[]>([]);
  const [imminentIds, setImminentIds] = useState<Set<string>>(new Set());
  const initialized = useRef(false);
  const seenImminentIds = useRef<Set<string>>(new Set());
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const brokerId = profile?.corretor_id;
    const profileId = profile?.id;
    const role = profile?.tipo_usuario;
    if (!brokerId || !profileId || !role || !['corretor', 'corretor_admin', 'corretor_membro'].includes(role)) return;
    const requestedBrokerId = brokerId;
    const requestedProfileId = profileId;

    let cancelled = false;
    initialized.current = false;
    seenImminentIds.current = new Set();

    async function loadTasks() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;

      const response = await fetch(`/api/tarefas/lembretes?corretor_id=${encodeURIComponent(requestedBrokerId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-orion-view-profile-id': requestedProfileId,
        },
        cache: 'no-store',
      });
      if (!response.ok || cancelled) return;
      const payload = await response.json() as ReminderPayload;
      const today = payload.todayTasks || [];
      const imminent = new Set((payload.imminentTasks || []).map((task) => task.id));
      setTasks(today);
      setImminentIds(imminent);

      if (!initialized.current) {
        initialized.current = true;
        seenImminentIds.current = imminent;
        if (today.length > 0) setOpen(true);
        return;
      }

      const hasNewImminentTask = [...imminent].some((id) => !seenImminentIds.current.has(id));
      seenImminentIds.current = new Set([...seenImminentIds.current, ...imminent]);
      if (hasNewImminentTask) setOpen(true);
    }

    const initialTimer = window.setTimeout(() => void loadTasks(), 0);
    const interval = window.setInterval(() => void loadTasks(), 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadTasks();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [profile?.corretor_id, profile?.id, profile?.tipo_usuario]);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open || tasks.length === 0) return null;

  const imminentCount = tasks.filter((task) => imminentIds.has(task.id)).length;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-reminder-title"
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-cyan-400/20 bg-[#07111f] shadow-2xl shadow-cyan-950/50"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-cyan-500/15 via-blue-500/10 to-transparent p-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
              <CalendarDays size={24} aria-hidden="true" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">Agenda comercial</p>
              <h2 id="task-reminder-title" className="mt-1 text-2xl font-black tracking-tight text-white">
                {tasks.length === 1 ? '1 tarefa para hoje' : `${tasks.length} tarefas para hoje`}
              </h2>
              <p className="mt-1 text-sm font-semibold text-slate-400">Confira os prazos antes de seguir com os atendimentos.</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar aviso de tarefas"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {imminentCount > 0 && (
          <div className="mx-6 mt-5 flex items-center gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-amber-100">
            <AlarmClock size={20} className="shrink-0 text-amber-300" aria-hidden="true" />
            <p className="text-sm font-extrabold">
              {imminentCount === 1 ? '1 tarefa vence nos próximos 30 minutos.' : `${imminentCount} tarefas vencem nos próximos 30 minutos.`}
            </p>
          </div>
        )}

        <div className="max-h-[45vh] space-y-2 overflow-y-auto p-6">
          {tasks.map((task) => {
            const imminent = imminentIds.has(task.id);
            return (
              <div key={task.id} className={`rounded-2xl border p-4 ${imminent ? 'border-amber-400/25 bg-amber-400/[0.07]' : 'border-white/10 bg-white/[0.035]'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{task.titulo}</p>
                    {task.lead_nome && <p className="mt-1 truncate text-xs font-bold text-slate-400">Lead: {task.lead_nome}</p>}
                  </div>
                  <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${imminent ? 'bg-amber-400/15 text-amber-200' : 'bg-cyan-400/10 text-cyan-200'}`}>
                    <Clock3 size={13} aria-hidden="true" />
                    {formatTime(task.vencimento)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-white/10 bg-black/10 p-6 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-xl border border-white/10 px-5 py-3 text-sm font-black text-slate-300 transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            Ver depois
          </button>
          <Link
            href="/tarefas"
            onClick={() => setOpen(false)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#07111f]"
          >
            Abrir tarefas
            <ChevronRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
