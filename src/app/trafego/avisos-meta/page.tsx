'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { AlertTriangle, Clock3, Loader2, RefreshCw, Search, TrendingUp, WalletCards } from 'lucide-react';
import MetaDatePicker from '@/components/ui/MetaDatePicker';

type MetaAlertRow = {
  corretor_id: string;
  corretor_nome: string;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
  ctr: number;
  saldo: number | null;
  currency: string;
  forma_pagamento?: string;
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
  return date.toISOString().slice(0, 10);
}

function currentMonthStart() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(firstDay.getTime() - offset).toISOString().slice(0, 10);
}

export default function TrafficMetaAlertsPage() {
  const [rows, setRows] = useState<MetaAlertRow[]>([]);
  const [search, setSearch] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [presetLabel, setPresetLabel] = useState('Todo o período');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function fetchAlerts() {
    setLoading(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError('Sessao expirada. Entre novamente.');
      setLoading(false);
      return;
    }

    const response = await fetch('/api/integrations/meta/alerts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        data_inicio: dateStart || '2024-01-01',
        data_fim: dateEnd || new Date().toISOString().slice(0, 10),
        nome: search,
      }),
    });

    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(payload.error || 'Erro ao carregar avisos Meta.');
      return;
    }

    setRows(payload.accounts || []);
    setUpdatedAt(payload.refreshed_at || new Date().toISOString());
  }

  useEffect(() => {
    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    setDateStart(currentMonthStart());
    setDateEnd(todayStr);
    setPresetLabel('Este mes');
  }, []);

  useEffect(() => {
    void fetchAlerts();
  }, [dateStart, dateEnd]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchAlerts();
    }, 15 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [dateStart, dateEnd, search]);

  const counters = useMemo(() => {
    const highCpl = rows.filter((row) => row.alerta_cpl_alto).length;
    const lowBalance = rows.filter((row) => row.alerta_saldo_baixo).length;
    const totalSpend = rows.reduce((total, row) => total + Number(row.spend || 0), 0);
    const totalLeads = rows.reduce((total, row) => total + Number(row.leads || 0), 0);
    return {
      highCpl,
      lowBalance,
      totalSpend,
      totalLeads,
      averageCpl: totalLeads > 0 ? totalSpend / totalLeads : null,
    };
  }, [rows]);

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

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Counter tone="red" label="CPL alto" value={String(counters.highCpl)} />
        <Counter tone="amber" label="Saldo baixo" value={String(counters.lowBalance)} />
        <Counter tone="emerald" label="Leads Orion" value={String(counters.totalLeads)} />
        <Counter tone="slate" label="CPL medio" value={formatCurrency(counters.averageCpl)} />
      </div>

      <div className="mb-6 rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col md:flex-row gap-4 items-end justify-between">
          <div className="flex-1 space-y-2 w-full">
            <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Nome</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar corretor ou conta..."
                className="w-full rounded-2xl border-none bg-slate-50 py-4 pl-11 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
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
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Corretor / Conta</th>
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
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm font-bold text-slate-400">Nenhuma conta vinculada encontrada para este filtro.</td>
                </tr>
              ) : rows.map((row) => {
                const isCard = String(row.forma_pagamento || '').toLowerCase().includes('cartao') || 
                               String(row.forma_pagamento || '').toLowerCase().includes('cartão') ||
                               String(row.forma_pagamento || '').toLowerCase().includes('card') ||
                               String(row.forma_pagamento || '').toLowerCase().includes('visa') ||
                               String(row.forma_pagamento || '').toLowerCase().includes('mastercard');
                const hasPaymentError = row.error && (
                  /pagamento|payment|recusad|failed|declined|settle|cobrança|cobranca|cartao|cartão|card|invoice|unpaid|error/i.test(String(row.error))
                );

                let badgeText = 'Com Saldo';
                let badgeTone: 'red' | 'amber' | 'emerald' = 'emerald';
                let rowBgClass = 'hover:bg-slate-50/60';

                if (row.cpl !== null && row.cpl > 25) {
                  badgeText = 'CPL Alto';
                  badgeTone = 'red';
                  rowBgClass = 'bg-red-50/40';
                } else if (isCard && hasPaymentError) {
                  badgeText = 'Erro Pagamento';
                  badgeTone = 'red';
                  rowBgClass = 'bg-red-50/40';
                } else if (!isCard && row.saldo !== null && row.saldo <= 0) {
                  badgeText = 'Sem Saldo';
                  badgeTone = 'red';
                  rowBgClass = 'bg-red-50/40';
                } else if (!isCard && row.saldo !== null && row.saldo < 100) {
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
                      <p className="font-black text-gray-900">{row.corretor_nome}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">{row.meta_ad_account_name || `act_${row.meta_ad_account_id}`}</p>
                      {row.error && <p className="mt-2 max-w-md text-xs font-bold text-amber-600">{row.error}</p>}
                    </td>
                    <td className="px-6 py-5 text-sm font-black text-slate-700">{formatPercent(row.ctr)}</td>
                    <td className="px-6 py-5 text-sm font-black text-slate-700">{row.leads}</td>
                    <td className="px-6 py-5">
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${row.cpl !== null && row.cpl > 25 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                        {row.cpl === null ? 'N/A' : formatCurrency(row.cpl, row.currency)}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-sm font-black text-slate-700">{formatCurrency(row.spend, row.currency)}</td>
                    <td className="px-6 py-5">
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                        {cleanPaymentLabel(row.forma_pagamento)}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      {isCard ? (
                        <span className="text-xs font-bold text-slate-400">-</span>
                      ) : (
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${row.saldo !== null && row.saldo < 100 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                          {formatCurrency(row.saldo, row.currency)}
                        </span>
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
