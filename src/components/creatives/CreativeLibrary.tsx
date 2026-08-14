'use client';

/* The library renders runtime Supabase URLs and local data URLs from Ctrl+V.
 * Keeping native img avoids broad remote-host allowlists and supports previews before upload. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  Download,
  Folder,
  FolderOpen,
  ImagePlus,
  Loader2,
  MapPin,
  Maximize2,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useCreativeJobs } from '@/components/creatives/CreativeJobsProvider';
import { getDefaultCreativePrompt } from '@/lib/creatives/operatorPrompts';
import OrionCredCard from '@/components/creatives/OrionCredCard';

type LibraryAsset = {
  id: string;
  corretor_id: string;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  status: string;
  operadora: string | null;
  regiao: string | null;
  headline: string | null;
  legenda: string | null;
  created_at: string;
  drive_file_id?: string | null;
  drive_web_view_link?: string | null;
  prompt?: string | null;
};

type ActiveMetaCreative = {
  id: string;
  ad_name?: string | null;
  creative_name?: string | null;
  title?: string | null;
};

type CreativeStrategy = {
  id: string;
  corretor_id: string;
  operadora: string;
  regiao: string;
  creative_prompt?: string | null;
};

type CreativeFolder = {
  id: string;
  key: string;
  name: string;
  corretor_ids: string[];
  drive_folder_id: string;
  drive_web_view_link: string | null;
  drive_files_count: number;
  assets: LibraryAsset[];
  strategies: CreativeStrategy[];
};

type Props = {
  managerName?: string | null;
  gestorId?: string | null;
};

type SavedGeneratedAsset = Pick<LibraryAsset, 'id' | 'titulo' | 'status'>;

type CreativeReference = {
  id: string;
  name: string;
  dataUrl: string;
};

type CreditSnapshot = {
  available: number;
  used: number;
  limit: number;
  usage_percent: number;
  cycle_end: string | null;
  global?: { estimated_image_cost_usd?: number; available_usd?: number };
};

const FORMATS = [
  { value: '1024x1024', label: 'Feed quadrado', detail: '1:1' },
  { value: '1024x1536', label: 'Stories / Reels', detail: 'Vertical' },
  { value: '1536x1024', label: 'Paisagem', detail: 'Horizontal' },
] as const;
const REGIONS = ['SP', 'RJ', 'DF', 'MG', 'PR', 'SC', 'RS', 'BA', 'GO', 'PE', 'CE', 'Outros'];

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function pathKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'geral';
}

function creativeIdentity(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export default function CreativeLibrary({ managerName, gestorId }: Props) {
  const { jobsVersion, refreshJobs } = useCreativeJobs();
  const [folders, setFolders] = useState<CreativeFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missingFolders, setMissingFolders] = useState<string[]>([]);
  const [createdFolders, setCreatedFolders] = useState<string[]>([]);
  const [driveWritePermissionMissing, setDriveWritePermissionMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedFolderKey, setSelectedFolderKey] = useState<string | null>(null);
  const [selectedRegionKey, setSelectedRegionKey] = useState<string | null>(null);
  const [selectedOperatorKey, setSelectedOperatorKey] = useState<string | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<(typeof FORMATS)[number]['value']>('1024x1024');
  const [references, setReferences] = useState<CreativeReference[]>([]);
  const [generatedDataUrl, setGeneratedDataUrl] = useState<string | null>(null);
  const [generatedCreditReference, setGeneratedCreditReference] = useState<string | null>(null);
  const [savedGeneratedAsset, setSavedGeneratedAsset] = useState<SavedGeneratedAsset | null>(null);
  const [generatedAction, setGeneratedAction] = useState<'save' | 'approval' | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [creativeName, setCreativeName] = useState('');
  const [saving, setSaving] = useState(false);
  const [batchOperator, setBatchOperator] = useState('');
  const [batchRegion, setBatchRegion] = useState('');
  const [batchQuantity, setBatchQuantity] = useState(2);
  const [queuing, setQueuing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [sendingApprovalId, setSendingApprovalId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [downloadingAssetId, setDownloadingAssetId] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<LibraryAsset | null>(null);
  const [editingPrompt, setEditingPrompt] = useState('');
  const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);
  const [activeCreatives, setActiveCreatives] = useState<ActiveMetaCreative[]>([]);
  const [approvalFeedback, setApprovalFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [creditSnapshot, setCreditSnapshot] = useState<CreditSnapshot | null>(null);
  const [pendingGeneration, setPendingGeneration] = useState<{ mode: 'single' | 'batch'; quantity: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const fetchLibrary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const params = new URLSearchParams();
      if (gestorId) params.set('gestor_id', gestorId);
      const response = await fetch(`/api/criativos/library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar as pastas.');
      setFolders(payload.folders || []);
      setMissingFolders(payload.missing_folders || []);
      setCreatedFolders(payload.created_folders || []);
      setDriveWritePermissionMissing(Boolean(payload.drive_write_permission_missing));
    } catch (error: unknown) {
      setLoadError(errorMessage(error, 'Erro ao carregar as pastas.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [gestorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchLibrary(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchLibrary]);

  const fetchCredits = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return;
    const params = new URLSearchParams();
    if (gestorId) params.set('gestor_id', gestorId);
    const response = await fetch(`/api/criativos/credits?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.ok) setCreditSnapshot(await response.json());
  }, [gestorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchCredits(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchCredits, jobsVersion]);

  useEffect(() => {
    const sync = () => void fetchLibrary(true);
    const interval = window.setInterval(sync, 30_000);
    window.addEventListener('focus', sync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', sync);
    };
  }, [fetchLibrary]);

  const jobsVersionRef = useRef(jobsVersion);
  useEffect(() => {
    if (jobsVersionRef.current === jobsVersion) return;
    jobsVersionRef.current = jobsVersion;
    void fetchLibrary(true);
  }, [fetchLibrary, jobsVersion]);

  useEffect(() => {
    if (!generatorOpen) return;

    const handlePaste = async (event: ClipboardEvent) => {
      const images = [...(event.clipboardData?.items || [])]
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((item): item is File => Boolean(item));
      if (!images.length) return;
      event.preventDefault();
      await attachReferences(images, 'Imagem colada');
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [generatorOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (expandedUrl) setExpandedUrl(null);
      else if (editingAsset) setEditingAsset(null);
      else if (generatorOpen && !generating && !saving) setGeneratorOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editingAsset, expandedUrl, generatorOpen, generating, saving]);

  const visibleFolders = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return folders;
    return folders.filter((folder) => folder.name.toLocaleLowerCase('pt-BR').includes(normalized));
  }, [folders, search]);

  const selectedFolder = folders.find((folder) => folder.key === selectedFolderKey) || null;

  useEffect(() => {
    if (!selectedFolder) return;
    let cancelled = false;
    const loadActiveCreatives = async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const params = new URLSearchParams({ corretor_id: selectedFolder.id });
        if (gestorId) params.set('gestor_id', gestorId);
        const response = await fetch(`/api/criativos/ativos-meta?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!cancelled) setActiveCreatives(response.ok ? payload.creatives || [] : []);
      } catch {
        if (!cancelled) setActiveCreatives([]);
      }
    };
    void loadActiveCreatives();
    return () => { cancelled = true; };
  }, [gestorId, selectedFolder]);

  const activeCreativeNames = useMemo(() => activeCreatives.flatMap((creative) => (
    [creative.ad_name, creative.creative_name, creative.title]
      .map(creativeIdentity)
      .filter((value) => value.length >= 5)
  )), [activeCreatives]);

  const isAssetActive = useCallback((asset: LibraryAsset) => {
    const candidates = [asset.titulo, asset.drive_file_id]
      .map(creativeIdentity)
      .filter((value) => value.length >= 5);
    return candidates.some((candidate) => activeCreativeNames.some((activeName) => (
      activeName === candidate || activeName.includes(candidate) || candidate.includes(activeName)
    )));
  }, [activeCreativeNames]);
  const folderHierarchy = useMemo(() => {
    if (!selectedFolder) return [];
    const regions = new Map<string, {
      key: string;
      name: string;
      operators: Map<string, { key: string; name: string; assets: LibraryAsset[] }>;
    }>();
    const ensurePath = (regionValue?: string | null, operatorValue?: string | null) => {
      const regionName = String(regionValue || '').trim() || 'Sem região definida';
      const operatorName = String(operatorValue || '').trim() || 'Geral';
      const regionKey = pathKey(regionName);
      const operatorKey = pathKey(operatorName);
      if (!regions.has(regionKey)) {
        regions.set(regionKey, { key: regionKey, name: regionName, operators: new Map() });
      }
      const region = regions.get(regionKey)!;
      if (!region.operators.has(operatorKey)) {
        region.operators.set(operatorKey, { key: operatorKey, name: operatorName, assets: [] });
      }
      return region.operators.get(operatorKey)!;
    };
    (selectedFolder.strategies || []).forEach((strategy) => {
      ensurePath(strategy.regiao, strategy.operadora);
    });
    selectedFolder.assets.forEach((asset) => {
      ensurePath(asset.regiao, asset.operadora).assets.push(asset);
    });
    return [...regions.values()]
      .map((region) => ({
        ...region,
        operators: [...region.operators.values()]
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [selectedFolder]);
  const selectedRegion = folderHierarchy.find((region) => region.key === selectedRegionKey) || null;
  const selectedOperator = selectedRegion?.operators.find((operator) => operator.key === selectedOperatorKey) || null;
  const selectedStrategy = selectedFolder?.strategies.find((strategy) => (
    pathKey(strategy.regiao) === selectedRegionKey
    && pathKey(strategy.operadora) === selectedOperatorKey
  )) || null;
  const generatorStrategy = selectedFolder?.strategies.find((strategy) => (
    pathKey(strategy.regiao) === pathKey(batchRegion)
    && pathKey(strategy.operadora) === pathKey(batchOperator)
  )) || null;
  const similarAssets = useMemo(() => {
    const terms = prompt.toLocaleLowerCase('pt-BR').split(/[^a-z0-9á-ú]+/i).filter((term) => term.length >= 5);
    if (!terms.length || !destinationId) return [];
    const folder = folders.find((item) => item.id === destinationId);
    return (folder?.assets || []).filter((asset) => {
      const source = `${asset.titulo} ${asset.prompt || ''} ${asset.descricao || ''}`.toLocaleLowerCase('pt-BR');
      return terms.filter((term) => source.includes(term)).length >= Math.min(3, terms.length);
    }).slice(0, 3);
  }, [destinationId, folders, prompt]);

  const resetGenerator = () => {
    setPrompt(selectedStrategy?.creative_prompt || getDefaultCreativePrompt(selectedOperator?.name || ''));
    setSize('1024x1024');
    setReferences([]);
    setGeneratedDataUrl(null);
    setGeneratedCreditReference(null);
    setSavedGeneratedAsset(null);
    setGeneratedAction(null);
    setGenerationError(null);
    setDestinationId(selectedFolder?.id || '');
    setCreativeName('');
    setBatchOperator(selectedOperator?.name || '');
    setBatchRegion(selectedRegion?.name || '');
    setBatchQuantity(2);
    setSuccessMessage(null);
  };

  const openGenerator = () => {
    resetGenerator();
    setGeneratorOpen(true);
  };

  async function attachReferences(files: File[], fallbackName = 'Imagem de referencia') {
    if (!files.length) return;
    try {
    const selected = files.slice(0, 2);
      if (selected.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
        throw new Error('Use apenas imagens PNG, JPG ou WebP.');
      }
      if (selected.some((file) => file.size > 10 * 1024 * 1024)) throw new Error('Cada referencia deve ter no maximo 10 MB.');
      const appended = await Promise.all(selected.map(async (file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name || fallbackName,
        dataUrl: await readFileAsDataUrl(file),
      })));
      setReferences((current) => [...current, ...appended].slice(0, 2));
      setSavedGeneratedAsset(null);
      setGenerationError(null);
    } catch (error: unknown) {
      setGenerationError(errorMessage(error, 'Nao foi possivel anexar as imagens.'));
    }
  }

  const generateCreative = async () => {
    if (prompt.trim().length < 12 || !destinationId || !batchOperator.trim() || !batchRegion.trim()) {
      setGenerationError('Escolha a concessionaria, a operadora e a regiao e descreva o criativo antes de gerar.');
      return;
    }

    setGenerating(true);
    setGenerationError(null);
    setSuccessMessage(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const response = await fetch('/api/criativos/generate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          size,
          gestor_id: gestorId,
          corretor_id: destinationId,
          operadora: batchOperator.trim(),
          regiao: batchRegion.trim(),
          confirmed_cost: true,
          reference_data_urls: references.map((reference) => reference.dataUrl),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel gerar o criativo.');
      setGeneratedDataUrl(payload.image_data_url);
      setGeneratedCreditReference(String(payload.credit_reference || '') || null);
      setSavedGeneratedAsset(null);
      setCreativeName(prompt.trim().split(/[.!?\n]/)[0].slice(0, 80) || 'Criativo gerado por IA');
      setDestinationId(selectedFolder?.id || '');
      await fetchCredits();
    } catch (error: unknown) {
      setGenerationError(errorMessage(error, 'Erro ao gerar o criativo.'));
    } finally {
      setGenerating(false);
    }
  };

  const queueCreativeBatch = async () => {
    if (!destinationId || !batchOperator.trim() || !batchRegion.trim()) {
      setGenerationError('Escolha a concessionaria e informe operadora e regiao.');
      return;
    }
    if (prompt.trim().length < 12) {
      setGenerationError('Descreva melhor o lote de criativos antes de gerar.');
      return;
    }
    setQueuing(true);
    setGenerationError(null);
    setSuccessMessage(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const response = await fetch('/api/criativos/jobs', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corretor_id: destinationId,
          gestor_id: gestorId,
          operadora: batchOperator.trim(),
          regiao: batchRegion.trim(),
          quantidade: batchQuantity,
          briefing: prompt.trim(),
          reference_data_urls: references.map((reference) => reference.dataUrl),
          origem: 'criativos',
          confirmed_cost: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel iniciar a geracao.');
      setSuccessMessage(payload.message || 'Lote iniciado. Voce pode fechar esta janela e continuar trabalhando.');
      await refreshJobs();
      await fetchCredits();
      setPrompt('');
      setReferences([]);
    } catch (error: unknown) {
      setGenerationError(errorMessage(error, 'Erro ao colocar os criativos na fila.'));
    } finally {
      setQueuing(false);
    }
  };

  const requestGeneration = (mode: 'single' | 'batch') => {
    const quantity = mode === 'batch' ? batchQuantity : 1;
    if (!destinationId || !batchOperator.trim() || !batchRegion.trim()) {
      setGenerationError('Escolha a concessionaria e informe a operadora e a regiao.');
      return;
    }
    if (prompt.trim().length < 12) {
      setGenerationError('Descreva melhor o criativo antes de gerar.');
      return;
    }
    if (quantity > 2) {
      setGenerationError('O limite e de 2 imagens por lote.');
      return;
    }
    if (creditSnapshot && creditSnapshot.available < quantity) {
      setGenerationError('Saldo Orion Cred insuficiente para este pedido.');
      return;
    }
    setGenerationError(null);
    setPendingGeneration({ mode, quantity });
  };

  const confirmGeneration = async () => {
    const pending = pendingGeneration;
    if (!pending) return;
    setPendingGeneration(null);
    if (pending.mode === 'batch') await queueCreativeBatch();
    else await generateCreative();
  };

  const saveCreative = async (sendToApproval = false): Promise<SavedGeneratedAsset | null> => {
    if (!generatedDataUrl || !destinationId || !creativeName.trim() || !batchOperator.trim() || !batchRegion.trim()) {
      setGenerationError('Escolha a concessionaria e informe regiao, operadora e nome do criativo.');
      return null;
    }

    if (savedGeneratedAsset) {
      if (sendToApproval && savedGeneratedAsset.status !== 'em_aprovacao') {
        const sent = await sendForApproval(savedGeneratedAsset);
        if (!sent) return null;
        const approvedAsset = { ...savedGeneratedAsset, status: 'em_aprovacao' };
        setSavedGeneratedAsset(approvedAsset);
        setSuccessMessage('Criativo salvo na pasta e enviado para aprovacao.');
        return approvedAsset;
      }
      return savedGeneratedAsset;
    }

    setSaving(true);
    setGeneratedAction(sendToApproval ? 'approval' : 'save');
    setGenerationError(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const response = await fetch('/api/criativos/library', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          corretor_id: destinationId,
          gestor_id: gestorId,
          drive_folder_id: folders.find((item) => item.id === destinationId)?.drive_folder_id,
          titulo: creativeName.trim(),
          prompt: prompt.trim(),
          operadora: batchOperator.trim(),
          regiao: batchRegion.trim(),
          image_data_url: generatedDataUrl,
          send_for_approval: sendToApproval,
          credit_reference: generatedCreditReference,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel salvar o criativo.');
      const folder = folders.find((item) => item.id === destinationId);
      const saved = {
        id: String(payload.asset.id),
        titulo: String(payload.asset.titulo || creativeName.trim()),
        status: String(payload.asset.status || (sendToApproval ? 'em_aprovacao' : 'pronto')),
      } as SavedGeneratedAsset;
      setSavedGeneratedAsset(saved);
      setSuccessMessage(sendToApproval
        ? `Criativo salvo na pasta ${folder?.name || 'selecionada'} e enviado para aprovacao.`
        : `Criativo salvo no CRM e na pasta ${folder?.name || 'selecionada'} do Google Drive.`);
      await fetchLibrary();
      return saved;
    } catch (error: unknown) {
      setGenerationError(errorMessage(error, 'Erro ao salvar o criativo.'));
      return null;
    } finally {
      setSaving(false);
      setGeneratedAction(null);
    }
  };

  const sendForApproval = async (asset: Pick<LibraryAsset, 'id' | 'titulo'>): Promise<boolean> => {
    setSendingApprovalId(asset.id);
    setApprovalFeedback(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const response = await fetch('/api/criativos/approval', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ asset_id: asset.id, gestor_id: gestorId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel enviar para aprovacao.');
      setApprovalFeedback({ tone: 'success', message: `"${asset.titulo}" foi enviado para Materiais para aprovação.` });
      await fetchLibrary(true);
      return true;
    } catch (error: unknown) {
      setApprovalFeedback({ tone: 'error', message: errorMessage(error, 'Erro ao enviar para aprovação.') });
      return false;
    } finally {
      setSendingApprovalId(null);
    }
  };

  const deleteCreative = async (asset: LibraryAsset) => {
    const confirmed = window.confirm(
      `Apagar definitivamente o criativo "${asset.titulo}" do CRM, do armazenamento e do Google Drive?`
    );
    if (!confirmed) return;

    setDeletingAssetId(asset.id);
    setApprovalFeedback(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const response = await fetch('/api/criativos/library', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: asset.id,
          corretor_id: asset.corretor_id,
          gestor_id: gestorId,
          drive_file_id: asset.drive_file_id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel apagar o criativo.');
      setApprovalFeedback({ tone: 'success', message: `O criativo "${asset.titulo}" foi apagado.` });
      if (expandedUrl === asset.arquivo_url) setExpandedUrl(null);
      await fetchLibrary(true);
    } catch (error: unknown) {
      setApprovalFeedback({ tone: 'error', message: errorMessage(error, 'Erro ao apagar o criativo.') });
    } finally {
      setDeletingAssetId(null);
    }
  };

  const deleteFolder = async (folder: CreativeFolder) => {
    const confirmed = window.confirm(
      `Mover a pasta "${folder.name}" para a lixeira do Google Drive? Ela tambem deixara de aparecer no CRM.`
    );
    if (!confirmed) return;
    setDeletingFolderId(folder.drive_folder_id);
    setApprovalFeedback(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const response = await fetch('/api/criativos/library', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corretor_id: folder.id,
          gestor_id: gestorId,
          drive_folder_id: folder.drive_folder_id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel excluir a pasta.');
      setFolders((current) => current.filter((item) => item.drive_folder_id !== folder.drive_folder_id));
      if (selectedFolderKey === folder.key) {
        setSelectedFolderKey(null);
        setSelectedRegionKey(null);
        setSelectedOperatorKey(null);
      }
      setApprovalFeedback({
        tone: 'success',
        message: `A pasta "${folder.name}" foi movida para a lixeira do Google Drive e removida do CRM.`,
      });
    } catch (error: unknown) {
      setApprovalFeedback({ tone: 'error', message: errorMessage(error, 'Erro ao excluir a pasta.') });
    } finally {
      setDeletingFolderId(null);
    }
  };

  const editGeneratedCreative = () => {
    setSuccessMessage('Ajuste o briefing e clique em "Gerar outra versao" para aplicar a edicao.');
    promptInputRef.current?.focus();
    promptInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const copyPrompt = async (asset: LibraryAsset, value = asset.prompt) => {
    const storedPrompt = String(value || '').trim();
    if (!storedPrompt) {
      setApprovalFeedback({ tone: 'error', message: `O criativo "${asset.titulo}" nao possui o prompt original registrado.` });
      return;
    }
    try {
      await navigator.clipboard.writeText(storedPrompt);
      setCopiedAssetId(asset.id);
      window.setTimeout(() => setCopiedAssetId((current) => current === asset.id ? null : current), 1800);
    } catch {
      setApprovalFeedback({ tone: 'error', message: 'O navegador nao permitiu copiar o prompt. Selecione o texto no editor e copie manualmente.' });
    }
  };

  const openCreativeEditor = (asset: LibraryAsset) => {
    setEditingAsset(asset);
    setEditingPrompt(String(asset.prompt || ''));
  };

  const remakeCreative = async () => {
    if (!editingAsset || editingPrompt.trim().length < 12) return;
    const sourceAsset = editingAsset;
    const revisedPrompt = editingPrompt.trim();
    const folder = folders.find((item) => item.corretor_ids.includes(editingAsset.corretor_id));
    setPrompt(revisedPrompt);
    setSize('1024x1024');
    setReferences([]);
    setGeneratedDataUrl(null);
    setSavedGeneratedAsset(null);
    setGeneratedAction(null);
    setGenerationError(null);
    setSuccessMessage('Prompt carregado. Revise e clique em "Gerar criativo" para criar uma nova versao. O original sera preservado.');
    setDestinationId(folder?.id || editingAsset.corretor_id);
    setCreativeName(`${editingAsset.titulo} - nova versao`.slice(0, 160));
    setBatchOperator(String(editingAsset.operadora || ''));
    setBatchRegion(String(editingAsset.regiao || ''));
    setBatchQuantity(1);
    setEditingAsset(null);
    setGeneratorOpen(true);
    setSuccessMessage(`Prompt de "${sourceAsset.titulo}" carregado. Confirme o custo para criar a nova versao.`);
    setPendingGeneration({ mode: 'single', quantity: 1 });
  };

  const downloadCreative = async (asset: LibraryAsset) => {
    setDownloadingAssetId(asset.id);
    setApprovalFeedback(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const params = new URLSearchParams({ asset_id: asset.id, corretor_id: asset.corretor_id });
      if (gestorId) params.set('gestor_id', gestorId);
      const response = await fetch(`/api/criativos/download?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Nao foi possivel baixar o criativo.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : `${asset.titulo}.png`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: unknown) {
      setApprovalFeedback({ tone: 'error', message: errorMessage(error, 'Erro ao baixar o criativo.') });
    } finally {
      setDownloadingAssetId(null);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-8 overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.16),transparent_34%),linear-gradient(135deg,#07111f_0%,#0b1728_100%)] p-6 shadow-2xl shadow-slate-950/20 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex items-center gap-2 text-cyan-300">
                <Sparkles size={17} aria-hidden="true" />
                <p className="text-xs font-black uppercase tracking-[0.2em]">Central de criativos</p>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                Pastas das suas concessionarias
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-300 sm:text-base">
                {managerName ? `${managerName}, aqui aparecem somente as concessionarias atribuidas a voce.` : 'Organize e gere novas artes sem sair do CRM.'}
                {' '}Aqui aparecem somente pastas que existem de verdade no Google Drive.
              </p>
            </div>
            <button
              type="button"
              onClick={openGenerator}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-500/20 transition duration-200 hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/40"
            >
              <Sparkles size={18} aria-hidden="true" />
              Gerar criativo
            </button>
          </div>
        </header>

        <div className="mb-8 max-w-md">
          <OrionCredCard
            holderName={managerName || 'Gestor Orion'}
            gestorId={gestorId || undefined}
            balance={creditSnapshot?.available ?? null}
            used={creditSnapshot?.used}
            limit={creditSnapshot?.limit}
            usagePercent={creditSnapshot?.usage_percent || 0}
            cycleEnd={creditSnapshot?.cycle_end || undefined}
          />
        </div>

        {approvalFeedback && (
          <div
            role={approvalFeedback.tone === 'error' ? 'alert' : 'status'}
            className={`mb-6 rounded-2xl border p-4 text-sm font-bold ${
              approvalFeedback.tone === 'error'
                ? 'border-red-400/20 bg-red-500/10 text-red-200'
                : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {approvalFeedback.message}
          </div>
        )}

        {selectedFolder ? (
          <section>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedOperatorKey) {
                      setSelectedOperatorKey(null);
                    } else if (selectedRegionKey) {
                      setSelectedRegionKey(null);
                    } else {
                      setSelectedFolderKey(null);
                    }
                  }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700/40 bg-slate-900/50 text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  aria-label="Voltar um nível"
                >
                  <ArrowLeft size={19} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-xs font-black uppercase tracking-[0.14em] text-cyan-500">
                    {selectedFolder.name}
                    {selectedRegion ? ` / ${selectedRegion.name}` : ''}
                  </p>
                  <h2 className="truncate text-2xl font-black text-slate-100">
                    {selectedOperator?.name || selectedRegion?.name || selectedFolder.name}
                  </h2>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {selectedOperator ? 'Criativos da operadora' : selectedRegion ? 'Escolha uma operadora' : 'Escolha primeiro a região'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openGenerator}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/30"
              >
                <Plus size={18} />
                Novo criativo
              </button>
            </div>

            {!selectedRegion ? (
              folderHierarchy.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center">
                  <MapPin className="mx-auto text-slate-600" size={42} />
                  <h3 className="mt-4 text-lg font-black text-slate-200">Nenhuma região criada ainda</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-slate-500">
                    Gere o primeiro lote informando região e operadora. A estrutura será criada automaticamente.
                  </p>
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {folderHierarchy.map((region) => {
                    const assetsCount = region.operators.reduce((sum, operator) => sum + operator.assets.length, 0);
                    return (
                      <button
                        key={region.key}
                        type="button"
                        onClick={() => {
                          setSelectedRegionKey(region.key);
                          setSelectedOperatorKey(null);
                        }}
                        className="group min-h-48 overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-900/70 text-left shadow-xl shadow-slate-950/10 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-500/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/25"
                      >
                        <div className="relative h-24 bg-gradient-to-br from-cyan-950/60 to-slate-950">
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.24),transparent_52%)]" />
                          <span className="absolute bottom-3 left-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/15 text-cyan-300">
                            <MapPin size={24} />
                          </span>
                        </div>
                        <div className="flex items-end justify-between gap-4 p-5">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-500">Região</p>
                            <h3 className="mt-1 truncate text-lg font-black text-slate-100">{region.name}</h3>
                            <p className="mt-1 text-xs font-bold text-slate-500">
                              {region.operators.length} {region.operators.length === 1 ? 'operadora' : 'operadoras'} · {assetsCount} {assetsCount === 1 ? 'criativo' : 'criativos'}
                            </p>
                          </div>
                          <span className="text-xs font-black text-cyan-400 transition group-hover:translate-x-0.5">Abrir</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : !selectedOperator ? (
              selectedRegion.operators.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center">
                  <Building2 className="mx-auto text-slate-600" size={42} />
                  <h3 className="mt-4 text-lg font-black text-slate-200">Nenhuma operadora nesta região</h3>
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {selectedRegion.operators.map((operator) => {
                    const cover = operator.assets.find((asset) => asset.arquivo_url)?.arquivo_url;
                    return (
                      <button
                        key={operator.key}
                        type="button"
                        onClick={() => setSelectedOperatorKey(operator.key)}
                        className="group min-h-48 overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-900/70 text-left shadow-xl shadow-slate-950/10 transition duration-200 hover:-translate-y-0.5 hover:border-blue-500/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/25"
                      >
                        <div className="relative h-24 overflow-hidden bg-gradient-to-br from-blue-950/70 to-slate-950">
                          {cover ? (
                            <img src={cover} alt="" className="h-full w-full object-cover opacity-35 transition duration-300 group-hover:scale-105 group-hover:opacity-50" loading="lazy" />
                          ) : (
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.24),transparent_52%)]" />
                          )}
                          <span className="absolute bottom-3 left-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-300/20 bg-blue-400/15 text-blue-300 backdrop-blur">
                            <Building2 size={24} />
                          </span>
                        </div>
                        <div className="flex items-end justify-between gap-4 p-5">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-400">Operadora</p>
                            <h3 className="mt-1 truncate text-lg font-black text-slate-100">{operator.name}</h3>
                            <p className="mt-1 text-xs font-bold text-slate-500">
                              {operator.assets.length} {operator.assets.length === 1 ? 'criativo' : 'criativos'}
                            </p>
                          </div>
                          <span className="text-xs font-black text-cyan-400 transition group-hover:translate-x-0.5">Abrir</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : selectedOperator.assets.length === 0 ? (
              <div className="rounded-[28px] border border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center">
                <ImagePlus className="mx-auto text-slate-600" size={42} />
                <h3 className="mt-4 text-lg font-black text-slate-200">Esta operadora ainda está vazia</h3>
                <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-slate-500">
                  Gere o primeiro criativo para {selectedOperator.name} em {selectedRegion.name}.
                </p>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {selectedOperator.assets.map((asset) => (
                  <article key={asset.id} className="group overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-900/70 shadow-xl shadow-slate-950/10 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-500/40">
                    <button
                      type="button"
                      onClick={() => asset.arquivo_url && setExpandedUrl(asset.arquivo_url)}
                      disabled={!asset.arquivo_url}
                      className="relative block aspect-square w-full overflow-hidden bg-slate-950/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-cyan-400 disabled:cursor-default"
                      aria-label={`Ampliar ${asset.titulo}`}
                    >
                      {asset.arquivo_url ? (
                        <img src={asset.arquivo_url} alt={asset.titulo} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]" loading="lazy" />
                      ) : (
                        <ImagePlus className="m-auto text-slate-700" size={36} />
                      )}
                      <span className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950/75 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
                        <Maximize2 size={16} />
                      </span>
                      {isAssetActive(asset) && (
                        <span className="absolute left-3 top-3 inline-flex min-h-9 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-950/90 px-3 text-[11px] font-black uppercase tracking-wide text-emerald-200 shadow-lg shadow-black/20 backdrop-blur">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
                          Em uso na Meta
                        </span>
                      )}
                    </button>
                    <div className="p-5">
                      <h3 className="truncate text-base font-black text-slate-100">{asset.titulo}</h3>
                      {asset.headline && (
                        <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-400">{asset.headline}</p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs font-bold text-slate-500">{formatDate(asset.created_at)}</p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void deleteCreative(asset)}
                            disabled={deletingAssetId === asset.id}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-black text-rose-400 transition hover:bg-rose-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-wait disabled:opacity-50"
                          >
                            {deletingAssetId === asset.id ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                            Apagar
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => openCreativeEditor(asset)}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/35 px-3 text-xs font-black text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                          <Pencil size={15} />
                          Editar criativo
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyPrompt(asset)}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/35 px-3 text-xs font-black text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                          {copiedAssetId === asset.id ? <Check size={15} /> : <Copy size={15} />}
                          {copiedAssetId === asset.id ? 'Prompt copiado' : 'Copiar prompt'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadCreative(asset)}
                          disabled={downloadingAssetId === asset.id || (!asset.arquivo_url && !asset.drive_file_id)}
                          className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] px-3 text-xs font-black text-cyan-300 transition hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {downloadingAssetId === asset.id ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
                          {downloadingAssetId === asset.id ? 'Baixando...' : 'Baixar com o nome do criativo'}
                        </button>
                      </div>
                      {['pronto', 'revisao'].includes(asset.status) ? (
                        <button
                          type="button"
                          onClick={() => void sendForApproval(asset)}
                          disabled={sendingApprovalId === asset.id}
                          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/25 disabled:opacity-50"
                        >
                          {sendingApprovalId === asset.id ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                          {asset.status === 'revisao' ? 'Reenviar para aprovação' : 'Enviar para aprovação'}
                        </button>
                      ) : (
                        <p className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] text-xs font-black text-emerald-300">
                          <Check size={15} />
                          {asset.status === 'em_aprovacao' ? 'Aguardando aprovação' : asset.status === 'aprovado' ? 'Aprovado' : asset.status === 'drive' ? 'Sincronizado do Drive' : 'Enviado'}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section>
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-500">Biblioteca</p>
                <h2 className="mt-1 text-2xl font-black text-slate-100">Escolha uma pasta</h2>
              </div>
              <label className="relative block w-full sm:max-w-sm">
                <span className="sr-only">Buscar concessionaria</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar concessionaria..."
                  className="min-h-12 w-full rounded-2xl border border-slate-700 bg-slate-900/70 py-3 pl-11 pr-4 text-base font-semibold text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                />
              </label>
            </div>

            {loading ? (
              <div className="flex min-h-72 items-center justify-center rounded-[28px] border border-slate-800 bg-slate-900/40">
                <Loader2 className="animate-spin text-cyan-400" size={34} aria-label="Carregando pastas" />
              </div>
            ) : loadError ? (
              <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-sm font-bold text-red-200">
                {loadError}
              </div>
            ) : visibleFolders.length === 0 ? (
              <div className="rounded-[28px] border border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center">
                <Folder className="mx-auto text-slate-600" size={44} />
                <h3 className="mt-4 text-lg font-black text-slate-200">
                  {search ? 'Nenhuma pasta encontrada' : 'Nenhuma concessionaria atribuida'}
                </h3>
                <p className="mx-auto mt-2 max-w-lg text-sm font-semibold text-slate-500">
                  {search ? 'Tente buscar por outro nome.' : 'Nenhuma pasta fisica do Google Drive corresponde as concessionarias atribuidas a este gestor.'}
                </p>
              </div>
            ) : (
              <>
              {createdFolders.length > 0 && !search ? (
                <div className="mb-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm font-bold leading-6 text-cyan-100">
                  {createdFolders.length} pasta(s) foram sincronizadas fisicamente com o Google Drive.
                </div>
              ) : null}
              {driveWritePermissionMissing && !search ? (
                <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm font-bold leading-6 text-amber-100">
                  As pastas existentes foram carregadas. A conexao atual do Google Drive permite visualizar, mas nao criar as pastas que faltam.
                </div>
              ) : null}
              {missingFolders.length > 0 && !search ? (
                <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm font-bold leading-6 text-amber-100">
                  {missingFolders.length} concessionaria(s) atribuida(s) nao possuem pasta no Google Drive e nao foram exibidas.
                </div>
              ) : null}
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleFolders.map((folder) => {
                  const cover = folder.assets.find((asset) => asset.arquivo_url)?.arquivo_url;
                  return (
                    <article
                      key={folder.key}
                      className="group relative min-h-52 overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-900/70 text-left shadow-xl shadow-slate-950/10 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-500/50 hover:shadow-cyan-950/20"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFolderKey(folder.key);
                          setSelectedRegionKey(null);
                          setSelectedOperatorKey(null);
                        }}
                        className="block w-full text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-cyan-400/25"
                      >
                        <div className="relative h-28 overflow-hidden bg-gradient-to-br from-slate-800 to-slate-950">
                          {cover ? (
                            <img src={cover} alt="" className="h-full w-full object-cover opacity-45 transition duration-300 group-hover:scale-105 group-hover:opacity-60" loading="lazy" />
                          ) : (
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.2),transparent_50%)]" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 to-transparent" />
                          <span className="absolute bottom-3 left-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/15 text-cyan-300 backdrop-blur">
                            <FolderOpen size={24} />
                          </span>
                        </div>
                        <div className="flex items-end justify-between gap-4 p-5 pr-16">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-black text-slate-100">{folder.name}</h3>
                            <p className="mt-1 text-xs font-bold text-slate-500">
                              {folder.assets.length} {folder.assets.length === 1 ? 'criativo' : 'criativos'}
                            </p>
                          </div>
                          <span className="text-xs font-black text-cyan-400 transition group-hover:translate-x-0.5">Abrir</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteFolder(folder)}
                        disabled={deletingFolderId === folder.drive_folder_id}
                        className="absolute bottom-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-300 transition hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
                        aria-label={`Excluir pasta ${folder.name}`}
                        title="Mover pasta para a lixeira"
                      >
                        {deletingFolderId === folder.drive_folder_id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                      </button>
                    </article>
                  );
                })}
              </div>
              </>
            )}
          </section>
        )}
      </div>

      {editingAsset && (
        <div className="fixed inset-0 z-[130] overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="creative-editor-title">
          <div className="mx-auto my-8 max-w-3xl overflow-hidden rounded-[28px] border border-slate-700 bg-[#08111f] shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-5 border-b border-slate-800 px-5 py-5 sm:px-7">
              <div>
                <div className="flex items-center gap-2 text-cyan-400">
                  <Pencil size={17} />
                  <p className="text-xs font-black uppercase tracking-[0.2em]">Editar e refazer</p>
                </div>
                <h2 id="creative-editor-title" className="mt-1 text-2xl font-black text-white">{editingAsset.titulo}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-400">O original fica preservado. A edicao gera uma nova versao para revisao.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingAsset(null)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-400 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                aria-label="Fechar editor"
              >
                <X size={19} />
              </button>
            </div>
            <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[220px_1fr]">
              <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/50">
                {editingAsset.arquivo_url ? (
                  <img src={editingAsset.arquivo_url} alt={editingAsset.titulo} className="aspect-square h-full w-full object-contain" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-slate-600"><ImagePlus size={36} /></div>
                )}
              </div>
              <div>
                <label htmlFor="stored-creative-prompt" className="text-sm font-black text-slate-200">Prompt utilizado</label>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Edite as instrucoes abaixo ou copie o texto completo.</p>
                <textarea
                  id="stored-creative-prompt"
                  value={editingPrompt}
                  onChange={(event) => setEditingPrompt(event.target.value)}
                  placeholder="Este criativo antigo nao possui o prompt original registrado. Escreva um novo prompt para refazer a imagem."
                  maxLength={8000}
                  className="mt-3 min-h-52 w-full resize-y rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-base font-semibold leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                />
                <p className="mt-1 text-right text-[11px] font-bold text-slate-600">{editingPrompt.length}/8000</p>
                {!editingAsset.prompt && (
                  <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/[0.07] p-3 text-xs font-bold leading-5 text-amber-200">
                    O prompt original nao foi registrado neste arquivo. Digite um novo prompt para criar outra versao.
                  </p>
                )}
              </div>
            </div>
            <div className="grid gap-3 border-t border-slate-800 p-5 sm:grid-cols-2 sm:px-7">
              <button
                type="button"
                onClick={() => void copyPrompt(editingAsset, editingPrompt)}
                disabled={!editingPrompt.trim()}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-black text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {copiedAssetId === editingAsset.id ? <Check size={17} /> : <Copy size={17} />}
                {copiedAssetId === editingAsset.id ? 'Prompt copiado' : 'Copiar prompt'}
              </button>
              <button
                type="button"
                onClick={() => void remakeCreative()}
                disabled={editingPrompt.trim().length < 12}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Sparkles size={17} />
                Refazer imagem com este prompt
              </button>
            </div>
          </div>
        </div>
      )}

      {generatorOpen && (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="creative-generator-title">
          <div className="mx-auto my-3 max-w-6xl overflow-hidden rounded-[28px] border border-slate-700 bg-[#08111f] shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-5 border-b border-slate-800 px-5 py-5 sm:px-7">
              <div>
                <div className="flex items-center gap-2 text-cyan-400">
                  <Sparkles size={17} />
                  <p className="text-xs font-black uppercase tracking-[0.2em]">Geracao com IA</p>
                </div>
                <h2 id="creative-generator-title" className="mt-1 text-2xl font-black text-white">Criar novo criativo</h2>
                <p className="mt-1 text-sm font-semibold text-slate-400">Primeiro gere a arte. Depois escolha em qual pasta ela sera salva.</p>
              </div>
              <button
                type="button"
                onClick={() => setGeneratorOpen(false)}
                disabled={generating || saving}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-400 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-40"
                aria-label="Fechar gerador"
              >
                <X size={19} />
              </button>
            </div>

            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-6 border-b border-slate-800 p-5 sm:p-7 lg:border-b-0 lg:border-r">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="creative-prompt" className="text-sm font-black text-slate-200">Direção do criativo</label>
                    <button
                      type="button"
                      onClick={() => setPrompt(generatorStrategy?.creative_prompt || getDefaultCreativePrompt(batchOperator))}
                      className="min-h-10 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      Restaurar padrão da operadora
                    </button>
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">A regra salva na Entrada já aparece aqui. Acrescente hospital, estilo, cores ou outra instrução específica. Você também pode anexar uma foto de referência.</p>
                  <textarea
                    ref={promptInputRef}
                    id="creative-prompt"
                    value={prompt}
                    onChange={(event) => { setPrompt(event.target.value); setSavedGeneratedAsset(null); }}
                    placeholder="Ex.: Usar uma foto do Hospital São Luiz de Brasília, fundo azul e composição limpa..."
                    className="mt-3 min-h-40 w-full resize-y rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-base font-semibold leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                    maxLength={8000}
                  />
                  <p className="mt-1 text-right text-[11px] font-bold text-slate-600">{prompt.length}/8000</p>
                </div>

                <fieldset>
                  <legend className="text-sm font-black text-slate-200">Formato</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {FORMATS.map((format) => (
                      <button
                        key={format.value}
                        type="button"
                        onClick={() => setSize(format.value)}
                        className={`min-h-16 rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                          size === format.value
                            ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200'
                            : 'border-slate-700 bg-slate-950/40 text-slate-400 hover:border-slate-500'
                        }`}
                        aria-pressed={size === format.value}
                      >
                        <span className="block text-xs font-black">{format.label}</span>
                        <span className="mt-1 block text-[11px] font-bold opacity-70">{format.detail}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-200">Imagens de referencia <span className="font-semibold text-slate-600">(opcional)</span></p>
                    <span className="text-xs font-bold tabular-nums text-slate-500">{references.length}/2</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={references.length >= 2}
                    className="mt-3 flex min-h-24 w-full items-center gap-4 rounded-2xl border border-dashed border-slate-600 bg-slate-950/35 p-4 text-left transition hover:border-cyan-500/70 hover:bg-cyan-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-800 text-cyan-400">
                      <Paperclip size={21} />
                    </span>
                    <span>
                      <span className="block text-sm font-black text-slate-200">
                        {references.length ? 'Adicionar mais referencias' : 'Cole com Ctrl+V ou escolha imagens'}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-slate-500">Selecione varias de uma vez. PNG, JPG ou WebP, ate 10 MB cada.</span>
                    </span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      void attachReferences(Array.from(event.target.files || []));
                      event.target.value = '';
                    }}
                  />
                  {references.length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Referencias anexadas">
                      {references.map((reference, index) => (
                        <div key={reference.id} className="group relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/60">
                          <img src={reference.dataUrl} alt={`Referencia ${index + 1}: ${reference.name}`} className="aspect-square w-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/85 to-transparent px-3 pb-2 pt-8">
                            <p className="truncate text-[11px] font-black text-slate-200">{index + 1}. {reference.name}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))}
                            className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-300/25 bg-slate-950/85 text-red-300 transition hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                            aria-label={`Remover referencia ${reference.name}`}
                            title="Remover referencia"
                          >
                            <X size={17} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/[0.04] p-5">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <FolderOpen size={17} />
                    <p className="text-xs font-black uppercase tracking-[0.18em]">Gerar lote em segundo plano</p>
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                    A IA cria imagem, headline e legenda em ângulos diferentes. Nada é publicado sem sua aprovação.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-black text-slate-300">Concessionária</span>
                      <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold text-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10">
                        <option value="">Selecione...</option>
                        {folders.map((folder) => <option key={folder.key} value={folder.id}>{folder.name}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-black text-slate-300">Operadora</span>
                      <input value={batchOperator} onChange={(event) => { setBatchOperator(event.target.value); setSavedGeneratedAsset(null); }} placeholder="Ex.: Amil" className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold text-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-black text-slate-300">Região</span>
                      <input value={batchRegion} onChange={(event) => { setBatchRegion(event.target.value); setSavedGeneratedAsset(null); }} list="creative-regions" placeholder="Ex.: RJ" className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold text-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10" />
                      <datalist id="creative-regions">{REGIONS.map((region) => <option key={region} value={region} />)}</datalist>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-black text-slate-300">Quantidade</span>
                      <input type="number" min={1} max={2} value={batchQuantity} onChange={(event) => setBatchQuantity(Math.min(2, Math.max(1, Number(event.target.value) || 1)))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold text-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10" />
                    </label>
                  </div>
                  <button type="button" onClick={() => requestGeneration('batch')} disabled={queuing || prompt.trim().length < 12 || !destinationId || !batchOperator.trim() || !batchRegion.trim()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45">
                    {queuing ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                    {queuing ? 'Colocando na fila...' : `Gerar ${batchQuantity} em segundo plano`}
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs font-black uppercase tracking-widest text-slate-600">
                  <span className="h-px flex-1 bg-slate-800" /> ou gerar uma imagem final <span className="h-px flex-1 bg-slate-800" />
                </div>
                <button
                  type="button"
                  onClick={() => requestGeneration('single')}
                  disabled={generating || saving || prompt.trim().length < 12 || !destinationId || !batchOperator.trim() || !batchRegion.trim()}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {generating ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                  {generating ? 'Criando a arte...' : generatedDataUrl ? 'Gerar outra versao' : 'Gerar criativo'}
                </button>
                {generating && (
                  <p className="text-center text-xs font-semibold leading-5 text-slate-500">
                    Uma geracao detalhada pode levar ate dois minutos. Mantenha esta janela aberta.
                  </p>
                )}
              </div>

              <div className="p-5 sm:p-7">
                <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl border border-slate-700 bg-[linear-gradient(45deg,#0b1524_25%,transparent_25%),linear-gradient(-45deg,#0b1524_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#0b1524_75%),linear-gradient(-45deg,transparent_75%,#0b1524_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px]">
                  {generating ? (
                    <div className="px-6 text-center">
                      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-cyan-400/10 text-cyan-400">
                        <Loader2 className="animate-spin" size={30} />
                      </span>
                      <h3 className="mt-5 text-lg font-black text-slate-200">A IA esta montando o criativo</h3>
                      <p className="mt-2 text-sm font-semibold text-slate-500">Composicao, texto e referencia estao sendo processados.</p>
                    </div>
                  ) : generatedDataUrl ? (
                    <img src={generatedDataUrl} alt="Criativo gerado pela IA" className="max-h-[650px] w-full object-contain" />
                  ) : (
                    <div className="px-6 text-center">
                      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-800 text-slate-500">
                        <ImagePlus size={30} />
                      </span>
                      <h3 className="mt-5 text-lg font-black text-slate-300">A imagem final aparecera aqui</h3>
                      <p className="mx-auto mt-2 max-w-sm text-sm font-semibold leading-6 text-slate-600">Escreva o briefing, adicione referencias se quiser e clique em gerar.</p>
                    </div>
                  )}
                </div>

                {generationError && (
                  <div role="alert" className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm font-bold leading-5 text-red-200">
                    {generationError}
                  </div>
                )}

                {successMessage && (
                  <div aria-live="polite" className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-200">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15"><Check size={17} /></span>
                    {successMessage}
                  </div>
                )}

                {generatedDataUrl && (
                  <div className="mt-5 rounded-3xl border border-cyan-400/20 bg-cyan-400/[0.04] p-5">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <FolderOpen size={17} />
                      <p className="text-xs font-black uppercase tracking-[0.18em]">O que deseja fazer?</p>
                    </div>
                    <p className="mt-2 text-xs font-semibold leading-5 text-slate-400">
                      Revise a arte, escolha a pasta correta e decida se quer editar, apenas salvar ou enviar ao corretor para aprovação.
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-black text-slate-300">Pasta da concessionaria</span>
                        <select
                          value={destinationId}
                          onChange={(event) => { setDestinationId(event.target.value); setSavedGeneratedAsset(null); }}
                          className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold text-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                        >
                          <option value="">Selecione...</option>
                          {folders.map((folder) => <option key={folder.key} value={folder.id}>{folder.name}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-black text-slate-300">Nome do criativo</span>
                        <input
                          value={creativeName}
                          onChange={(event) => { setCreativeName(event.target.value); setSavedGeneratedAsset(null); }}
                          maxLength={160}
                          className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base font-bold text-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                        />
                      </label>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={editGeneratedCreative}
                        disabled={saving}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-black text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/20 disabled:opacity-45"
                      >
                        <Pencil size={17} />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveCreative(false)}
                        disabled={saving || !destinationId || !creativeName.trim() || !batchOperator.trim() || !batchRegion.trim()}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-blue-400/40 bg-blue-500/10 px-4 py-3 text-sm font-black text-blue-200 transition hover:bg-blue-500/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/20 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {saving && generatedAction === 'save' ? <Loader2 className="animate-spin" size={17} /> : <Upload size={17} />}
                        {savedGeneratedAsset ? 'Salvo na pasta' : 'Salvar na pasta'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveCreative(true)}
                        disabled={saving || Boolean(savedGeneratedAsset && sendingApprovalId === savedGeneratedAsset.id) || !destinationId || !creativeName.trim() || !batchOperator.trim() || !batchRegion.trim() || savedGeneratedAsset?.status === 'em_aprovacao'}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-emerald-950 shadow-lg shadow-emerald-500/15 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {(saving && generatedAction === 'approval') || (savedGeneratedAsset && sendingApprovalId === savedGeneratedAsset.id) ? <Loader2 className="animate-spin" size={17} /> : savedGeneratedAsset?.status === 'em_aprovacao' ? <Check size={17} /> : <Send size={17} />}
                        {savedGeneratedAsset?.status === 'em_aprovacao' ? 'Enviado para aprovação' : 'Enviar para aprovação'}
                      </button>
                    </div>
                    <p className="mt-3 text-center text-[11px] font-semibold text-slate-500">
                      Enviar para aprovação também salva automaticamente no CRM e em Região / Operadora no Google Drive.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingGeneration && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-generation-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-cyan-400/25 bg-[#081321] shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-400">Confirmacao obrigatoria</p>
                <h2 id="confirm-generation-title" className="mt-2 text-2xl font-black text-white">Confirmar criacao final</h2>
                <p className="mt-2 text-sm font-semibold text-slate-400">Nao existe etapa de rascunho. A geracao abaixo consome Orion Cred.</p>
              </div>
              <button type="button" onClick={() => setPendingGeneration(null)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:text-white" aria-label="Cancelar"><X size={19} /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-[11px] font-black uppercase text-slate-500">Imagens</p><p className="mt-1 text-xl font-black text-white">{pendingGeneration.quantity}</p></div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-[11px] font-black uppercase text-slate-500">Orion Cred</p><p className="mt-1 text-xl font-black text-cyan-300">-{pendingGeneration.quantity}</p></div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-[11px] font-black uppercase text-slate-500">Custo estimado</p><p className="mt-1 text-xl font-black text-emerald-300">US$ {((creditSnapshot?.global?.estimated_image_cost_usd || 0.053) * pendingGeneration.quantity).toFixed(3)}</p></div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Prompt final</p>
                <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-200">{prompt.trim()}</p>
              </div>
              <p className="text-xs font-bold text-slate-400">Destino: {folders.find((item) => item.id === destinationId)?.name || 'Concessionaria'} / {batchRegion} / {batchOperator}. Referencias: {references.length}/2.</p>
              {similarAssets.length > 0 && (
                <div className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.07] p-4">
                  <p className="text-sm font-black text-amber-200">Ja existem criativos parecidos. Reutilizar pode economizar saldo.</p>
                  <p className="mt-1 text-xs font-semibold text-amber-100/70">{similarAssets.map((asset) => asset.titulo).join(' | ')}</p>
                </div>
              )}
            </div>
            <div className="grid gap-3 border-t border-slate-800 p-6 sm:grid-cols-2">
              <button type="button" onClick={() => setPendingGeneration(null)} className="min-h-12 rounded-2xl border border-slate-700 px-5 text-sm font-black text-slate-300 hover:border-slate-500">Cancelar</button>
              <button type="button" onClick={() => void confirmGeneration()} className="min-h-12 rounded-2xl bg-cyan-400 px-5 text-sm font-black text-slate-950 hover:bg-cyan-300">Confirmar pedido</button>
            </div>
          </div>
        </div>
      )}

      {expandedUrl && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/95 p-4" role="dialog" aria-modal="true" aria-label="Criativo ampliado" onClick={() => setExpandedUrl(null)}>
          <button
            type="button"
            onClick={() => setExpandedUrl(null)}
            className="absolute right-5 top-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/30 text-white backdrop-blur transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Fechar imagem ampliada"
          >
            <X size={20} />
          </button>
          <img src={expandedUrl} alt="Criativo em tamanho ampliado" className="max-h-[90vh] max-w-[94vw] object-contain shadow-2xl" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}
