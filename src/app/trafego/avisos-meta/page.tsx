'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { AlertTriangle, Building2, Clock3, Filter, Loader2, RefreshCw, Search, TrendingUp, UserRoundCog, WalletCards, X } from 'lucide-react';
import MetaDatePicker from '@/components/ui/MetaDatePicker';

type MetaAlertRow = {
  corretor_id: string;
  corretor_nome: string;
  concessionaria_nome?: string | null;
  gestor_trafego_id?: string | null;
  gestor_nome?: string | null;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
  ctr: number;
  saldo: number | null;
  currency: string;
  forma_pagamento?: string;
  billing_type?: 'prepaid' | 'postpaid' | 'unknown';
  alerta_cpl_alto: boolean;
  alerta_saldo_baixo: boolean;
  error?: string;
};

function formatCurrency(value: number | null | undefined, currency = 'BRL') {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '0,00%';
  return `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function cleanPaymentLabel(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return 'Nao informado';
  if (/saldo dispon/i.test(text)) return 'Saldo pre-pago';
  return text;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function TrafficMetaAlertsPage() {
  const [rows, setRows] = useState<MetaAlertRow[]>([]);
  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('todos');
  const [alertFilter, setAlertFilter] = useState<'todos' | 'cpl_alto' | 'sem_saldo'>('todos');
  const [managerNames, setManagerNames] = useState<Record<string, string>>({});
  const [dateStart, setDateStart] = useState(() => dateDaysAgo(6));
  const [dateEnd, setDateEnd] = useState(() => dateDaysAgo(0));
  const [presetLabel, setPresetLabel] = useState('Últimos 7 dias');
  const [cplThreshold, setCplThreshold] = useState(28);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchAlerts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada. Entre novamente.');

      const response = await fetch('/api/integrations/meta/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          data_inicio: dateStart,
          data_fim: dateEnd,
          accounts_only: true,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (requestId !== requestIdRef.current) return;

      if (!response.ok) throw new Error(payload.error || 'Erro ao carregar avisos Meta.');

      const accounts = (payload.accounts || []) as MetaAlertRow[];
      const managerIds = Array.from(new Set(accounts.map((row) => row.gestor_trafego_id).filter(Boolean))) as string[];
      if (managerIds.length > 0) {
        const { data: managers } = await supabase
          .from('profiles')
          .select('id,nome')
          .in('id', managerIds);
        setManagerNames(Object.fromEntries((managers || []).map((manager) => [manager.id, manager.nome || 'Gestor sem nome'])));
      } else {
        setManagerNames({});
      }
      setRows(accounts);
      setCplThreshold(Number(payload.threshold_cpl) || 28);
      setUpdatedAt(payload.refreshed_at || new Date().toISOString());
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : 'Erro ao carregar avisos Meta.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [dateEnd, dateStart]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void fetchAlerts(), 0);
    return () => window.clearTimeout(timeout);
  }, [fetchAlerts]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchAlerts();
    }, 15 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [fetchAlerts]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return rows.filter((row) => {
      const matchesSearch = !normalizedSearch || `${row.concessionaria_nome || ''} ${row.meta_ad_account_name || ''}`
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedSearch);
      const matchesManager = managerFilter === 'todos'
        || (managerFilter === 'sem_gestor' ? !row.gestor_trafego_id : row.gestor_trafego_id === managerFilter);
      const isNoBalance = row.billing_type === 'prepaid' && row.saldo !== null && Number(row.saldo) <= 0;
      const matchesAlert = alertFilter === 'todos'
        || (alertFilter === 'cpl_alto' && row.alerta_cpl_alto)
        || (alertFilter === 'sem_saldo' && isNoBalance);
      return matchesSearch && matchesManager && matchesAlert;
    });
  }, [alertFilter, managerFilter, rows, search]);

  const managerOptions = useMemo(() => {
    const ids = Array.from(new Set(rows.map((row) => row.gestor_trafego_id).filter(Boolean))) as string[];
    return ids
      .map((id) => ({ id, nome: managerNames[id] || 'Gestor nao identificado' }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [managerNames, rows]);

  const counters = useMemo(() => {
    const highCpl = filteredRows.filter((row) => row.alerta_cpl_alto).length;
    const noBalance = filteredRows.filter((row) => row.billing_type === 'prepaid' && row.saldo !== null && Number(row.saldo) <= 0).length;
    const totalSpend = filteredRows.reduce((total, row) => total + Number(row.spend || 0), 0);
    const totalLeads = filteredRows.reduce((total, row) => total + Number(row.leads || 0), 0);
    const brokerages = new Set(filteredRows.map((row) => String(row.concessionaria_nome || row.meta_ad_account_name || row.corretor_nome).trim().toLocaleLowerCase('pt-BR')).filter(Boolean)).size;
    return {
      highCpl,
      noBalance,
      brokerages,
      totalSpend,
      totalLeads,
      averageCpl: totalLeads > 0 ? totalSpend / totalLeads : null,
    };
  }, [filteredRows]);

  const hasActiveFilters = Boolean(search.trim() || managerFilter !== 'todos' || alertFilter !== 'todos');

  const clearFilters = () => {
    setSearch('');
    setManagerFilter('todos');
    setAlertFilter('todos');
  };

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-amber-600">Monitoramento Meta</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Avisos Meta</h1>
          <p className="font-medium text-gray-500">Contas vinculadas aos corretores, atualizadas automaticamente a cada 15 minutos.</p>
        </div>
        <button
          onClick={fetchAlerts}
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
          Atualizar agora
        </button>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Counter tone="red" label="CPL alto" value={String(counters.highCpl)} />
        <Counter tone="amber" label="Sem saldo" value={String(counters.noBalance)} />
        <Counter tone="blue" label="Corretoras" value={String(counters.brokerages)} />
        <Counter tone="emerald" label="Leads Orion" value={String(counters.totalLeads)} />
        <Counter tone="slate" label="CPL medio" value={formatCurrency(counters.averageCpl)} />
      </div>

      <div className="mb-6 rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[minmax(240px,1.2fr)_minmax(210px,0.7fr)_auto_minmax(300px,auto)] xl:items-end">
          <div className="space-y-2 w-full">
            <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Nome</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar concessionária ou conta..."
                className="w-full rounded-2xl border-none bg-slate-50 py-4 pl-11 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          <div className="space-y-2 w-full">
            <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Gestor responsavel</label>
            <div className="relative">
              <UserRoundCog className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <select
                value={managerFilter}
                onChange={(event) => setManagerFilter(event.target.value)}
                className="w-full appearance-none rounded-2xl border-none bg-slate-50 py-4 pl-11 pr-9 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="todos">Todos os gestores</option>
                {managerOptions.map((manager) => <option key={manager.id} value={manager.id}>{manager.nome}</option>)}
                <option value="sem_gestor">Sem gestor</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Situacao</label>
            <div className="flex min-h-[52px] items-center gap-1 rounded-2xl bg-slate-50 p-1.5">
              {([
                ['todos', 'Todos'],
                ['cpl_alto', 'CPL alto'],
                ['sem_saldo', 'Sem saldo'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAlertFilter(value)}
                  className={`whitespace-nowrap rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors ${alertFilter === value ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="shrink-0 space-y-2 w-full md:w-auto">
            <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Período de Análise</label>
            <MetaDatePicker
              startDate={dateStart}
              endDate={dateEnd}
              preset={presetLabel}
              onChange={(start, end, label) => {
                setDateStart(start);
                setDateEnd(end);
                setPresetLabel(label);
              }}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-blue-700"><Building2 size={13} /> {counters.brokerages} corretora{counters.brokerages === 1 ? '' : 's'}</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-slate-600"><Filter size={13} /> {filteredRows.length} conta{filteredRows.length === 1 ? '' : 's'} exibida{filteredRows.length === 1 ? '' : 's'}</span>
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
              <X size={13} /> Limpar filtros
            </button>
          )}
        </div>
      </div>

      {updatedAt && (
        <div className="mb-4 flex items-center gap-2 text-xs font-bold text-slate-500">
          <Clock3 size={14} /> Ultima atualizacao: {new Date(updatedAt).toLocaleString('pt-BR')}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-[2rem] border border-gray-100 bg-white shadow-sm">
        <div className="scrollbar-visible overflow-x-scroll">
          <table className="w-full min-w-[1160px] text-left">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Concessionária / Conta</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">CTR</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Leads</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">CPL</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Investido</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Pagamento</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <Loader2 className="mx-auto animate-spin text-blue-600" size={32} />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm font-bold text-slate-400">Nenhuma conta vinculada encontrada para este filtro.</td>
                </tr>
              ) : filteredRows.map((row) => {
                const isPrepaid = row.billing_type === 'prepaid'
                  || /saldo pr[eé]-pago/i.test(String(row.forma_pagamento || ''));
                const hasPaymentError = row.error && (
                  /pagamento|payment|recusad|failed|declined|settle|cobrança|cobranca|cartao|cartão|card|invoice|unpaid|error/i.test(String(row.error))
                );

                let badgeText = 'Com Saldo';
                let badgeTone: 'red' | 'amber' | 'emerald' = 'emerald';
                let rowBgClass = 'hover:bg-slate-50/60';

                if (row.cpl !== null && row.cpl >= cplThreshold) {
                  badgeText = 'CPL Alto';
                  badgeTone = 'red';
                  rowBgClass = 'bg-red-50/40';
                } else if (hasPaymentError) {
                  badgeText = 'Erro Pagamento';
                  badgeTone = 'red';
                  rowBgClass = 'bg-red-50/40';
                } else if (isPrepaid && row.saldo !== null && row.saldo <= 0) {
                  badgeText = 'Sem Saldo';
                  badgeTone = 'red';
                  rowBgClass = 'bg-red-50/40';
                } else if (isPrepaid && row.saldo !== null && row.saldo <= 80) {
                  badgeText = 'Saldo Baixo';
                  badgeTone = 'amber';
                  rowBgClass = 'bg-amber-50/40';
                } else if (row.error) {
                  badgeText = 'Erro Meta';
                  badgeTone = 'amber';
                  rowBgClass = 'bg-amber-50/40';
                }

                return (
                  <tr key={`${row.corretor_id}-${row.meta_ad_account_id}`} className={rowBgClass}>
                    <td className="px-6 py-5">
                      <Badge tone={badgeTone} text={badgeText} />
                    </td>
                    <td className="px-6 py-5">
                      <p className="font-black text-gray-900">{row.concessionaria_nome || 'Concessionária não identificada'}</p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-blue-600">{row.meta_ad_account_name || (row.meta_ad_account_id ? `act_${row.meta_ad_account_id}` : 'Conta não identificada')}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">Gestor: {row.gestor_trafego_id ? managerNames[row.gestor_trafego_id] || 'não identificado' : 'não definido'}</p>
                      {row.error && <p className="mt-2 max-w-md text-xs font-bold text-amber-600">{row.error}</p>}
                    </td>
                    <td className="px-6 py-5 text-sm font-black text-slate-700">{formatPercent(row.ctr)}</td>
                    <td className="px-6 py-5 text-sm font-black text-slate-700">{row.leads}</td>
                    <td className="px-6 py-5">
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${row.cpl !== null && row.cpl >= cplThreshold ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                        {row.cpl === null
                          ? Number(row.leads || 0) === 0
                            ? 'Sem leads no período'
                            : 'CPL indisponível'
                          : formatCurrency(row.cpl, row.currency)}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-sm font-black text-slate-700">{formatCurrency(row.spend, row.currency)}</td>
                    <td className="px-6 py-5">
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                        {cleanPaymentLabel(row.forma_pagamento)}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      {isPrepaid ? (
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${row.saldo !== null && row.saldo <= 80 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                          {formatCurrency(row.saldo, row.currency)}
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-slate-400">Não se aplica</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </InternalLayout>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone: 'red' | 'blue' | 'emerald' | 'amber' | 'slate' }) {
  const tones = {
    red: 'border-red-100 bg-red-50 text-red-700',
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    slate: 'border-slate-100 bg-white text-slate-700',
  };

  return (
    <div className={`rounded-[2rem] border p-5 shadow-sm ${tones[tone]}`}>
      <p className="mb-2 text-[10px] font-black uppercase tracking-widest">{label}</p>
      <p className="text-3xl font-black text-gray-950">{value}</p>
    </div>
  );
}

function Badge({ tone, text }: { tone: 'red' | 'emerald' | 'amber'; text: string }) {
  const tones = {
    red: 'bg-red-100 text-red-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
  };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${tones[tone]}`}>
      {tone === 'red' ? <AlertTriangle size={12} /> : tone === 'amber' ? <WalletCards size={12} /> : <TrendingUp size={12} />}
      {text}
    </span>
  );
}
