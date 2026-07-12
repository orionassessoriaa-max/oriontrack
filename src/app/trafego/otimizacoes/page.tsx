'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import MetaDatePicker from '@/components/ui/MetaDatePicker';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AlertTriangle, BarChart3, Calendar, Loader2, RefreshCw, Search, TrendingUp } from 'lucide-react';

type MetaAccountRow = {
  corretor_id: string;
  corretor_nome: string;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
  ctr: number;
  cpc?: number;
  cpm?: number;
  frequency?: number;
  link_clicks?: number;
  landing_page_views?: number;
  cost_per_link_click?: number;
  cost_per_landing_page_view?: number;
  currency: string;
  alerta_cpl_alto: boolean;
  alerta_cpl_atencao?: boolean;
  dados_crm_pendentes?: boolean;
  error?: string;
};

function todayLocal() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function currentMonthStart() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(first.getTime() - offset).toISOString().slice(0, 10);
}

function formatCurrency(value: number | null | undefined, currency = 'BRL') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0,00%';
  return `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export default function OtimizacoesPage() {
  const { profile, actualProfile } = useAuth();
  const [rows, setRows] = useState<MetaAccountRow[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [search, setSearch] = useState('');
  const [dateStart, setDateStart] = useState(currentMonthStart());
  const [dateEnd, setDateEnd] = useState(todayLocal());
  const [presetLabel, setPresetLabel] = useState('Este mês');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function fetchRows() {
    setLoading(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError('Sessão expirada.');
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
        data_inicio: dateStart,
        data_fim: dateEnd,
        nome: search,
        gestor_id: actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego'
          ? profile.id
          : undefined,
      }),
    });

    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(payload.error || 'Erro ao carregar otimizações.');
      return;
    }

    const nextRows = (payload.accounts || []) as MetaAccountRow[];
    setRows(nextRows);
    setUpdatedAt(payload.refreshed_at || new Date().toISOString());
    setSelectedKey((current) => {
      if (current && nextRows.some((row) => rowKey(row) === current)) return current;
      return nextRows[0] ? rowKey(nextRows[0]) : '';
    });
  }

  useEffect(() => {
    void fetchRows();
  }, [dateStart, dateEnd]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => `${row.corretor_nome} ${row.meta_ad_account_name || ''}`.toLowerCase().includes(term));
  }, [rows, search]);

  const selected = filteredRows.find((row) => rowKey(row) === selectedKey) || filteredRows[0] || null;
  const maxSpend = Math.max(...filteredRows.map((row) => Number(row.spend || 0)), 1);
  const maxCpl = Math.max(...filteredRows.map((row) => Number(row.cpl || 0)), 1);

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Revisão de performance</p>
          <h1 className="text-3xl font-black text-white sm:text-4xl">Otimizações</h1>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-400">
            Métricas Meta cruzadas com leads reais do CRM. CPL nunca usa lead do Meta.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          <button
            type="button"
            onClick={fetchRows}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black uppercase tracking-wider text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            Revisar
          </button>
        </div>
      </div>

      <div className="grid min-h-[690px] gap-8 xl:grid-cols-[320px_1fr]">
        <aside className="border-r border-white/10 pr-5">
          <label className="relative mb-4 block">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void fetchRows();
              }}
              placeholder="Buscar concessionária..."
              className="w-full border-b border-white/10 bg-transparent py-3 pl-7 text-sm font-bold text-white outline-none focus:border-cyan-400"
            />
          </label>

          <div className="space-y-1">
            {filteredRows.map((row) => {
              const selectedRow = rowKey(row) === rowKey(selected);
              return (
                <button
                  key={rowKey(row)}
                  type="button"
                  onClick={() => setSelectedKey(rowKey(row))}
                  className={`w-full border-l-2 px-3 py-3 text-left transition ${
                    selectedRow ? 'border-cyan-400 bg-cyan-400/10' : 'border-transparent hover:border-white/30 hover:bg-white/[0.03]'
                  }`}
                >
                  <p className="truncate text-sm font-black text-white">{row.corretor_nome}</p>
                  <p className="mt-1 truncate text-[11px] font-bold text-slate-500">{row.meta_ad_account_name || `act_${row.meta_ad_account_id}`}</p>
                  <div className="mt-2 flex items-center gap-3 text-[11px] font-black text-slate-400">
                    <span>CPL {formatCurrency(row.cpl, row.currency)}</span>
                    <span>{row.leads} leads CRM</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0">
          {error && (
            <div className="mb-5 border-l-2 border-red-400 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex h-[520px] items-center justify-center">
              <Loader2 className="animate-spin text-cyan-400" size={40} />
            </div>
          ) : !selected ? (
            <div className="flex h-[520px] items-center justify-center text-sm font-bold text-slate-500">
              Nenhuma concessionária encontrada.
            </div>
          ) : (
            <div>
              <div className="mb-6 flex flex-col gap-3 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Conta selecionada</p>
                  <h2 className="mt-1 text-3xl font-black text-white">{selected.corretor_nome}</h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">{selected.meta_ad_account_name || `act_${selected.meta_ad_account_id}`}</p>
                </div>
                {updatedAt && (
                  <p className="flex items-center gap-2 text-xs font-bold text-slate-500">
                    <Calendar size={14} /> Atualizado em {new Date(updatedAt).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>

              <div className="mb-8 grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-6">
                <Metric label="Total" value={formatCurrency(selected.spend, selected.currency)} />
                <Metric label="Leads CRM" value={String(selected.leads || 0)} />
                <Metric label="CPL CRM" value={formatCurrency(selected.cpl, selected.currency)} alert={selected.alerta_cpl_alto} />
                <Metric label="CPC" value={formatCurrency(selected.cpc || 0, selected.currency)} />
                <Metric label="CPM" value={formatCurrency(selected.cpm || 0, selected.currency)} />
                <Metric label="CTR" value={formatPercent(selected.ctr)} />
              </div>

              <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <BarChart3 size={18} className="text-cyan-300" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-white">Comparativo da carteira</h3>
                  </div>
                  <div className="space-y-4">
                    {filteredRows.slice(0, 10).map((row) => (
                      <div key={`bar-${rowKey(row)}`} className="grid grid-cols-[150px_1fr_90px] items-center gap-3">
                        <span className="truncate text-xs font-black text-slate-300">{row.corretor_nome}</span>
                        <div className="h-7 border-l border-white/10 bg-white/[0.03]">
                          <div className="h-full bg-cyan-400/70" style={{ width: `${Math.max(4, (Number(row.spend || 0) / maxSpend) * 100)}%` }} />
                        </div>
                        <span className="text-right text-xs font-black text-white">{formatCurrency(row.spend, row.currency)}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <TrendingUp size={18} className="text-emerald-300" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-white">Risco por CPL</h3>
                  </div>
                  <div className="space-y-4">
                    {filteredRows.slice(0, 8).map((row) => (
                      <div key={`cpl-${rowKey(row)}`}>
                        <div className="mb-1 flex justify-between text-xs font-black">
                          <span className="truncate text-slate-400">{row.corretor_nome}</span>
                          <span className={Number(row.cpl || 0) >= 28 ? 'text-red-300' : 'text-slate-300'}>{formatCurrency(row.cpl, row.currency)}</span>
                        </div>
                        <div className="h-2 bg-white/10">
                          <div
                            className={Number(row.cpl || 0) >= 28 ? 'h-full bg-red-400' : 'h-full bg-emerald-400'}
                            style={{ width: `${Math.max(2, Math.min(100, (Number(row.cpl || 0) / maxCpl) * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="mt-8 border-t border-white/10 pt-6">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle size={18} className={selected.alerta_cpl_alto ? 'text-red-300' : 'text-cyan-300'} />
                  <h3 className="text-sm font-black uppercase tracking-widest text-white">Recomendação</h3>
                </div>
                <p className="max-w-4xl text-sm font-bold leading-relaxed text-slate-300">
                  {selected.dados_crm_pendentes
                    ? 'Existe investimento na Meta, mas nenhum lead caiu no CRM. Antes de otimizar campanha, confira se o formulário, webhook e importação estão funcionando.'
                    : selected.alerta_cpl_alto
                      ? 'CPL acima da regra crítica. Revisar criativo, público, página de destino e qualidade dos leads antes de aprovar qualquer pausa.'
                      : 'Conta sem alerta crítico no período. Acompanhe CTR, CPC e volume de leads no CRM para decidir próximos ajustes.'}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </InternalLayout>
  );
}

function rowKey(row: MetaAccountRow | null) {
  if (!row) return '';
  return String(row.meta_ad_account_id || row.corretor_id);
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="border-b border-white/10 pb-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black ${alert ? 'text-red-300' : 'text-white'}`}>{value}</p>
    </div>
  );
}
