'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import MetaDatePicker from '@/components/ui/MetaDatePicker';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { BarChart3, ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';

type AccountOption = {
  id: string;
  concessionaria: string;
  responsavel: string;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
};

type Metrics = {
  spend: number;
  leads_crm: number;
  cpl_crm: number | null;
  cpc: number;
  cpm: number;
  ctr: number;
  frequency: number;
  link_clicks: number;
  landing_page_views: number;
  currency: string;
};

type AdNode = { id: string; name: string; level: 'ad'; metrics: Metrics };
type AdsetNode = { id: string; name: string; level: 'adset'; metrics: Metrics; ads: AdNode[] };
type CampaignNode = { id: string; name: string; level: 'campaign'; metrics: Metrics; adsets: AdsetNode[] };

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

function accountKey(account: AccountOption) {
  return String(account.meta_ad_account_id || account.id || '');
}

export default function OtimizacoesPage() {
  const { profile, actualProfile } = useAuth();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selected, setSelected] = useState<AccountOption | null>(null);
  const [total, setTotal] = useState<Metrics | null>(null);
  const [tree, setTree] = useState<CampaignNode[]>([]);
  const [search, setSearch] = useState('');
  const [dateStart, setDateStart] = useState(currentMonthStart());
  const [dateEnd, setDateEnd] = useState(todayLocal());
  const [presetLabel, setPresetLabel] = useState('Este mês');
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});
  const [expandedAdsets, setExpandedAdsets] = useState<Record<string, boolean>>({});
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialAccountId, setInitialAccountId] = useState<string | null>(null);

  async function fetchOptimization(accountId?: string | null, analyze = false) {
    if (analyze) setReviewing(true);
    else setLoading(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError('Sessão expirada.');
      setLoading(false);
      setReviewing(false);
      return;
    }

    const response = await fetch('/api/integrations/meta/optimizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        data_inicio: dateStart,
        data_fim: dateEnd,
        account_id: accountId || selected?.meta_ad_account_id,
        analyze,
        gestor_id: actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego' ? profile.id : undefined,
      }),
    });

    const payload = await response.json();
    setLoading(false);
    setReviewing(false);

    if (!response.ok) {
      setError(payload.error || 'Erro ao carregar otimizações.');
      return;
    }

    setAccounts(payload.accounts || []);
    setSelected(payload.selected || null);
    setTotal(payload.total || null);
    setTree(payload.tree || []);
    setAiRecommendation(payload.ai_recommendation || payload.fallback_recommendation || '');
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accountFromUrl = params.get('conta');
    setInitialAccountId(accountFromUrl);
    void fetchOptimization(accountFromUrl);
  }, []);

  useEffect(() => {
    if (initialAccountId === null) return;
    void fetchOptimization(selected?.meta_ad_account_id || initialAccountId);
  }, [dateStart, dateEnd]);

  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter((account) => `${account.concessionaria} ${account.responsavel} ${account.meta_ad_account_name || ''}`.toLowerCase().includes(term));
  }, [accounts, search]);

  return (
    <InternalLayout>
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Meta Ads + CRM</p>
          <h1 className="text-3xl font-black text-white sm:text-4xl">Otimizações</h1>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-400">
            Campanhas, conjuntos e anúncios com CPL calculado pelos leads que caíram no CRM.
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
            onClick={() => fetchOptimization(selected?.meta_ad_account_id, true)}
            disabled={loading || reviewing || !selected}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black uppercase tracking-wider text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {reviewing ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
            Revisar com IA
          </button>
        </div>
      </div>

      <div className="grid min-h-[700px] gap-6 xl:grid-cols-[310px_1fr]">
        <aside className="border-r border-white/10 pr-4">
          <label className="relative mb-4 block">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar concessionária..."
              className="w-full border-b border-white/10 bg-transparent py-3 pl-7 text-sm font-bold text-white outline-none focus:border-cyan-400"
            />
          </label>

          <div className="max-h-[calc(100vh-250px)] space-y-1 overflow-auto pr-1">
            {filteredAccounts.map((account) => {
              const isSelected = accountKey(account) === accountKey(selected || account);
              return (
                <button
                  key={accountKey(account)}
                  type="button"
                  onClick={() => fetchOptimization(account.meta_ad_account_id)}
                  className={`w-full border-l-2 px-3 py-3 text-left transition ${isSelected ? 'border-cyan-400 bg-cyan-400/10' : 'border-transparent hover:border-white/30 hover:bg-white/[0.03]'}`}
                >
                  <p className="truncate text-sm font-black text-white">{account.concessionaria}</p>
                  <p className="mt-1 truncate text-[11px] font-bold text-slate-500">{account.meta_ad_account_name || `act_${account.meta_ad_account_id}`}</p>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0">
          {error && <div className="mb-4 border-l-2 border-red-400 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</div>}

          {loading ? (
            <div className="flex h-[520px] items-center justify-center">
              <Loader2 className="animate-spin text-cyan-400" size={38} />
            </div>
          ) : !selected || !total ? (
            <div className="flex h-[520px] items-center justify-center text-sm font-bold text-slate-500">Nenhuma concessionária selecionada.</div>
          ) : (
            <>
              <div className="mb-5 border-b border-white/10 pb-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Concessionária</p>
                <h2 className="mt-1 text-3xl font-black text-white">{selected.concessionaria}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">{selected.meta_ad_account_name || `act_${selected.meta_ad_account_id}`}</p>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-x-8 gap-y-4 border-b border-white/10 pb-5 lg:grid-cols-6">
                <Metric label="Total" value={formatCurrency(total.spend, total.currency)} />
                <Metric label="Leads CRM" value={String(total.leads_crm || 0)} />
                <Metric label="CPL CRM" value={formatCurrency(total.cpl_crm, total.currency)} alert={Number(total.cpl_crm || 0) >= 28} />
                <Metric label="CPC" value={formatCurrency(total.cpc || 0, total.currency)} alert={Number(total.cpc || 0) > 6} />
                <Metric label="CPM" value={formatCurrency(total.cpm || 0, total.currency)} />
                <Metric label="CTR" value={formatPercent(total.ctr)} alert={Number(total.ctr || 0) < 1} />
              </div>

              <section className="mb-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={17} className="text-cyan-300" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-white">Estrutura da conta</h3>
                  </div>
                  <button onClick={() => fetchOptimization(selected.meta_ad_account_id)} className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-cyan-300">
                    <RefreshCw size={13} /> Atualizar
                  </button>
                </div>

                <div className="overflow-x-auto border-y border-white/10">
                  <table className="w-full min-w-[1080px] border-collapse text-left">
                    <thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="py-3 pr-4">Nome</th>
                        <th className="px-3 py-3 text-right">Total</th>
                        <th className="px-3 py-3 text-right">Leads CRM</th>
                        <th className="px-3 py-3 text-right">CPL CRM</th>
                        <th className="px-3 py-3 text-right">CPC</th>
                        <th className="px-3 py-3 text-right">CPM</th>
                        <th className="px-3 py-3 text-right">CTR</th>
                        <th className="px-3 py-3 text-right">Freq.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tree.map((campaign) => (
                        <CampaignRows
                          key={campaign.id}
                          campaign={campaign}
                          expandedCampaigns={expandedCampaigns}
                          expandedAdsets={expandedAdsets}
                          setExpandedCampaigns={setExpandedCampaigns}
                          setExpandedAdsets={setExpandedAdsets}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="border-t border-white/10 pt-5">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles size={16} className="text-cyan-300" />
                  <h3 className="text-sm font-black uppercase tracking-widest text-white">Recomendação da IA</h3>
                </div>
                <p className="max-w-5xl whitespace-pre-line text-sm font-bold leading-relaxed text-slate-300">
                  {aiRecommendation || 'Clique em Revisar com IA para gerar uma análise real com base nas regras de CPL, CPC, CTR e leads do CRM.'}
                </p>
              </section>
            </>
          )}
        </main>
      </div>
    </InternalLayout>
  );
}

function CampaignRows({
  campaign,
  expandedCampaigns,
  expandedAdsets,
  setExpandedCampaigns,
  setExpandedAdsets,
}: {
  campaign: CampaignNode;
  expandedCampaigns: Record<string, boolean>;
  expandedAdsets: Record<string, boolean>;
  setExpandedCampaigns: (value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => void;
  setExpandedAdsets: (value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => void;
}) {
  const campaignOpen = Boolean(expandedCampaigns[campaign.id]);
  return (
    <>
      <MetricRow
        name={campaign.name}
        level="Campanha"
        metrics={campaign.metrics}
        open={campaignOpen}
        hasChildren={campaign.adsets.length > 0}
        onToggle={() => setExpandedCampaigns((current) => ({ ...current, [campaign.id]: !current[campaign.id] }))}
      />
      {campaignOpen && campaign.adsets.map((adset) => {
        const adsetOpen = Boolean(expandedAdsets[adset.id]);
        return (
          <>
            <MetricRow
              key={adset.id}
              name={adset.name}
              level="Conjunto"
              metrics={adset.metrics}
              indent="pl-8"
              open={adsetOpen}
              hasChildren={adset.ads.length > 0}
              onToggle={() => setExpandedAdsets((current) => ({ ...current, [adset.id]: !current[adset.id] }))}
            />
            {adsetOpen && adset.ads.map((ad) => (
              <MetricRow key={ad.id} name={ad.name} level="Anúncio" metrics={ad.metrics} indent="pl-14" />
            ))}
          </>
        );
      })}
    </>
  );
}

function MetricRow({ name, level, metrics, indent = '', open = false, hasChildren = false, onToggle }: {
  name: string;
  level: string;
  metrics: Metrics;
  indent?: string;
  open?: boolean;
  hasChildren?: boolean;
  onToggle?: () => void;
}) {
  return (
    <tr className="group hover:bg-white/[0.025]">
      <td className={`max-w-[440px] py-3 pr-4 ${indent}`}>
        <button type="button" onClick={onToggle} disabled={!hasChildren} className="flex min-w-0 items-center gap-2 text-left">
          {hasChildren ? (open ? <ChevronDown size={15} className="text-cyan-300" /> : <ChevronRight size={15} className="text-slate-500" />) : <span className="w-[15px]" />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-white">{name}</span>
            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500">{level}</span>
          </span>
        </button>
      </td>
      <DataCell value={formatCurrency(metrics.spend, metrics.currency)} />
      <DataCell value={String(metrics.leads_crm || 0)} />
      <DataCell value={formatCurrency(metrics.cpl_crm, metrics.currency)} alert={Number(metrics.cpl_crm || 0) >= 28} />
      <DataCell value={formatCurrency(metrics.cpc, metrics.currency)} alert={Number(metrics.cpc || 0) > 6} />
      <DataCell value={formatCurrency(metrics.cpm, metrics.currency)} />
      <DataCell value={formatPercent(metrics.ctr)} alert={Number(metrics.ctr || 0) < 1} />
      <DataCell value={Number(metrics.frequency || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} />
    </tr>
  );
}

function DataCell({ value, alert = false }: { value: string; alert?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-3 text-right text-sm font-black ${alert ? 'text-red-300' : 'text-slate-200'}`}>{value}</td>;
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black ${alert ? 'text-red-300' : 'text-white'}`}>{value}</p>
    </div>
  );
}
