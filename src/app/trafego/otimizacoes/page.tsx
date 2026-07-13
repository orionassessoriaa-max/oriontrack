'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import MetaDatePicker from '@/components/ui/MetaDatePicker';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { BarChart3, CheckCircle2, ChevronDown, ChevronRight, FileText, Loader2, Maximize2, RefreshCw, Search, Sparkles, Wand2, X } from 'lucide-react';

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

type MetaStatus = {
  status?: string;
  effective_status?: string;
};

type CreativePreview = {
  id?: string | null;
  name?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  title?: string | null;
  body?: string | null;
};

type AdNode = MetaStatus & { id: string; name: string; level: 'ad'; metrics: Metrics; creative?: CreativePreview | null };
type AdsetNode = MetaStatus & { id: string; name: string; level: 'adset'; metrics: Metrics; ads: AdNode[] };
type CampaignNode = MetaStatus & { id: string; name: string; level: 'campaign'; metrics: Metrics; adsets: AdsetNode[] };
type OptimizationDraft = {
  summary?: string;
  publish_status?: string;
  actions?: Record<string, any>[];
  campaign?: Record<string, any>;
  adsets?: Record<string, any>[];
  ads?: Record<string, any>[];
  human_review_checklist?: string[];
  missing_info?: string[];
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

function accountKey(account: AccountOption) {
  return String(account.meta_ad_account_id || account.id || '');
}

function bestCreativeImage(creative?: CreativePreview | null) {
  if (creative?.image_url) return creative.image_url;
  const thumbnail = creative?.thumbnail_url || '';
  return thumbnail
    .replace(/\/p\d+x\d+\//g, '/p1080x1080/')
    .replace(/s\d+x\d+/, 's1080x1080')
    .replace(/\/\d+x\d+\//g, '/1080x1080/');
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
  const [expandedAds, setExpandedAds] = useState<Record<string, boolean>>({});
  const [fullscreenCreative, setFullscreenCreative] = useState<AdNode | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [optimizePrompt, setOptimizePrompt] = useState('');
  const [optimizationDraft, setOptimizationDraft] = useState<OptimizationDraft | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialAccountId, setInitialAccountId] = useState<string | null>(null);

  async function fetchOptimization(accountId?: string | null, analyze = false) {
    if (!profile?.id) return;
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

  async function generateOptimizationDraft() {
    if (!selected?.meta_ad_account_id) return;
    setGeneratingDraft(true);
    setDraftError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setDraftError('Sessao expirada.');
      setGeneratingDraft(false);
      return;
    }

    const response = await fetch('/api/integrations/meta/optimize-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        account_id: selected.meta_ad_account_id,
        prompt: optimizePrompt,
        metrics: total,
        gestor_id: actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego' ? profile.id : undefined,
      }),
    });

    const payload = await response.json();
    setGeneratingDraft(false);

    if (!response.ok) {
      setDraftError(payload.error || 'Erro ao gerar rascunho.');
      return;
    }

    setOptimizationDraft(payload.draft || null);
  }

  useEffect(() => {
    if (!profile?.id) return;
    const params = new URLSearchParams(window.location.search);
    const accountFromUrl = params.get('conta');
    setInitialAccountId(accountFromUrl);
    void fetchOptimization(accountFromUrl);
  }, [profile?.id, actualProfile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    if (initialAccountId === null) return;
    void fetchOptimization(selected?.meta_ad_account_id || initialAccountId);
  }, [dateStart, dateEnd, profile?.id, actualProfile?.id]);

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
                          expandedAds={expandedAds}
                          setExpandedCampaigns={setExpandedCampaigns}
                          setExpandedAdsets={setExpandedAdsets}
                          setExpandedAds={setExpandedAds}
                          onOpenCreative={setFullscreenCreative}
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

              <section className="mt-6 border-t border-white/10 pt-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Wand2 size={17} className="text-cyan-300" />
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-widest text-white">Otimizar</h3>
                      <p className="text-xs font-semibold text-slate-500">Peça campanhas, pausas, trocas de criativo, verba ou ajustes. A IA gera um plano revisável.</p>
                    </div>
                  </div>
                  <span className="w-fit rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-200">Revisão obrigatória</span>
                </div>

                <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
                  <div className="space-y-3">
                    <textarea
                      value={optimizePrompt}
                      onChange={(event) => setOptimizePrompt(event.target.value)}
                      placeholder="Ex: Pause o AD-4 Amil-SP. Ou: crie campanha ABO SulAmerica DF, publico 30 a 58 anos, verba R$ 50/dia, use o criativo AD 2 da pasta SulAmerica DF."
                      className="min-h-32 w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm font-semibold leading-relaxed text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400"
                    />
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Fluxo seguro</p>
                    <div className="mt-3 space-y-3 text-xs font-bold text-slate-400">
                      <p className="flex gap-2"><CheckCircle2 size={15} className="shrink-0 text-emerald-300" /> Entende criar, pausar, trocar criativo, ajustar verba e revisar estrutura.</p>
                      <p className="flex gap-2"><CheckCircle2 size={15} className="shrink-0 text-emerald-300" /> Se citar Drive no prompt, registra pasta e criativo no plano.</p>
                      <p className="flex gap-2"><CheckCircle2 size={15} className="shrink-0 text-emerald-300" /> Ação real só depois de revisão humana.</p>
                    </div>
                    {draftError ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs font-bold text-red-200">{draftError}</p> : null}
                    <button
                      type="button"
                      onClick={generateOptimizationDraft}
                      disabled={generatingDraft || !selected || optimizePrompt.trim().length < 12}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-blue-500 disabled:opacity-50"
                    >
                      {generatingDraft ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
                      Gerar plano de ação
                    </button>
                  </div>
                </div>

                {optimizationDraft ? (
                  <div className="mt-5 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Rascunho gerado</p>
                        <h4 className="mt-1 text-xl font-black text-white">{optimizationDraft.campaign?.name || 'Campanha pausada'}</h4>
                      </div>
                      <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-200">
                        {optimizationDraft.publish_status || 'PAUSED'}
                      </span>
                    </div>
                    {optimizationDraft.summary ? <p className="mb-4 text-sm font-bold leading-relaxed text-slate-300">{optimizationDraft.summary}</p> : null}
                    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                      <DraftBlock title="Ações" data={optimizationDraft.actions} />
                      <DraftBlock title="Campanha" data={optimizationDraft.campaign} />
                      <DraftBlock title="Conjuntos" data={optimizationDraft.adsets} />
                      <DraftBlock title="Anuncios" data={optimizationDraft.ads} />
                    </div>
                    {optimizationDraft.human_review_checklist?.length ? (
                      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Checklist humano</p>
                        <ul className="space-y-2 text-xs font-bold text-slate-300">
                          {optimizationDraft.human_review_checklist.map((item, index) => (
                            <li key={`${item}-${index}`} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-300" /> {item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </>
          )}
        </main>
      </div>
      {bestCreativeImage(fullscreenCreative?.creative) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 p-4 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setFullscreenCreative(null)}
            className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20"
            aria-label="Fechar visualizacao"
          >
            <X size={22} />
          </button>
          <div className="grid max-h-[94vh] w-full max-w-[1500px] gap-4 overflow-auto rounded-2xl border border-white/10 bg-[#08111d] p-4 shadow-2xl lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-[68vh] items-center justify-center rounded-xl bg-black/35 p-3">
              <img
                src={bestCreativeImage(fullscreenCreative!.creative)}
                alt={fullscreenCreative!.creative?.name || fullscreenCreative!.name}
                className="h-auto max-h-[88vh] w-auto max-w-full rounded-lg object-contain"
              />
            </div>
            <div className="min-w-0 p-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Visualizacao do anuncio</p>
              <h3 className="mt-3 text-2xl font-black text-white">{fullscreenCreative!.creative?.title || fullscreenCreative!.creative?.name || fullscreenCreative!.name}</h3>
              {fullscreenCreative!.creative?.body ? (
                <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-300">{fullscreenCreative!.creative.body}</p>
              ) : null}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <StatusBadge status={fullscreenCreative!.effective_status || fullscreenCreative!.status} />
                <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">ID: {fullscreenCreative!.id}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </InternalLayout>
  );
}

function CampaignRows({
  campaign,
  expandedCampaigns,
  expandedAdsets,
  expandedAds,
  setExpandedCampaigns,
  setExpandedAdsets,
  setExpandedAds,
  onOpenCreative,
}: {
  campaign: CampaignNode;
  expandedCampaigns: Record<string, boolean>;
  expandedAdsets: Record<string, boolean>;
  expandedAds: Record<string, boolean>;
  setExpandedCampaigns: (value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => void;
  setExpandedAdsets: (value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => void;
  setExpandedAds: (value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => void;
  onOpenCreative: (ad: AdNode) => void;
}) {
  const campaignOpen = Boolean(expandedCampaigns[campaign.id]);
  return (
    <>
      <MetricRow
        name={campaign.name}
        level="Campanha"
        status={campaign.effective_status || campaign.status}
        metrics={campaign.metrics}
        open={campaignOpen}
        hasChildren={campaign.adsets.length > 0}
        onToggle={() => setExpandedCampaigns((current) => ({ ...current, [campaign.id]: !current[campaign.id] }))}
      />
      {campaignOpen && campaign.adsets.map((adset) => {
        const adsetOpen = Boolean(expandedAdsets[adset.id]);
        return (
          <Fragment key={adset.id}>
            <MetricRow
              name={adset.name}
              level="Conjunto"
              status={adset.effective_status || adset.status}
              metrics={adset.metrics}
              indent="pl-8"
              open={adsetOpen}
              hasChildren={adset.ads.length > 0}
              onToggle={() => setExpandedAdsets((current) => ({ ...current, [adset.id]: !current[adset.id] }))}
            />
            {adsetOpen && adset.ads.map((ad) => {
              const adOpen = Boolean(expandedAds[ad.id]);
              const hasPreview = Boolean(ad.creative?.thumbnail_url || ad.creative?.title || ad.creative?.body || ad.creative?.name);
              return (
                <Fragment key={ad.id}>
                  <MetricRow
                    name={ad.name}
                    level="Anúncio"
                    status={ad.effective_status || ad.status}
                    metrics={ad.metrics}
                    indent="pl-14"
                    open={adOpen}
                    hasChildren={hasPreview}
                    onToggle={() => setExpandedAds((current) => ({ ...current, [ad.id]: !current[ad.id] }))}
                  />
                  {adOpen && hasPreview ? <CreativeRow ad={ad} onOpenCreative={onOpenCreative} /> : null}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

function MetricRow({ name, level, status, metrics, indent = '', open = false, hasChildren = false, onToggle }: {
  name: string;
  level: string;
  status?: string;
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
            <span className="mt-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              {level}
              <StatusBadge status={status} />
            </span>
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

function CreativeRow({ ad, onOpenCreative }: { ad: AdNode; onOpenCreative: (ad: AdNode) => void }) {
  const creative = ad.creative;
  const previewImage = bestCreativeImage(creative);
  return (
    <tr className="bg-black/20">
      <td colSpan={8} className="py-4 pl-20 pr-4">
        <div className="grid gap-4 border-l-2 border-cyan-400/40 pl-4 sm:grid-cols-[140px_1fr]">
          {previewImage ? (
            <div className="relative h-28 w-36 overflow-hidden rounded-lg ring-1 ring-white/10">
              <img src={previewImage} alt={creative?.name || ad.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onOpenCreative(ad)}
                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/65 text-white backdrop-blur transition hover:bg-cyan-500"
                aria-label="Abrir criativo em tela cheia"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          ) : (
            <div className="grid h-28 w-36 place-items-center rounded-lg bg-white/[0.04] text-[10px] font-black uppercase tracking-widest text-slate-500 ring-1 ring-white/10">
              Sem preview
            </div>
          )}
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Visualização do anúncio</p>
              <StatusBadge status={ad.effective_status || ad.status} />
            </div>
            <p className="truncate text-sm font-black text-white">{creative?.title || creative?.name || ad.name}</p>
            {creative?.body ? <p className="mt-2 max-w-3xl text-xs font-semibold leading-relaxed text-slate-400">{creative.body}</p> : null}
            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">ID: {ad.id}</p>
          </div>
        </div>
      </td>
    </tr>
  );
}

function DraftBlock({ title, data }: { title: string; data: any }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileText size={15} className="text-cyan-300" />
        <p className="text-xs font-black uppercase tracking-widest text-white">{title}</p>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] font-semibold leading-relaxed text-slate-300">
        {JSON.stringify(data || {}, null, 2)}
      </pre>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  const labelMap: Record<string, string> = {
    ACTIVE: 'Ativo',
    PAUSED: 'Pausado',
    DELETED: 'Excluído',
    ARCHIVED: 'Arquivado',
    CAMPAIGN_PAUSED: 'Campanha pausada',
    ADSET_PAUSED: 'Conjunto pausado',
    IN_PROCESS: 'Processando',
    WITH_ISSUES: 'Com problema',
    PENDING_REVIEW: 'Em análise',
    DISAPPROVED: 'Reprovado',
    PREAPPROVED: 'Pré-aprovado',
    UNKNOWN: 'Sem status',
  };
  const label = labelMap[normalized] || normalized.replace(/_/g, ' ').toLowerCase();
  const active = normalized === 'ACTIVE';
  const problem = ['WITH_ISSUES', 'DISAPPROVED', 'DELETED'].includes(normalized);
  const paused = normalized.includes('PAUSED') || normalized === 'ARCHIVED';

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
      active
        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
        : problem
          ? 'border-red-400/25 bg-red-400/10 text-red-300'
          : paused
            ? 'border-amber-400/25 bg-amber-400/10 text-amber-300'
            : 'border-slate-400/20 bg-white/[0.04] text-slate-400'
    }`}>
      {label}
    </span>
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
