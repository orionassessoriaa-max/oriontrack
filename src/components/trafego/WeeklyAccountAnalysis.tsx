'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type Concessionaria = {
  key: string;
  nome: string;
};

type Analysis = {
  concessionaria_key: string;
  data: string;
  status: 'boa' | 'atencao' | 'ruim';
};

type Status = Analysis['status'] | '';

const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: '', label: 'Não analisada' },
  { value: 'boa', label: 'Boa' },
  { value: 'atencao', label: 'Atenção' },
  { value: 'ruim', label: 'Ruim' },
];

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mondayOfCurrentWeek() {
  const value = new Date();
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  value.setHours(12, 0, 0, 0);
  return localDate(value);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + amount);
  return localDate(value);
}

function cellKey(concessionariaKey: string, date: string) {
  return `${concessionariaKey}:${date}`;
}

function statusClass(status: Status) {
  if (status === 'boa') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (status === 'atencao') return 'border-amber-300 bg-amber-50 text-amber-800';
  if (status === 'ruim') return 'border-rose-300 bg-rose-50 text-rose-800';
  return 'border-slate-200 bg-white text-slate-500';
}

export default function WeeklyAccountAnalysis({ gestorId }: { gestorId?: string }) {
  const [weekStart, setWeekStart] = useState(mondayOfCurrentWeek);
  const [concessionarias, setConcessionarias] = useState<Concessionaria[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(
    () => DAYS.map((label, index) => ({ label, date: addDays(weekStart, index) })),
    [weekStart],
  );

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sessão expirada.');
      const params = new URLSearchParams({ week_start: weekStart });
      if (gestorId) params.set('gestor_id', gestorId);
      const response = await fetch(`/api/trafego/analise-semanal?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o quadro.');
      const next: Record<string, Status> = {};
      (payload.analyses || []).forEach((item: Analysis) => {
        next[cellKey(item.concessionaria_key, item.data)] = item.status;
      });
      setConcessionarias(payload.concessionarias || []);
      setAnalyses(next);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [getToken, gestorId, weekStart]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function updateStatus(concessionaria: Concessionaria, date: string, status: Status) {
    const key = cellKey(concessionaria.key, date);
    const previous = analyses[key] || '';
    setAnalyses((current) => ({ ...current, [key]: status }));
    setSaving(key);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sessão expirada.');
      const response = await fetch('/api/trafego/analise-semanal', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gestor_id: gestorId,
          concessionaria_key: concessionaria.key,
          concessionaria_nome: concessionaria.nome,
          data: date,
          status,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar.');
    } catch (saveError: unknown) {
      setAnalyses((current) => ({ ...current, [key]: previous }));
      setError(saveError instanceof Error ? saveError.message : 'Erro ao salvar.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      className="mb-6 overflow-hidden rounded-2xl border"
      style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
    >
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--tf-border)' }}>
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays size={18} style={{ color: 'var(--tf-accent-ink)' }} />
            <h2 className="text-lg font-black">Análise semanal da carteira</h2>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--tf-ink-soft)' }}>
            Classifique cada concessionária de segunda a sexta. Este quadro é individual por gestor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold" style={{ color: 'var(--tf-ink-soft)' }}>
            Semana
            <input
              type="date"
              value={weekStart}
              onChange={(event) => {
                const selected = new Date(`${event.target.value}T12:00:00`);
                const offset = (selected.getDay() + 6) % 7;
                selected.setDate(selected.getDate() - offset);
                setWeekStart(localDate(selected));
              }}
              className="ml-2 h-10 px-3 text-sm font-bold"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Atualizar quadro"
            className="tf-no-lift inline-flex h-10 w-10 items-center justify-center rounded-xl border"
            style={{ borderColor: 'var(--tf-border)', color: 'var(--tf-accent-ink)' }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error ? <div className="border-b px-5 py-3 text-sm font-bold text-rose-600" style={{ borderColor: 'var(--tf-border)' }}>{error}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-14 text-sm font-bold" style={{ color: 'var(--tf-ink-soft)' }}>
          <Loader2 className="animate-spin" size={20} /> Carregando análises...
        </div>
      ) : concessionarias.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm font-medium" style={{ color: 'var(--tf-ink-soft)' }}>
          Nenhuma concessionária atribuída a este gestor.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse">
            <thead>
              <tr style={{ background: 'var(--tf-surface-2)' }}>
                <th className="sticky left-0 z-10 min-w-[250px] border-b px-5 py-3 text-left text-xs font-black uppercase tracking-wider" style={{ background: 'var(--tf-surface-2)', borderColor: 'var(--tf-border)' }}>
                  Concessionária
                </th>
                {dates.map((day) => (
                  <th key={day.date} className="min-w-[138px] border-b px-3 py-3 text-left" style={{ borderColor: 'var(--tf-border)' }}>
                    <span className="block text-xs font-black">{day.label}</span>
                    <span className="text-[11px] font-medium" style={{ color: 'var(--tf-ink-mute)' }}>
                      {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(`${day.date}T12:00:00`))}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {concessionarias.map((concessionaria) => (
                <tr key={concessionaria.key} className="border-b last:border-b-0" style={{ borderColor: 'var(--tf-border)' }}>
                  <th className="sticky left-0 z-[1] px-5 py-3 text-left text-sm font-black" style={{ background: 'var(--tf-surface)' }}>
                    {concessionaria.nome}
                  </th>
                  {dates.map((day) => {
                    const key = cellKey(concessionaria.key, day.date);
                    const status = analyses[key] || '';
                    return (
                      <td key={day.date} className="px-3 py-2.5">
                        <div className="relative">
                          <select
                            value={status}
                            onChange={(event) => void updateStatus(concessionaria, day.date, event.target.value as Status)}
                            disabled={saving === key}
                            aria-label={`${concessionaria.nome}, ${day.label}`}
                            className={`h-10 w-full cursor-pointer rounded-xl border px-3 text-xs font-black transition-colors disabled:cursor-wait disabled:opacity-60 ${statusClass(status)}`}
                          >
                            {STATUS_OPTIONS.map((option) => <option key={option.value || 'empty'} value={option.value}>{option.label}</option>)}
                          </select>
                          {saving === key ? <Loader2 className="pointer-events-none absolute right-8 top-3 animate-spin" size={14} /> : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t px-5 py-3 text-xs font-bold" style={{ borderColor: 'var(--tf-border)', color: 'var(--tf-ink-soft)' }}>
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-600" /> Boa</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Atenção</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Ruim</span>
      </div>
    </section>
  );
}
