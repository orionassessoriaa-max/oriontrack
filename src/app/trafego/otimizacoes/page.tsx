'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import MetaDatePicker from '@/components/ui/MetaDatePicker';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { ArrowLeft, BarChart3, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileImage, FileVideo2, Folder, HardDrive, Loader2, Maximize2, RefreshCw, Search, Sparkles, Wand2, X, AlertCircle, UploadCloud } from 'lucide-react';
import { TRAFFIC_RULES, formatBRL, formatPercent } from '@/lib/trafego/rules';

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

type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  modifiedTime?: string;
  thumbnailLink?: string;
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

type DraftExecutionItem = { level: 'campaign' | 'adset' | 'ad'; id: string; name: string; status: string };
type DraftExecutionResult = {
  created: DraftExecutionItem[];
  skipped: { level: string; name: string; reason: string }[];
  warnings: string[];
};

type ApoloMessage = { role: 'user' | 'assistant'; content: string };

function todayLocal() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function accountKey(account: AccountOption) {
  return String(account.meta_ad_account_id || account.id || '');
}

function selectedOperationalTeam() {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem('orion:selected_team') || window.localStorage.getItem('orion:selected_team');
}

function bestCreativeImage(creative?: CreativePreview | null) {
  if (creative?.image_url) return creative.image_url;
  return String(creative?.thumbnail_url || '')
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
  const [dateStart, setDateStart] = useState(daysAgo(30));
  const [dateEnd, setDateEnd] = useState(todayLocal());
  const [presetLabel, setPresetLabel] = useState('Últimos 30 dias');
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});
  const [expandedAdsets, setExpandedAdsets] = useState<Record<string, boolean>>({});
  const [expandedAds, setExpandedAds] = useState<Record<string, boolean>>({});
  const [fullscreenCreative, setFullscreenCreative] = useState<AdNode | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [optimizePrompt, setOptimizePrompt] = useState('');
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [creativeUrl, setCreativeUrl] = useState<string | null>(null);
  const [driveBrowserOpen, setDriveBrowserOpen] = useState(false);
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null);
  const [driveBreadcrumbs, setDriveBreadcrumbs] = useState<DriveEntry[]>([]);
  const [driveFolders, setDriveFolders] = useState<DriveEntry[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveEntry[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [selectedDriveFile, setSelectedDriveFile] = useState<DriveEntry | null>(null);
  const [draggingCreative, setDraggingCreative] = useState(false);
  const [uploadingCreative, setUploadingCreative] = useState(false);
  const [optimizationDraft, setOptimizationDraft] = useState<OptimizationDraft | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftExecution, setDraftExecution] = useState<DraftExecutionResult | null>(null);
  const [activationBusy, setActivationBusy] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [apoloMessages, setApoloMessages] = useState<ApoloMessage[]>([
    { role: 'assistant', content: 'Sou o Apolo. Posso analisar esta conta, revisar uma recomendacao ou montar um plano de acao. Me diga o que voce quer conferir.' },
  ]);
  const [apoloInput, setApoloInput] = useState('');
  const [apoloBusy, setApoloBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialAccountId, setInitialAccountId] = useState<string | null>(null);
  const optimizationRequestRef = useRef(0);
  const creativeInputRef = useRef<HTMLInputElement | null>(null);

  async function browseDrive(folderId?: string | null, breadcrumbs: DriveEntry[] = []) {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');
      const response = await fetch('/api/integrations/meta/drive-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'browse', folder_id: folderId || null }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel abrir os criativos do Drive.');
      const currentFolder = payload.currentFolder || null;
      setDriveFolderId(currentFolder?.id || folderId || null);
      setDriveBreadcrumbs(breadcrumbs.length ? breadcrumbs : currentFolder ? [currentFolder] : []);
      setDriveFolders(payload.folders || []);
      setDriveFiles(payload.files || []);
    } catch (error: any) {
      setDriveError(error.message || 'Nao foi possivel abrir o Google Drive.');
    } finally {
      setDriveLoading(false);
    }
  }

  function openDriveBrowser() {
    const nextOpen = !driveBrowserOpen;
    setDriveBrowserOpen(nextOpen);
    if (nextOpen && !driveFolderId) void browseDrive(null, []);
  }

  function selectDriveFile(file: DriveEntry) {
    setSelectedDriveFile(file);
    setOptimizePrompt((current) => current.includes(file.name)
      ? current
      : `${current}${current ? '\n' : ''}Use o criativo "${file.name}" selecionado na pasta do Google Drive.`);
    setDriveError(null);
  }

  const gestorIdParam = actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego'
    ? profile.id
    : undefined;

  async function fetchOptimization(accountId?: string | null, analyze = false) {
    if (!profile?.id) return;
    const requestId = ++optimizationRequestRef.current;
    const isCurrentRequest = () => optimizationRequestRef.current === requestId;
    if (analyze) setReviewing(true);
    else setLoading(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      if (!isCurrentRequest()) return;
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
        equipe: selectedOperationalTeam(),
        gestor_id: gestorIdParam,
      }),
    });

    const payload = await response.json();
    if (!isCurrentRequest()) return;
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
      setDraftError('Sessão expirada.');
      setGeneratingDraft(false);
      return;
    }

    let uploadedCreativeUrl = creativeUrl;
    if (creativeFile && !uploadedCreativeUrl) {
      setUploadingCreative(true);
      const formData = new FormData();
      formData.append('file', creativeFile);
      const uploadResponse = await fetch('/api/integrations/meta/optimize-draft/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadPayload = await uploadResponse.json();
      setUploadingCreative(false);
      if (!uploadResponse.ok) {
        setDraftError(uploadPayload.error || 'Nao foi possivel anexar o criativo.');
        setGeneratingDraft(false);
        return;
      }
      uploadedCreativeUrl = uploadPayload.file?.url || null;
      setCreativeUrl(uploadedCreativeUrl);
    }

    const response = await fetch('/api/integrations/meta/optimize-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        account_id: selected.meta_ad_account_id,
        prompt: optimizePrompt,
        metrics: total,
        equipe: selectedOperationalTeam(),
        gestor_id: gestorIdParam,
        drive_file_id: selectedDriveFile?.id || null,
        drive_file_name: selectedDriveFile?.name || null,
        drive_folder_id: selectedDriveFile?.parents?.[0] || driveFolderId || null,
        creative_attachment: uploadedCreativeUrl
          ? { name: creativeFile?.name || 'criativo anexado', type: creativeFile?.type || '', url: uploadedCreativeUrl }
          : null,
      }),
    });

    const payload = await response.json();
    setGeneratingDraft(false);

    if (!response.ok) {
      setDraftError(payload.error || 'Erro ao gerar o plano.');
      return;
    }

    setOptimizationDraft(payload.draft || null);
    setDraftExecution(null);
  }

  async function sendApoloMessage() {
    const text = apoloInput.trim();
    if (!text || !selected?.meta_ad_account_id || apoloBusy) return;
    setApoloBusy(true);
    setDraftError(null);
    const nextMessages = [...apoloMessages, { role: 'user' as const, content: text }];
    setApoloMessages(nextMessages);
    setApoloInput('');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setDraftError('Sessao expirada.');
      setApoloBusy(false);
      return;
    }

    let uploadedCreativeUrl = creativeUrl;
    if (creativeFile && !uploadedCreativeUrl) {
      setUploadingCreative(true);
      const formData = new FormData();
      formData.append('file', creativeFile);
      const uploadResponse = await fetch('/api/integrations/meta/optimize-draft/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadPayload = await uploadResponse.json();
      setUploadingCreative(false);
      if (!uploadResponse.ok) {
        setDraftError(uploadPayload.error || 'Nao foi possivel anexar o print.');
        setApoloBusy(false);
        return;
      }
      uploadedCreativeUrl = uploadPayload.file?.url || null;
      setCreativeUrl(uploadedCreativeUrl);
    }

    const response = await fetch('/api/integrations/meta/apolo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        account: selected,
        metrics: total,
        tree,
        messages: nextMessages,
        drive_file_id: selectedDriveFile?.id || null,
        drive_file_name: selectedDriveFile?.name || null,
        drive_folder_id: selectedDriveFile?.parents?.[0] || driveFolderId || null,
        creative_attachment: uploadedCreativeUrl
          ? { name: creativeFile?.name || 'print anexado', type: creativeFile?.type || '', url: uploadedCreativeUrl }
          : null,
      }),
    });
    const payload = await response.json();
    setApoloBusy(false);
    if (!response.ok) {
      setDraftError(payload.error || 'Nao foi possivel falar com o Apolo.');
      return;
    }
    setApoloMessages((current) => [...current, { role: 'assistant', content: payload.reply }]);
    if (payload.draft) setOptimizationDraft(payload.draft);
  }

  function handleApoloPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/') || item.type.startsWith('video/'));
    if (!file) return;
    event.preventDefault();
    acceptCreative(file);
    setApoloInput((current) => `${current}${current ? '\n' : ''}[Print anexado para analise]`);
  }

  function acceptCreative(file?: File | null) {
    if (!file) return;
    const validType = file.type.startsWith('image/') || file.type === 'video/mp4' || file.type === 'video/quicktime' || file.type === 'video/webm';
    if (!validType) {
      setDraftError('Anexe uma imagem ou video.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setDraftError('O criativo deve ter no maximo 30 MB.');
      return;
    }
    setDraftError(null);
    setCreativeFile(file);
    setCreativeUrl(null);
  }

  async function createOptimizationDraft() {
    if (!selected?.meta_ad_account_id || !optimizationDraft) return;
    setCreatingDraft(true);
    setDraftError(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setDraftError('Sessao expirada.');
      setCreatingDraft(false);
      return;
    }
    const response = await fetch('/api/integrations/meta/execute-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ account_id: selected.meta_ad_account_id, draft: optimizationDraft, confirmar_criacao: true, equipe: selectedOperationalTeam(), gestor_id: gestorIdParam }),
    });
    const payload = await response.json();
    setCreatingDraft(false);
    if (!response.ok) {
      setDraftError(payload.error || 'Nao foi possivel criar a estrutura pausada.');
      return;
    }
    setDraftExecution({ created: payload.created || [], skipped: payload.skipped || [], warnings: payload.warnings || [] });
  }

  async function activateDraftItem(item: DraftExecutionItem) {
    if (!selected?.meta_ad_account_id || item.status === 'ACTIVE') return;
    setActivationBusy(item.id);
    setDraftError(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setDraftError('Sessao expirada.');
      setActivationBusy(null);
      return;
    }
    const response = await fetch('/api/integrations/meta/execute-draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ account_id: selected.meta_ad_account_id, object_id: item.id, level: item.level, confirmar: true, equipe: selectedOperationalTeam(), gestor_id: gestorIdParam }),
    });
    const payload = await response.json();
    setActivationBusy(null);
    if (!response.ok) {
      setDraftError(payload.error || 'Nao foi possivel ativar o item.');
      return;
    }
    setDraftExecution((current) => current ? { ...current, created: current.created.map((entry) => entry.id === item.id ? { ...entry, status: 'ACTIVE' } : entry) } : current);
  }

  useEffect(() => {
    if (!profile?.id) return;
    setAccounts([]);
    setSelected(null);
    setTotal(null);
    setTree([]);
    setAiRecommendation('');
    setError(null);
    setApoloMessages([{ role: 'assistant', content: 'Sou o Apolo. Posso analisar esta conta, revisar uma recomendacao ou montar um plano de acao. Me diga o que voce quer conferir.' }]);
    setApoloInput('');
    const params = new URLSearchParams(window.location.search);
    const accountFromUrl = params.get('conta');
    setInitialAccountId(accountFromUrl);
    void fetchOptimization(accountFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, actualProfile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    if (initialAccountId === null) return;
    void fetchOptimization(selected?.meta_ad_account_id || initialAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStart, dateEnd, profile?.id, actualProfile?.id]);

  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter((account) =>
      `${account.concessionaria} ${account.responsavel} ${account.meta_ad_account_name || ''}`.toLowerCase().includes(term)
    );
  }, [accounts, search]);

  return (
    <InternalLayout>
      <div className="orion-trafego" style={{ color: 'var(--tf-ink)' }}>
        <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tf-accent-ink)' }}>
              Meta Ads + CRM
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-[34px]">Otimizações</h1>
            <p className="mt-1.5 max-w-2xl text-sm" style={{ color: 'var(--tf-ink-soft)' }}>
              Campanhas, conjuntos e anúncios com CPL calculado só pelos leads de origem Orion no CRM.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
              className="tf-no-lift inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white transition disabled:opacity-60"
              style={{ background: 'var(--tf-accent)' }}
            >
              {reviewing ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
              Revisar com IA
            </button>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[290px_1fr]">
          <aside
            className="h-fit rounded-2xl border p-3"
            style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
          >
            <label className="relative mb-3 block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--tf-ink-mute)' }} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar concessionária..."
                className="w-full py-2.5 pl-9 pr-3 text-sm"
              />
            </label>

            <div className="max-h-[calc(100vh-260px)] space-y-1 overflow-auto">
              {filteredAccounts.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs" style={{ color: 'var(--tf-ink-mute)' }}>
                  Nenhuma concessionária encontrada.
                </p>
              ) : filteredAccounts.map((account) => {
                const isSelected = selected ? accountKey(account) === accountKey(selected) : false;
                return (
                  <button
                    key={accountKey(account)}
                    type="button"
                    onClick={() => fetchOptimization(account.meta_ad_account_id)}
                    className="tf-no-lift w-full rounded-lg border px-3 py-2.5 text-left transition"
                    style={{
                      background: isSelected ? 'var(--tf-accent-soft)' : 'transparent',
                      borderColor: isSelected ? 'var(--tf-accent-border)' : 'transparent',
                    }}
                  >
                    <span className="block truncate text-sm font-bold">{account.concessionaria}</span>
                    <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--tf-ink-mute)' }}>
                      {account.meta_ad_account_name || `act_${account.meta_ad_account_id}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0">
            {error ? (
              <div
                className="mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-medium"
                style={{ background: 'var(--tf-crit-soft)', borderColor: 'var(--tf-crit-border)', color: 'var(--tf-crit)' }}
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="grid h-[480px] place-items-center">
                <Loader2 className="animate-spin" size={34} style={{ color: 'var(--tf-accent)' }} />
              </div>
            ) : !selected || !total ? (
              <div
                className="grid h-[480px] place-items-center rounded-2xl border text-sm"
                style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', color: 'var(--tf-ink-soft)' }}
              >
                Nenhuma concessionária selecionada.
              </div>
            ) : (
              <>
                <section
                  className="mb-4 rounded-2xl border p-5"
                  style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tf-accent-ink)' }}>
                    Concessionária
                  </p>
                  <h2 className="mt-1 text-2xl font-black">{selected.concessionaria}</h2>
                  <p className="mt-1 text-xs" style={{ color: 'var(--tf-ink-mute)' }}>
                    {selected.meta_ad_account_name || `act_${selected.meta_ad_account_id}`}
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 lg:grid-cols-6" style={{ borderColor: 'var(--tf-border)' }}>
                    <Metric label="Investimento" value={formatBRL(total.spend, total.currency)} />
                    <Metric label="Leads CRM" value={String(total.leads_crm || 0)} />
                    <Metric label="CPL Orion" value={formatBRL(total.cpl_crm, total.currency)} alert={Number(total.cpl_crm || 0) >= TRAFFIC_RULES.cplCritical} />
                    <Metric label="CPC" value={formatBRL(total.cpc || 0, total.currency)} alert={Number(total.cpc || 0) > TRAFFIC_RULES.cpcMax} />
                    <Metric label="CPM" value={formatBRL(total.cpm || 0, total.currency)} />
                    <Metric label="CTR" value={formatPercent(total.ctr)} alert={Number(total.ctr || 0) < TRAFFIC_RULES.ctrMin} />
                  </div>
                </section>

                <section
                  className="mb-4 overflow-hidden rounded-2xl border"
                  style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
                >
                  <div className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 size={16} style={{ color: 'var(--tf-accent-ink)' }} />
                      <h3 className="text-base font-bold">Estrutura da conta</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchOptimization(selected.meta_ad_account_id)}
                      className="tf-no-lift inline-flex items-center gap-1.5 text-xs font-bold"
                      style={{ color: 'var(--tf-accent-ink)' }}
                    >
                      <RefreshCw size={13} /> Atualizar
                    </button>
                  </div>

                  <div className="overflow-x-auto border-t" style={{ borderColor: 'var(--tf-border)' }}>
                    <table className="w-full min-w-[980px] border-collapse text-left">
                      <thead style={{ background: 'var(--tf-surface-2)' }}>
                        <tr className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tf-ink-mute)' }}>
                          <th className="py-3 pl-5 pr-4">Nome</th>
                          <th className="px-3 py-3 text-right">Investimento</th>
                          <th className="px-3 py-3 text-right">Leads CRM</th>
                          <th className="px-3 py-3 text-right">CPL Orion</th>
                          <th className="px-3 py-3 text-right">CPC</th>
                          <th className="px-3 py-3 text-right">CPM</th>
                          <th className="px-3 py-3 text-right">CTR</th>
                          <th className="px-3 py-3 pr-5 text-right">Freq.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tree.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--tf-ink-soft)' }}>
                              Nenhuma campanha com entrega no período.
                            </td>
                          </tr>
                        ) : tree.map((campaign) => (
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

                <section
                  className="mb-4 rounded-2xl border p-5"
                  style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles size={16} style={{ color: 'var(--tf-accent-ink)' }} />
                    <h3 className="text-base font-bold">Leitura da IA</h3>
                  </div>
                  <p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: 'var(--tf-ink-soft)' }}>
                    {aiRecommendation || 'Clique em Revisar com IA para gerar a análise desta conta no período selecionado.'}
                  </p>
                </section>

                <section
                  className="rounded-2xl border p-5"
                  style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
                >
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Wand2 size={16} style={{ color: 'var(--tf-accent-ink)' }} />
                      <div>
                        <h3 className="text-base font-bold">Conversa com o Apolo</h3>
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--tf-ink-soft)' }}>
                          Converse com o Apolo, corrija a analise e faca um plano de otimizacao. Nada e publicado sem sua aprovacao.
                        </p>
                      </div>
                    </div>
                    <span
                      className="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: 'var(--tf-warn-soft)', borderColor: 'var(--tf-warn-border)', color: 'var(--tf-warn)' }}
                    >
                      Revisão obrigatória
                    </span>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
                    <div className="space-y-3">
                    <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border p-3" style={{ background: 'var(--tf-surface-2)', borderColor: 'var(--tf-border)' }}>
                      {apoloMessages.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <p className="max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed" style={{ background: message.role === 'user' ? 'var(--tf-accent)' : 'var(--tf-surface)', color: message.role === 'user' ? '#fff' : 'var(--tf-ink-soft)', border: `1px solid ${message.role === 'user' ? 'transparent' : 'var(--tf-border)'}` }}>
                            {message.content}
                          </p>
                        </div>
                      ))}
                      {apoloBusy ? <Loader2 className="animate-spin" size={15} style={{ color: 'var(--tf-accent-ink)' }} /> : null}
                    </div>
                    <textarea
                      value={apoloInput}
                      onChange={(event) => setApoloInput(event.target.value)}
                      onPaste={handleApoloPaste}
                      placeholder="Ex: o CPL desta campanha esta correto? Cole um print com Ctrl+V ou peca ao Apolo para revisar um anuncio."
                      className="min-h-32 w-full resize-y p-4 text-sm leading-relaxed"
                    />
                    <div className="rounded-xl border p-3" style={{ background: 'var(--tf-surface-2)', borderColor: 'var(--tf-border)' }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <HardDrive size={16} style={{ color: 'var(--tf-accent-ink)' }} />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold" style={{ color: 'var(--tf-ink)' }}>Criativos Orion</p>
                            <p className="text-[11px]" style={{ color: 'var(--tf-ink-mute)' }}>DF ou SP → operadora → criativo</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={openDriveBrowser}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition"
                          style={{ borderColor: 'var(--tf-border)', color: 'var(--tf-accent-ink)' }}
                        >
                          <Folder size={14} /> {driveBrowserOpen ? 'Fechar Drive' : 'Explorar Drive'}
                        </button>
                      </div>

                      {driveBrowserOpen ? (
                        <div className="mt-3 rounded-lg border p-3" style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}>
                          <div className="mb-3 flex items-center gap-1 overflow-x-auto text-[11px]" style={{ color: 'var(--tf-ink-soft)' }}>
                            {driveBreadcrumbs.map((folder, index) => (
                              <Fragment key={folder.id}>
                                {index > 0 ? <ChevronRight size={13} className="shrink-0" /> : null}
                                <button
                                  type="button"
                                  className="shrink-0 font-semibold hover:underline"
                                  onClick={() => void browseDrive(folder.id, driveBreadcrumbs.slice(0, index + 1))}
                                >
                                  {index === 0 ? 'Criativos Orion' : folder.name}
                                </button>
                              </Fragment>
                            ))}
                          </div>

                          {driveLoading ? (
                            <div className="flex items-center gap-2 py-5 text-xs" style={{ color: 'var(--tf-ink-soft)' }}>
                              <Loader2 size={15} className="animate-spin" /> Abrindo pasta...
                            </div>
                          ) : driveError ? (
                            <p className="rounded-lg border p-3 text-xs" style={{ background: 'var(--tf-crit-soft)', borderColor: 'var(--tf-crit-border)', color: 'var(--tf-crit)' }}>{driveError}</p>
                          ) : (
                            <>
                              {driveBreadcrumbs.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => void browseDrive(driveBreadcrumbs[driveBreadcrumbs.length - 2]?.id, driveBreadcrumbs.slice(0, -1))}
                                  className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold"
                                  style={{ color: 'var(--tf-accent-ink)' }}
                                >
                                  <ArrowLeft size={13} /> Voltar
                                </button>
                              ) : null}
                              <div className="grid gap-2 sm:grid-cols-2">
                                {driveFolders.map((folder) => (
                                  <button
                                    key={folder.id}
                                    type="button"
                                    onClick={() => void browseDrive(folder.id, [...driveBreadcrumbs, folder])}
                                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition hover:border-cyan-400"
                                    style={{ borderColor: 'var(--tf-border)', color: 'var(--tf-ink)' }}
                                  >
                                    <Folder size={16} style={{ color: 'var(--tf-accent-ink)' }} />
                                    <span className="truncate text-xs font-semibold">{folder.name}</span>
                                    <ChevronRight size={14} className="ml-auto shrink-0" style={{ color: 'var(--tf-ink-mute)' }} />
                                  </button>
                                ))}
                                {driveFiles.map((file) => (
                                  <div key={file.id} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: selectedDriveFile?.id === file.id ? 'var(--tf-accent)' : 'var(--tf-border)' }}>
                                    {file.mimeType.startsWith('video/') ? <FileVideo2 size={16} style={{ color: 'var(--tf-accent-ink)' }} /> : <FileImage size={16} style={{ color: 'var(--tf-accent-ink)' }} />}
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: 'var(--tf-ink)' }}>{file.name}</span>
                                    {file.webViewLink ? <a href={file.webViewLink} target="_blank" rel="noreferrer" aria-label={`Abrir ${file.name}`} className="shrink-0" style={{ color: 'var(--tf-ink-mute)' }}><ExternalLink size={13} /></a> : null}
                                    <button type="button" onClick={() => selectDriveFile(file)} className="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold" style={{ background: selectedDriveFile?.id === file.id ? 'var(--tf-ok-soft)' : 'var(--tf-accent-soft)', color: 'var(--tf-accent-ink)' }}>
                                      {selectedDriveFile?.id === file.id ? 'Selecionado' : 'Usar'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                              {!driveFolders.length && !driveFiles.length ? <p className="py-4 text-xs" style={{ color: 'var(--tf-ink-mute)' }}>Esta pasta esta vazia.</p> : null}
                            </>
                          )}
                        </div>
                      ) : null}
                      {selectedDriveFile ? <p className="mt-2 truncate text-[11px]" style={{ color: 'var(--tf-ok)' }}>Criativo selecionado: {selectedDriveFile.name}</p> : null}
                    </div>
                    <input
                      ref={creativeInputRef}
                      type="file"
                      accept="image/*,video/mp4,video/quicktime,video/webm"
                      className="hidden"
                      onChange={(event) => acceptCreative(event.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => creativeInputRef.current?.click()}
                      onDragOver={(event) => { event.preventDefault(); setDraggingCreative(true); }}
                      onDragLeave={() => setDraggingCreative(false)}
                      onDrop={(event) => { event.preventDefault(); setDraggingCreative(false); acceptCreative(event.dataTransfer.files?.[0]); }}
                      className="mt-3 flex min-h-20 w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left transition"
                      style={{
                        background: draggingCreative ? 'var(--tf-accent-soft)' : 'var(--tf-surface-2)',
                        borderColor: draggingCreative ? 'var(--tf-accent)' : 'var(--tf-border)',
                        color: 'var(--tf-ink-soft)',
                      }}
                    >
                      {creativeFile?.type.startsWith('video/') ? <FileVideo2 size={20} /> : <UploadCloud size={20} />}
                      <span className="min-w-0 flex-1 text-xs">
                        {creativeFile ? (
                          <>
                            <strong className="block truncate" style={{ color: 'var(--tf-ink)' }}>{creativeFile.name}</strong>
                            <span>{uploadingCreative ? 'Enviando criativo...' : 'Criativo anexado ao pedido.'}</span>
                          </>
                        ) : (
                          <>
                            <strong className="block" style={{ color: 'var(--tf-ink)' }}>Arraste o criativo aqui</strong>
                            <span>ou clique para selecionar uma imagem ou video. Voce tambem pode colar um print com Ctrl+V.</span>
                          </>
                        )}
                      </span>
                      {creativeFile ? (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Remover criativo"
                          onClick={(event) => { event.stopPropagation(); setCreativeFile(null); setCreativeUrl(null); }}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCreativeFile(null); setCreativeUrl(null); } }}
                        >
                          <X size={16} />
                        </span>
                      ) : null}
                    </button>

                    </div>

                    <div className="rounded-xl border p-4" style={{ background: 'var(--tf-surface-2)', borderColor: 'var(--tf-border)' }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tf-ink-mute)' }}>
                        Como funciona
                      </p>
                      <ul className="mt-3 space-y-2 text-xs" style={{ color: 'var(--tf-ink-soft)' }}>
                        <li className="flex gap-2">
                          <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--tf-ok)' }} />
                          Entende criar, pausar, trocar criativo e ajustar verba.
                        </li>
                        <li className="flex gap-2">
                          <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--tf-ok)' }} />
                          Um print anexado entra na analise. O Apolo tambem pode localizar um criativo no Drive quando a integracao estiver configurada.
                        </li>
                        <li className="flex gap-2">
                          <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--tf-ok)' }} />
                          Toda criação sai pausada. Publicar é sempre manual.
                        </li>
                      </ul>

                      {draftError ? (
                        <p
                          className="mt-4 rounded-lg border p-3 text-xs font-medium"
                          style={{ background: 'var(--tf-crit-soft)', borderColor: 'var(--tf-crit-border)', color: 'var(--tf-crit)' }}
                        >
                          {draftError}
                        </p>
                      ) : null}

                      <button
                        type="button"
                        onClick={sendApoloMessage}
                        disabled={apoloBusy || uploadingCreative || !selected || !apoloInput.trim()}
                        className="tf-no-lift mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white transition disabled:opacity-50"
                        style={{ background: 'var(--tf-accent)' }}
                      >
                        {apoloBusy || uploadingCreative ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
                        Enviar para o Apolo
                      </button>
                    </div>
                  </div>

                  {optimizationDraft ? (
                    <DraftView
                      draft={optimizationDraft}
                      onCreate={createOptimizationDraft}
                      creating={creatingDraft}
                      execution={draftExecution}
                      onActivate={activateDraftItem}
                      activationBusy={activationBusy}
                    />
                  ) : null}
                </section>
              </>
            )}
          </main>
        </div>

        {fullscreenCreative && bestCreativeImage(fullscreenCreative.creative) ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4">
            <button
              type="button"
              onClick={() => setFullscreenCreative(null)}
              className="tf-no-lift absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
            <div
              className="grid max-h-[92vh] w-full max-w-[1200px] gap-4 overflow-auto rounded-2xl border p-4 lg:grid-cols-[minmax(0,1fr)_320px]"
              style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}
            >
              <div className="grid min-h-[60vh] place-items-center rounded-xl p-3" style={{ background: 'var(--tf-surface-2)' }}>
                <img
                  src={bestCreativeImage(fullscreenCreative.creative)}
                  alt={fullscreenCreative.creative?.name || fullscreenCreative.name}
                  className="max-h-[82vh] w-auto max-w-full rounded-lg object-contain"
                />
              </div>
              <div className="min-w-0 p-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tf-accent-ink)' }}>
                  Visualização do anúncio
                </p>
                <h3 className="mt-2 text-xl font-black">
                  {fullscreenCreative.creative?.title || fullscreenCreative.creative?.name || fullscreenCreative.name}
                </h3>
                {fullscreenCreative.creative?.body ? (
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--tf-ink-soft)' }}>
                    {fullscreenCreative.creative.body}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <StatusBadge status={fullscreenCreative.effective_status || fullscreenCreative.status} />
                  <span className="text-[11px]" style={{ color: 'var(--tf-ink-mute)' }}>ID: {fullscreenCreative.id}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </InternalLayout>
  );
}

const DRAFT_FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  objective: 'Objetivo',
  status: 'Status',
  buying_type: 'Tipo de compra',
  budget_mode: 'Modo de verba',
  daily_budget: 'Verba diária',
  lifetime_budget: 'Verba total',
  targeting: 'Público',
  optimization_goal: 'Otimização',
  creative_reference: 'Criativo',
  drive_folder: 'Pasta no Drive',
  primary_text: 'Texto principal',
  headline: 'Título',
  type: 'Tipo',
  target: 'Alvo',
  reason: 'Motivo',
  risk: 'Risco',
  instruction: 'Instrução',
  status_after_action: 'Status após a ação',
};

function humanizeKey(key: string) {
  return DRAFT_FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/^./, (letra) => letra.toUpperCase());
}

function renderValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.map((item) => renderValue(item)).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([chave, item]) => `${humanizeKey(chave)}: ${renderValue(item)}`)
      .join(' | ');
  }
  return String(value);
}

function FieldList({ data }: { data: Record<string, any> }) {
  const entries = Object.entries(data || {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (entries.length === 0) return null;

  return (
    <dl className="space-y-2">
      {entries.map(([chave, value]) => (
        <div key={chave} className="grid gap-0.5 sm:grid-cols-[150px_1fr] sm:gap-3">
          <dt className="text-xs font-semibold" style={{ color: 'var(--tf-ink-mute)' }}>{humanizeKey(chave)}</dt>
          <dd className="text-sm" style={{ color: 'var(--tf-ink)' }}>{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function DraftCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}>
      <p className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--tf-ink-mute)' }}>{title}</p>
      {children}
    </div>
  );
}

function DraftView({
  draft,
  onCreate,
  creating,
  execution,
  onActivate,
  activationBusy,
}: {
  draft: OptimizationDraft;
  onCreate: () => void;
  creating: boolean;
  execution: DraftExecutionResult | null;
  onActivate: (item: DraftExecutionItem) => void;
  activationBusy: string | null;
}) {
  const acoes = Array.isArray(draft.actions) ? draft.actions : [];
  const conjuntos = Array.isArray(draft.adsets) ? draft.adsets : [];
  const anuncios = Array.isArray(draft.ads) ? draft.ads : [];
  const checklist = Array.isArray(draft.human_review_checklist) ? draft.human_review_checklist : [];
  const faltando = Array.isArray(draft.missing_info) ? draft.missing_info : [];

  return (
    <div className="mt-5 rounded-xl border p-4" style={{ background: 'var(--tf-accent-soft)', borderColor: 'var(--tf-accent-border)' }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tf-accent-ink)' }}>
            Plano gerado
          </p>
          <h4 className="mt-1 text-lg font-bold">{draft.campaign?.name || 'Plano de otimização'}</h4>
        </div>
        <span
          className="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: 'var(--tf-warn-soft)', borderColor: 'var(--tf-warn-border)', color: 'var(--tf-warn)' }}
        >
          {draft.publish_status === 'REVIEW_REQUIRED' ? 'Aguardando revisão' : draft.publish_status || 'Aguardando revisão'}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}>
        <div>
          <p className="text-sm font-semibold">Executar na Meta</p>
          <p className="text-xs" style={{ color: 'var(--tf-ink-soft)' }}>
            A estrutura será criada como PAUSED. A ativação fica separada e depende da sua confirmação.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating || Boolean(execution?.created.length)}
          className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold text-white transition disabled:opacity-50"
          style={{ background: 'var(--tf-accent)' }}
        >
          {creating ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
          {creating ? 'Criando pausada...' : execution?.created.length ? 'Estrutura criada' : 'Criar pausada na Meta'}
        </button>
      </div>

      {execution ? (
        <div className="mb-4 rounded-xl border p-4" style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}>
          <p className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--tf-accent-ink)' }}>Resultado da criação</p>
          <div className="space-y-2">
            {execution.created.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--tf-border)' }}>
                <div>
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{item.level === 'campaign' ? 'Campanha' : item.level === 'adset' ? 'Conjunto' : 'Criativo/anúncio'} · {item.status === 'ACTIVE' ? 'ATIVO' : 'PAUSADO'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onActivate(item)}
                  disabled={activationBusy === item.id || item.status === 'ACTIVE'}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition disabled:opacity-50"
                  style={{ borderColor: 'var(--tf-ok)', color: 'var(--tf-ok)' }}
                >
                  {activationBusy === item.id ? <Loader2 className="animate-spin" size={13} /> : <CheckCircle2 size={13} />}
                  {item.status === 'ACTIVE' ? 'Ativo' : 'Ativar'}
                </button>
              </div>
            ))}
          </div>
          {execution.skipped.length > 0 ? (
            <div className="mt-3 space-y-1 text-xs" style={{ color: 'var(--tf-warn)' }}>
              {execution.skipped.map((item, index) => <p key={index}>Não criado: {item.name} · {item.reason}</p>)}
            </div>
          ) : null}
          {execution.warnings.map((warning, index) => <p key={index} className="mt-3 text-xs" style={{ color: 'var(--tf-warn)' }}>{warning}</p>)}
        </div>
      ) : null}

      {draft.summary ? (
        <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--tf-ink-soft)' }}>{draft.summary}</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {acoes.length > 0 ? (
          <DraftCard title={`Ações (${acoes.length})`}>
            <div className="space-y-3">
              {acoes.map((acao, index) => (
                <div key={index} className="border-b pb-3 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--tf-border)' }}>
                  <FieldList data={acao} />
                </div>
              ))}
            </div>
          </DraftCard>
        ) : null}

        {draft.campaign && Object.keys(draft.campaign).length > 0 ? (
          <DraftCard title="Campanha">
            <FieldList data={draft.campaign} />
          </DraftCard>
        ) : null}

        {conjuntos.length > 0 ? (
          <DraftCard title={`Conjuntos (${conjuntos.length})`}>
            <div className="space-y-3">
              {conjuntos.map((conjunto, index) => (
                <div key={index} className="border-b pb-3 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--tf-border)' }}>
                  <FieldList data={conjunto} />
                </div>
              ))}
            </div>
          </DraftCard>
        ) : null}

        {anuncios.length > 0 ? (
          <DraftCard title={`Anúncios (${anuncios.length})`}>
            <div className="space-y-3">
              {anuncios.map((anuncio, index) => (
                <div key={index} className="border-b pb-3 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--tf-border)' }}>
                  <FieldList data={anuncio} />
                </div>
              ))}
            </div>
          </DraftCard>
        ) : null}
      </div>

      {faltando.length > 0 ? (
        <div
          className="mt-3 rounded-xl border p-4"
          style={{ background: 'var(--tf-warn-soft)', borderColor: 'var(--tf-warn-border)' }}
        >
          <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--tf-warn)' }}>
            Falta você informar
          </p>
          <ul className="space-y-1.5 text-sm" style={{ color: 'var(--tf-ink-soft)' }}>
            {faltando.map((item, index) => (
              <li key={index} className="flex gap-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--tf-warn)' }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {checklist.length > 0 ? (
        <DraftCard title="Antes de executar, confira">
          <ul className="space-y-1.5 text-sm" style={{ color: 'var(--tf-ink-soft)' }}>
            {checklist.map((item, index) => (
              <li key={index} className="flex gap-2">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--tf-ok)' }} />
                {item}
              </li>
            ))}
          </ul>
        </DraftCard>
      ) : null}
    </div>
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
              indent="pl-10"
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
                    indent="pl-16"
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
    <tr className="border-t" style={{ borderColor: 'var(--tf-border)' }}>
      <td className={`max-w-[420px] py-3 pr-4 ${indent || 'pl-5'}`}>
        <button type="button" onClick={onToggle} disabled={!hasChildren} className="tf-no-lift flex min-w-0 items-center gap-2 text-left disabled:cursor-default">
          {hasChildren ? (
            open
              ? <ChevronDown size={15} style={{ color: 'var(--tf-accent-ink)' }} />
              : <ChevronRight size={15} style={{ color: 'var(--tf-ink-mute)' }} />
          ) : <span className="w-[15px]" />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: 'var(--tf-ink-mute)' }}>
              {level}
              <StatusBadge status={status} />
            </span>
          </span>
        </button>
      </td>
      <DataCell value={formatBRL(metrics.spend, metrics.currency)} />
      <DataCell value={String(metrics.leads_crm || 0)} />
      <DataCell value={formatBRL(metrics.cpl_crm, metrics.currency)} alert={Number(metrics.cpl_crm || 0) >= TRAFFIC_RULES.cplCritical} />
      <DataCell value={formatBRL(metrics.cpc, metrics.currency)} alert={Number(metrics.cpc || 0) > TRAFFIC_RULES.cpcMax} />
      <DataCell value={formatBRL(metrics.cpm, metrics.currency)} />
      <DataCell value={formatPercent(metrics.ctr)} alert={Number(metrics.ctr || 0) < TRAFFIC_RULES.ctrMin} />
      <DataCell value={Number(metrics.frequency || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} last />
    </tr>
  );
}

function CreativeRow({ ad, onOpenCreative }: { ad: AdNode; onOpenCreative: (ad: AdNode) => void }) {
  const creative = ad.creative;
  const previewImage = bestCreativeImage(creative);
  return (
    <tr style={{ background: 'var(--tf-surface-2)' }}>
      <td colSpan={8} className="px-5 py-4">
        <div className="grid gap-4 border-l-2 pl-4 sm:grid-cols-[130px_1fr]" style={{ borderColor: 'var(--tf-accent-border)' }}>
          {previewImage ? (
            <div className="relative h-24 w-32 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--tf-border)' }}>
              <img src={previewImage} alt={creative?.name || ad.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onOpenCreative(ad)}
                className="tf-no-lift absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"
                aria-label="Abrir criativo"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          ) : (
            <div
              className="grid h-24 w-32 place-items-center rounded-lg border text-[11px] font-semibold"
              style={{ borderColor: 'var(--tf-border)', color: 'var(--tf-ink-mute)' }}
            >
              Sem preview
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold">{creative?.title || creative?.name || ad.name}</p>
            {creative?.body ? (
              <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--tf-ink-soft)' }}>{creative.body}</p>
            ) : null}
            <p className="mt-2 text-[11px]" style={{ color: 'var(--tf-ink-mute)' }}>ID: {ad.id}</p>
          </div>
        </div>
      </td>
    </tr>
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

  const cores = active
    ? { fg: 'var(--tf-ok)', bg: 'var(--tf-ok-soft)', border: 'var(--tf-ok-border)' }
    : problem
      ? { fg: 'var(--tf-crit)', bg: 'var(--tf-crit-soft)', border: 'var(--tf-crit-border)' }
      : paused
        ? { fg: 'var(--tf-warn)', bg: 'var(--tf-warn-soft)', border: 'var(--tf-warn-border)' }
        : { fg: 'var(--tf-idle)', bg: 'var(--tf-idle-soft)', border: 'var(--tf-idle-border)' };

  return (
    <span
      className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: cores.bg, borderColor: cores.border, color: cores.fg }}
    >
      {label}
    </span>
  );
}

function DataCell({ value, alert = false, last = false }: { value: string; alert?: boolean; last?: boolean }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums ${last ? 'pr-5' : ''}`}
      style={{ color: alert ? 'var(--tf-crit)' : 'var(--tf-ink)' }}
    >
      {value}
    </td>
  );
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tf-ink-mute)' }}>{label}</p>
      <p className="mt-1 text-lg font-black tabular-nums" style={{ color: alert ? 'var(--tf-crit)' : 'var(--tf-ink)' }}>{value}</p>
    </div>
  );
}
