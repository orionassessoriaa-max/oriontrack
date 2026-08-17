'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import InternalLayout from '@/components/layout/InternalLayout';
import {
  Search,
  Download,
  Loader2,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  Plug,
  X,
  Save,
  Upload,
  RotateCcw,
  Trash2,
  Trophy,
  Users,
  Plus,
  ImageIcon
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadStatus } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { useDialog } from '@/components/providers/DialogProvider';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getLeadStatusStyle, isLeadSale, normalizeLeadStatus } from '@/lib/leadStatus';
import { DEFAULT_KANBAN_STAGES, KanbanStage, getKanbanStageLabel, isSaleEquivalentStage, normalizeKanbanStages } from '@/lib/kanbanStages';
import { cleanLeadObservationText, getLeadImportWarnings } from '@/lib/leadWarnings';
import PhoneAction from '@/components/ui/PhoneAction';
import { resolveLeadOrigin } from '@/lib/leadOrigin';

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isInteractiveTableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,label,[role="button"],[data-row-action]'));
}

function cnpjCategory(value?: string | null) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.includes('nao informado')) return 'nao_informado';
  if (normalized.includes('nao')) return 'sem';
  if (normalized.includes('sim') || normalized.includes('mei') || normalized.includes('cnpj')) return 'com';
  return 'nao_informado';
}

function cnpjLabel(value?: string | null) {
  if (normalizeText(value).includes('mei')) return 'TENHO MEI';
  const category = cnpjCategory(value);
  if (category === 'com') return 'COM CNPJ';
  if (category === 'sem') return 'SEM CNPJ';
  return 'NAO INFORMADO';
}

function cnpjBadgeStyle(value?: string | null) {
  const category = cnpjCategory(value);
  if (category === 'com') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  if (category === 'sem') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
  return 'bg-slate-50 text-slate-500 ring-1 ring-slate-100';
}

function tabLabel(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('{{')) return 'Sem aba';
  const normalized = normalizeText(raw);
  const known = [
    ['bradesco', 'BRADESCO'],
    ['odontoprev', 'ODONTOPREV'],
    ['sao lucas', 'SAO LUCAS'],
    ['sulamerica', 'SULAMERICA'],
    ['sul america', 'SULAMERICA'],
    ['clientes diversos', 'CLIENTES DIVERSOS'],
    ['medsenior', 'MEDSENIOR'],
    ['hapvida', 'HAPVIDA'],
    ['aurora', 'AURORA'],
    ['porto', 'PORTO'],
    ['alice', 'ALICE'],
    ['amil', 'AMIL'],
  ];
  const found = known.find(([key]) => normalized.includes(key));
  if (found) return found[1];
  return raw.length > 34 ? `${raw.slice(0, 31)}...` : raw;
}

const COMMERCIAL_REQUIRED_STATUSES: LeadStatus[] = [
  'Em negociação',
  'Não tive retorno',
  'Venda realizada',
];

const READY_LABELS = ['Amil bronze', 'Amil platinum', 'Porto p470', 'Outra etiqueta'];
const PAGE_SIZE = 1000;

function parseCurrencyInput(value?: string | number | null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(,|$))/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyValue(value?: string | number | null) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseCurrencyInput(value));
}

function requiresCommercialData(status: LeadStatus, stages: KanbanStage[] = []) {
  return COMMERCIAL_REQUIRED_STATUSES.includes(status) || isSaleEquivalentStage(stages, status);
}

function requiresStatusMoveModal(status: LeadStatus, stages: KanbanStage[] = []) {
  return requiresCommercialData(status, stages) || status === 'Sem interesse';
}

type CommercialPayload = {
  valor_negociacao?: number | null;
  operadora_negociacao?: string | null;
  sem_interesse_motivo?: string | null;
  sem_interesse_fez_cotacao?: boolean;
};

type CommercialModalState = {
  lead: Lead;
  status: LeadStatus;
  valor_negociacao: string;
  operadora_negociacao: string;
  sem_interesse_motivo: string;
  sem_interesse_fez_cotacao: boolean;
} | null;

type TeamMember = {
  id: string;
  nome: string;
  email: string;
  profile_id?: string | null;
  tipo_usuario?: string | null;
};

type LeadOriginConfig = {
  id: string;
  nome: string;
  responsavel_membro_id?: string | null;
  responsavel_profile_id?: string | null;
  kanban_etapas?: KanbanStage[];
};

type LeadLabelConfig = {
  id: string;
  nome: string;
};

type ActiveMetaCreative = {
  id: string;
  ad_name: string;
  creative_name?: string | null;
  title?: string | null;
  body?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  status: string;
};

type AdPreviewState = {
  adName: string;
  loading: boolean;
  creative: ActiveMetaCreative | null;
  error: string | null;
} | null;

const EMPTY_MANUAL_LEAD = {
  nome: '',
  telefone: '',
  idades: '',
  possui_cnpj: 'Nao informado',
  cnpj: '',
  tem_plano_ativo: 'Nao informado',
  plano_atual: '',
  investimento: '',
  cidade: '',
  origem: 'Manual',
  origem_config_id: '',
  etiqueta: '',
  responsavel_membro_id: 'unassigned',
};

const IMPORT_ORIGIN_OPTIONS = [
  { value: 'Orion', label: 'Orion / campanha' },
  { value: 'Manual', label: 'Manual' },
  { value: 'Base antiga', label: 'Base antiga' },
  { value: 'Indicacao', label: 'Indicacao' },
  { value: 'Organico', label: 'Organico' },
  { value: 'Outro', label: 'Outro' },
];

function noteValue(lead: Lead, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(lead.observacoes || '').match(new RegExp(`${escaped}:\\s*([^|]+)`, 'i'));
  return match?.[1]?.trim() || '';
}

function leadCampaign(lead: Lead) {
  return lead.utm_campaign || noteValue(lead, 'utm_campaign') || '-';
}

function leadAdset(lead: Lead) {
  return lead.utm_medium || noteValue(lead, 'utm_medium') || '-';
}

function leadAd(lead: Lead) {
  return lead.utm_content || noteValue(lead, 'utm_content') || '-';
}

function leadOrigem(lead: Lead) {
  return resolveLeadOrigin({
    origem: lead.origem,
    utm_source: lead.utm_source,
    utm_medium: lead.utm_medium,
    utm_campaign: lead.utm_campaign,
    utm_term: lead.utm_term,
    utm_content: lead.utm_content,
    operadora: lead.operadora,
    observacoes: lead.observacoes,
  }) || '-';
}

function isConexaoCorretora(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase() === 'CONEXAO CORRETORA';
}

function isFacilitaCorretora(value?: string | null) {
  return normalizeText(value).trim() === 'facilita corretora';
}

export default function BrokerLeadsPage() {
  const { profile, actualProfile, isViewingAsCorretor } = useAuth();
  const { confirmDialog } = useDialog();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [leadPage, setLeadPage] = useState(0);
  const [hasMoreLeads, setHasMoreLeads] = useState(false);
  const [totalLeadsCount, setTotalLeadsCount] = useState<number | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [savingCrm, setSavingCrm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [cnpjFilter, setCnpjFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateFilterType, setDateFilterType] = useState('com_data');
  const [operadoraFilter, setOperadoraFilter] = useState('todas');
  const [origemFilter, setOrigemFilter] = useState('todos');
  const [campaignFilter, setCampaignFilter] = useState('todos');
  const [adsetFilter, setAdsetFilter] = useState('todos');
  const [adFilter, setAdFilter] = useState('todos');
  const [responsavelFilter, setResponsavelFilter] = useState('todos');
  const [defaultResponsavelFilter, setDefaultResponsavelFilter] = useState('todos');
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showManualLeadModal, setShowManualLeadModal] = useState(false);
  const [manualLeadForm, setManualLeadForm] = useState(EMPTY_MANUAL_LEAD);
  const [creatingManualLead, setCreatingManualLead] = useState(false);
  const [manualLeadError, setManualLeadError] = useState<string | null>(null);
  const [crmApiUrl, setCrmApiUrl] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetOrigin, setSheetOrigin] = useState('Manual');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [commercialModal, setCommercialModal] = useState<CommercialModalState>(null);
  const [commercialModalError, setCommercialModalError] = useState<string | null>(null);
  const commercialResolverRef = useRef<((payload: CommercialPayload | null) => void) | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [leadOriginConfigs, setLeadOriginConfigs] = useState<LeadOriginConfig[]>([]);
  const [leadLabelConfigs, setLeadLabelConfigs] = useState<LeadLabelConfig[]>([]);
  const [leadSettingsEnabled, setLeadSettingsEnabled] = useState(false);
  const [showNewOriginForm, setShowNewOriginForm] = useState(false);
  const [showNewLabelForm, setShowNewLabelForm] = useState(false);
  const [newOriginName, setNewOriginName] = useState('');
  const [newOriginResponsible, setNewOriginResponsible] = useState('unassigned');
  const [newLabelName, setNewLabelName] = useState('');
  const [savingLeadSetting, setSavingLeadSetting] = useState(false);
  const [resolvedCorretorId, setResolvedCorretorId] = useState<string | null>(null);
  const [resolvedCorretorIds, setResolvedCorretorIds] = useState<string[]>([]);
  const [rankingEnabled, setRankingEnabled] = useState(false);
  const [kanbanStages, setKanbanStages] = useState<KanbanStage[]>(DEFAULT_KANBAN_STAGES);
  const [adPreview, setAdPreview] = useState<AdPreviewState>(null);
  const activeMetaCreativesRef = useRef<ActiveMetaCreative[] | null>(null);
  const isTeamMemberProfile = profile?.tipo_usuario === 'corretor_membro';
  const usesMyLeadsByDefault = isConexaoCorretora(profile?.nome_empresa);
  const isFacilita = isFacilitaCorretora(profile?.nome_empresa);
  const canAssignTeamLeads = !isTeamMemberProfile && (
    profile?.tipo_usuario === 'admin' ||
    profile?.tipo_usuario === 'corretor' ||
    profile?.tipo_usuario === 'corretor_admin' ||
    actualProfile?.tipo_usuario === 'admin'
  );
  const canManageLeadResponsible = canAssignTeamLeads;
  const leadCreatorRoles = ['corretor', 'corretor_admin', 'corretor_membro', 'corretor_integrante', 'corretor_parceiro'];
  const brokerCorretorId = resolvedCorretorId || profile?.corretor_id || null;
  const brokerCorretorIds = resolvedCorretorIds.length > 0
    ? resolvedCorretorIds
    : brokerCorretorId
      ? [brokerCorretorId]
      : [];
  const canCreateManualLead = Boolean(
    brokerCorretorId &&
    profile?.tipo_usuario &&
    leadCreatorRoles.includes(profile.tipo_usuario)
  );

  function openLeadInCrm(leadId: string) {
    window.location.href = `/crm?lead=${encodeURIComponent(leadId)}`;
  }

  async function openAdPreview(adName: string) {
    if (!adName || adName === '-') return;
    setAdPreview({ adName, loading: true, creative: null, error: null });

    try {
      let creatives = activeMetaCreativesRef.current;
      if (!creatives) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('Sua sessao expirou. Entre novamente para visualizar o criativo.');

        const params = new URLSearchParams();
        if (brokerCorretorId) params.set('corretor_id', brokerCorretorId);
        const response = await fetch(`/api/criativos/ativos-meta${params.size ? `?${params.toString()}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Nao foi possivel consultar os anuncios ativos.');
        if (!payload.account_connected) throw new Error('A conta Meta desta concessionaria ainda nao esta vinculada.');
        creatives = Array.isArray(payload.creatives) ? payload.creatives : [];
        activeMetaCreativesRef.current = creatives;
      }

      const availableCreatives = creatives || [];
      const normalizedAdName = normalizeText(adName).trim();
      const creative = availableCreatives.find((item) => normalizeText(item.ad_name).trim() === normalizedAdName)
        || availableCreatives.find((item) => {
          const candidate = normalizeText(item.ad_name).trim();
          return normalizedAdName.length >= 8 && (candidate.includes(normalizedAdName) || normalizedAdName.includes(candidate));
        })
        || null;

      setAdPreview({
        adName,
        loading: false,
        creative,
        error: creative ? null : 'Este anuncio nao foi encontrado entre os anuncios ativos da conta Meta.',
      });
    } catch (previewError) {
      setAdPreview({
        adName,
        loading: false,
        creative: null,
        error: previewError instanceof Error ? previewError.message : 'Nao foi possivel abrir o criativo.',
      });
    }
  }

  useEffect(() => {
    if (!adPreview) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAdPreview(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [adPreview]);

  useEffect(() => {
    const urlStatus = new URLSearchParams(window.location.search).get('status');
    if (urlStatus) setStatusFilter(urlStatus);
  }, []);

  useEffect(() => {
    // A confirmação definitiva vem das configurações do time. Enquanto elas
    // carregam, administradores nunca devem ficar presos em uma carteira vazia.
    const initialFilter = usesMyLeadsByDefault || isTeamMemberProfile ? 'meus' : 'todos';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDefaultResponsavelFilter(initialFilter);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResponsavelFilter(initialFilter);
  }, [profile?.id, isTeamMemberProfile, usesMyLeadsByDefault]);

  useEffect(() => {
    if (profile?.corretor_id) {
      setResolvedCorretorId(profile.corretor_id);
      setResolvedCorretorIds([profile.corretor_id]);
    }
  }, [profile?.corretor_id]);

  const fetchKanbanStages = async () => {
    if (!brokerCorretorId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    const response = await fetch(`/api/crm/stages?corretor_id=${encodeURIComponent(brokerCorretorId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setKanbanStages(normalizeKanbanStages(payload.stages));
  };

  const fetchLeadSettings = async () => {
    if (!brokerCorretorId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    const response = await fetch(`/api/crm/origins?corretor_id=${encodeURIComponent(brokerCorretorId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Erro ao carregar origens e etiquetas:', payload.error || response.statusText);
      return;
    }
    setLeadSettingsEnabled(payload.enabled === true);
    setLeadOriginConfigs(Array.isArray(payload.origins) ? payload.origins : []);
    setLeadLabelConfigs(Array.isArray(payload.labels) ? payload.labels : []);
  };

  const saveLeadSetting = async (action: 'create_origin' | 'create_label') => {
    if (!brokerCorretorId || savingLeadSetting) return;
    const nome = action === 'create_origin' ? newOriginName.trim() : newLabelName.trim();
    if (!nome) {
      setManualLeadError(action === 'create_origin' ? 'Informe o nome da origem.' : 'Informe o nome da etiqueta.');
      return;
    }

    setSavingLeadSetting(true);
    setManualLeadError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSavingLeadSetting(false);
      setManualLeadError('Sessao expirada. Entre novamente.');
      return;
    }

    const response = await fetch('/api/crm/origins', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        corretor_id: brokerCorretorId,
        nome,
        responsavel_membro_id: action === 'create_origin' ? newOriginResponsible : undefined,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setSavingLeadSetting(false);
    if (!response.ok) {
      setManualLeadError(payload.error || 'Nao foi possivel salvar a configuracao.');
      return;
    }

    if (action === 'create_origin' && payload.origin) {
      setLeadOriginConfigs((current) => [...current, payload.origin].sort((a, b) => a.nome.localeCompare(b.nome)));
      setManualLeadForm((current) => ({
        ...current,
        origem: payload.origin.nome,
        origem_config_id: payload.origin.id,
        responsavel_membro_id: payload.origin.responsavel_membro_id || 'unassigned',
      }));
      setNewOriginName('');
      setNewOriginResponsible('unassigned');
      setShowNewOriginForm(false);
    }
    if (action === 'create_label' && payload.label) {
      setLeadLabelConfigs((current) => [...current, payload.label].sort((a, b) => a.nome.localeCompare(b.nome)));
      setManualLeadForm((current) => ({ ...current, etiqueta: payload.label.nome }));
      setNewLabelName('');
      setShowNewLabelForm(false);
    }
  };

  const selectConfiguredOrigin = (originId: string) => {
    const origin = leadOriginConfigs.find((item) => item.id === originId);
    setManualLeadForm((current) => ({
      ...current,
      origem_config_id: origin?.id || '',
      origem: origin?.nome || '',
      responsavel_membro_id: origin?.responsavel_membro_id || 'unassigned',
    }));
  };

  useEffect(() => {
    if (profile?.id && canAssignTeamLeads) {
      fetchTeamMembers();
    }
  }, [profile?.id, profile?.corretor_id, profile?.nome_empresa, canAssignTeamLeads]);

  useEffect(() => {
    if (brokerCorretorId) {
      fetchLeads(0, false);
      fetchCrmConfig();
      fetchKanbanStages();
      fetchLeadSettings();
    }
  }, [brokerCorretorId, resolvedCorretorIds.join('|'), profile?.nome_empresa]);

  const fetchLeads = async (page = 0, append = false) => {
    if (!brokerCorretorId) {
      setLoading(false);
      return;
    }

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const idsToFetch = brokerCorretorIds.length > 0 ? brokerCorretorIds : [brokerCorretorId];

      let leadsQuery = supabase
        .from('leads')
        .select('*, responsavel_membro:responsavel_membro_id(nome,email)', { count: 'exact' })
        .in('corretor_id', idsToFetch)
        .order('data_entrada', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (profile?.tipo_usuario === 'corretor_membro') {
        leadsQuery = leadsQuery.eq('responsavel_profile_id', profile.id);
      }

      const { data, count, error: supabaseError } = await leadsQuery;

      if (supabaseError) {
        console.error('RLS/DB Error:', supabaseError);
        if (supabaseError.code === '42501' || supabaseError.message?.toLowerCase().includes('row-level security')) {
          setError('Acesso Negado (RLS): voce nao tem permissao para visualizar estes leads.');
        } else {
          setError('Erro ao buscar leads: ' + supabaseError.message);
        }
        return;
      }

      const normalized = (data || []).map((lead) => ({ ...lead, status: normalizeLeadStatus(lead.status) }));
      setLeads((current) => append ? [...current, ...normalized] : normalized);
      setLeadPage(page);
      setTotalLeadsCount(count ?? null);
      const loadedCount = (append ? leads.length : 0) + normalized.length;
      setHasMoreLeads(typeof count === 'number' ? loadedCount < count : normalized.length === PAGE_SIZE);
    } catch (err) {
      console.error('Catch Error:', err);
      setError('Erro inesperado ao carregar leads.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const fetchCrmConfig = async () => {
    if (!brokerCorretorId) return;

    const { data } = await supabase
      .from('corretores')
      .select('crm_api_url, operadoras_info')
      .eq('id', brokerCorretorId)
      .maybeSingle();

    setCrmApiUrl(data?.crm_api_url || '');
  };

  const fetchTeamMembers = async () => {
    if (!profile?.id || !canAssignTeamLeads) {
      setTeamMembers([]);
      const fallbackFilter = usesMyLeadsByDefault || isTeamMemberProfile ? 'meus' : 'todos';
      setDefaultResponsavelFilter(fallbackFilter);
      setResponsavelFilter(fallbackFilter);
      return;
    }

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const query = profile.corretor_id ? `?corretor_id=${encodeURIComponent(profile.corretor_id)}` : '';
    const response = await fetch(`/api/corretor/times${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      const members = payload.membros || [];
      const currentMemberIds = members
        .filter((member: TeamMember) => member.profile_id === profile.id)
        .map((member: TeamMember) => member.id);
      const hasAssignedLead = (payload.leads || []).some((lead: Lead) => (
        lead.responsavel_profile_id === profile.id ||
        currentMemberIds.includes(String(lead.responsavel_membro_id || ''))
      ));
      const nextDefaultFilter = usesMyLeadsByDefault || (
        payload.settings?.current_profile_in_distribution === true && hasAssignedLead
      ) ? 'meus' : 'todos';

      setTeamMembers(members);
      setDefaultResponsavelFilter(nextDefaultFilter);
      setResponsavelFilter(nextDefaultFilter);
      setResolvedCorretorId(payload.primary_corretor_id || profile.corretor_id || null);
      setResolvedCorretorIds(Array.isArray(payload.corretor_ids) && payload.corretor_ids.length > 0
        ? payload.corretor_ids
        : payload.primary_corretor_id
          ? [payload.primary_corretor_id]
          : profile.corretor_id
            ? [profile.corretor_id]
            : []
      );
    } else {
      console.error('Erro ao buscar responsaveis:', payload.error || response.statusText);
      setTeamMembers([]);
      const fallbackFilter = usesMyLeadsByDefault ? 'meus' : 'todos';
      setDefaultResponsavelFilter(fallbackFilter);
      setResponsavelFilter(fallbackFilter);
    }
  };

  const assignLeadToMember = async (leadId: string, memberId: string) => {
    if (!brokerCorretorId) return;

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      alert('Sessao expirada. Entre novamente.');
      return;
    }

    setSavingStatusId(leadId);
    const response = await fetch('/api/corretor/times', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'assign_lead', lead_id: leadId, member_id: memberId || 'unassigned', corretor_id: brokerCorretorId }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(payload.error || 'Erro ao enviar lead.');
      setSavingStatusId(null);
      return;
    }

    const assignedMember = payload.member || null;
    const member = teamMembers.find((item) => item.id === memberId) || assignedMember;
    const nextMemberId = assignedMember?.id || memberId;
    const nextProfileId = assignedMember?.profile_id || member?.profile_id || null;
    setLeads((current) => current.map((lead) => lead.id === leadId ? {
      ...lead,
      responsavel_membro_id: nextMemberId && nextMemberId !== 'unassigned' ? nextMemberId : null,
      responsavel_profile_id: nextMemberId && nextMemberId !== 'unassigned' ? nextProfileId : null,
      responsavel_membro: member ? { nome: member.nome, email: member.email } : null,
    } : lead));
    if (assignedMember && !teamMembers.some((item) => item.id === assignedMember.id)) {
      setTeamMembers((current) => [...current.filter((item) => item.id !== memberId), assignedMember]);
    }
    setSavingStatusId(null);
  };

  const requestCommercialPayload = (lead: Lead, status: LeadStatus): Promise<CommercialPayload | null> => {
    if (!requiresStatusMoveModal(status, kanbanStages)) return Promise.resolve(null);
    if (requiresCommercialData(status, kanbanStages) && parseCurrencyInput(lead.valor_negociacao) > 0) return Promise.resolve(null);

    setCommercialModalError(null);
    setCommercialModal({
      lead,
      status,
      valor_negociacao: lead.valor_negociacao ? String(lead.valor_negociacao) : '',
      operadora_negociacao: lead.operadora_negociacao || '',
      sem_interesse_motivo: lead.sem_interesse_motivo || '',
      sem_interesse_fez_cotacao: Boolean(lead.sem_interesse_fez_cotacao || parseCurrencyInput(lead.valor_negociacao) > 0),
    });

    return new Promise((resolve) => {
      commercialResolverRef.current = resolve;
    });
  };

  const closeCommercialModal = (payload: CommercialPayload | null) => {
    commercialResolverRef.current?.(payload);
    commercialResolverRef.current = null;
    setCommercialModal(null);
    setCommercialModalError(null);
  };

  const submitCommercialModal = (event: React.FormEvent) => {
    event.preventDefault();
    if (!commercialModal) return;

    if (commercialModal.status === 'Sem interesse') {
      const motivo = commercialModal.sem_interesse_motivo.trim();
      const valor = parseCurrencyInput(commercialModal.valor_negociacao);
      if (!motivo) {
        setCommercialModalError('Informe o motivo para marcar o lead como sem interesse.');
        return;
      }
      if (commercialModal.sem_interesse_fez_cotacao && !valor) {
        setCommercialModalError('Informe o valor da cotacao feita antes de encerrar.');
        return;
      }
      closeCommercialModal({
        sem_interesse_motivo: motivo,
        sem_interesse_fez_cotacao: commercialModal.sem_interesse_fez_cotacao,
        valor_negociacao: commercialModal.sem_interesse_fez_cotacao ? valor : null,
      });
      return;
    }

    const payload = {
      valor_negociacao: parseCurrencyInput(commercialModal.valor_negociacao),
    };

    if (!payload.valor_negociacao) {
      setCommercialModalError('Preencha o valor da negociação para avançar.');
      return;
    }

    closeCommercialModal(payload);
  };

  const updateLeadStatus = async (leadId: string, status: LeadStatus) => {
    const currentLead = leads.find((lead) => lead.id === leadId);
    if (!currentLead) return;

    let commercialPayload: CommercialPayload | null = null;
    if (requiresStatusMoveModal(status, kanbanStages)) {
      commercialPayload = await requestCommercialPayload(currentLead, status);
      if (commercialPayload === null && requiresStatusMoveModal(status, kanbanStages) && !(requiresCommercialData(status, kanbanStages) && parseCurrencyInput(currentLead.valor_negociacao) > 0)) return;
    }

    setSavingStatusId(leadId);
    const optimisticPayload = { ...(commercialPayload || {}), status };
    setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, ...optimisticPayload } : lead));

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      alert('Sessao expirada. Entre novamente.');
      fetchLeads(0, false);
      setSavingStatusId(null);
      return;
    }

    const response = await fetch(`/api/crm/leads/${leadId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(optimisticPayload),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert('Erro ao atualizar status: ' + (payload.error || 'tente novamente.'));
      fetchLeads(0, false);
    } else if (payload.lead) {
      setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, ...payload.lead } : lead));
    }
    setSavingStatusId(null);
  };

  const updateLeadNegotiationValue = async (lead: Lead, rawValue: string) => {
    const value = parseCurrencyInput(rawValue);
    const valorNegociacao = value > 0 ? value : null;

    setSavingStatusId(lead.id);
    setLeads((current) => current.map((item) => item.id === lead.id ? {
      ...item,
      valor_negociacao: valorNegociacao,
    } : item));

    const { error } = await supabase
      .from('leads')
      .update({
        valor_negociacao: valorNegociacao,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    if (error) {
      alert('Erro ao atualizar valor de negociacao: ' + error.message);
      await fetchLeads(0, false);
    }
    setSavingStatusId(null);
  };

  const updateLeadTextField = async (lead: Lead, field: 'cnpj' | 'observacoes' | 'origem', rawValue: string) => {
    const dbField = field === 'origem' ? 'utm_source' : field;
    const nextValue = rawValue.trim();
    const currentValue = String((lead as any)[field] || '').trim();
    if (nextValue === currentValue) return;

    setSavingStatusId(lead.id);
    setLeads((current) => current.map((item) => item.id === lead.id ? {
      ...item,
      [field]: nextValue || null,
    } : item));

    const { error } = await supabase
      .from('leads')
      .update({
        [dbField]: nextValue || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    if (error) {
      alert('Erro ao atualizar lead: ' + error.message);
      await fetchLeads(0, false);
    }
    setSavingStatusId(null);
  };

  const deleteLead = async (lead: Lead) => {
    if (!isViewingAsCorretor) return;
    const confirmed = await confirmDialog(`Remover o lead ${lead.nome}? Essa acao so deve ser usada por admin.`, {
      title: 'Remover lead',
      confirmLabel: 'Remover lead',
      variant: 'danger',
    });
    if (!confirmed) return;

    setSavingStatusId(lead.id);
    const previous = leads;
    setLeads((current) => current.filter((item) => item.id !== lead.id));

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setLeads(previous);
      setSavingStatusId(null);
      alert('Sessao expirada. Entre novamente.');
      return;
    }

    const response = await fetch(`/api/admin/leads/${lead.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setLeads(previous);
      alert('Erro ao remover lead: ' + (payload.error || 'tente novamente.'));
    }
    setSavingStatusId(null);
  };

  const saveCrmConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brokerCorretorId) return;

    setSavingCrm(true);
    const { error: updateError } = await supabase
      .from('corretores')
      .update({ crm_api_url: crmApiUrl || null })
      .eq('id', brokerCorretorId);

    setSavingCrm(false);
    if (updateError) {
      alert('Nao consegui salvar a conexao agora. Tente novamente em instantes ou avise a equipe Orion.');
      return;
    }

    setShowCrmModal(false);
  };

  const importSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brokerCorretorId || !sheetUrl.trim()) {
      setImportMessage('Cole o link da planilha.');
      return;
    }

    setImporting(true);
    setImportMessage(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setImporting(false);
      setImportMessage('Sessao expirada. Entre novamente.');
      return;
    }

    const response = await fetch('/api/admin/leads/import-sheets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        corretor_id: brokerCorretorId,
        sheet_url: sheetUrl,
        origem: sheetOrigin,
      }),
    });

    const payload = await response.json();
    setImporting(false);

    if (!response.ok) {
      setImportMessage(payload.error || 'Erro ao importar planilha.');
      return;
    }

    const skippedText = payload.skipped ? ` ${payload.skipped} pagina(s) nao puderam ser lidas.` : '';
    const paginasText = payload.paginas ? ` ${payload.paginas} pagina(s) lida(s).` : '';
    const incompleteText = payload.incomplete ? ` ${payload.incomplete} lead(s) vieram com dados incompletos e foram marcados com aviso.` : '';
    const duplicatedText = payload.duplicated ? ` ${payload.duplicated} duplicado(s) ignorado(s).` : '';
    setImportMessage(`${payload.imported} lead(s) importado(s).${duplicatedText}${paginasText}${incompleteText}${skippedText}`);
    setSheetUrl('');
    setSheetOrigin('Manual');
    await fetchLeads(0, false);
  };

  const createManualLead = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!brokerCorretorId || !canCreateManualLead) return;
    if (!manualLeadForm.nome.trim() || !manualLeadForm.telefone.trim()) {
      setManualLeadError('Informe nome e telefone do lead.');
      return;
    }

    setCreatingManualLead(true);
    setManualLeadError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setCreatingManualLead(false);
      setManualLeadError('Sessao expirada. Entre novamente.');
      return;
    }

    const response = await fetch('/api/admin/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        corretor_id: brokerCorretorId,
        ...manualLeadForm,
        status: 'Aguardando atendimento',
      }),
    });

    const payload = await response.json().catch(() => ({}));
    setCreatingManualLead(false);

    if (!response.ok) {
      setManualLeadError(payload.error || 'Erro ao criar lead.');
      return;
    }

    if (payload.lead) {
      setLeads((current) => [{ ...payload.lead, status: normalizeLeadStatus(payload.lead.status) }, ...current]);
    } else {
      await fetchLeads(0, false);
    }

    setManualLeadForm(EMPTY_MANUAL_LEAD);
    setShowManualLeadModal(false);
  };

  const currentMemberIds = teamMembers
    .filter((member) => member.profile_id === profile?.id)
    .map((member) => member.id);

  const filteredLeads = leads.filter(lead => {
    const leadTab = tabLabel(lead.operadora);
    const searchMatch =
      (lead.nome?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (lead.telefone || '').includes(searchTerm) ||
      (lead.cidade?.toLowerCase() || '').includes(searchTerm.toLowerCase());

    const cnpjMatch = cnpjFilter === 'todos' || cnpjCategory(lead.possui_cnpj) === cnpjFilter;
    const statusMatch = statusFilter === 'todos' || lead.status === statusFilter;
    const operadoraMatch =
      operadoraFilter === 'todas' ||
      (operadoraFilter === '__sem_aba__' ? leadTab === 'Sem aba' : leadTab === operadoraFilter);
    const campaignMatch = campaignFilter === 'todos' || leadCampaign(lead) === campaignFilter;
    const origemMatch = origemFilter === 'todos' || leadOrigem(lead) === origemFilter;
    const adsetMatch = adsetFilter === 'todos' || leadAdset(lead) === adsetFilter;
    const adMatch = adFilter === 'todos' || leadAd(lead) === adFilter;
    const leadDate = lead.data_entrada ? new Date(lead.data_entrada) : null;
    const dateTypeMatch =
      (dateFilterType === 'com_data' && lead.data_entrada !== null) ||
      (dateFilterType === 'sem_data' && lead.data_entrada === null);
    const fromMatch = !dateFrom || (leadDate && leadDate >= new Date(dateFrom));
    const toMatch = !dateTo || (leadDate && leadDate <= new Date(dateTo + 'T23:59:59'));
    const responsavelMatch =
      responsavelFilter === 'todos' ||
      (responsavelFilter === 'meus'
        ? lead.responsavel_profile_id === profile?.id || currentMemberIds.includes(String(lead.responsavel_membro_id || ''))
        : responsavelFilter === 'sem_responsavel'
          ? !lead.responsavel_membro_id && !lead.responsavel_profile_id
          : lead.responsavel_membro_id === responsavelFilter);

    return searchMatch && cnpjMatch && statusMatch && operadoraMatch && origemMatch && campaignMatch && adsetMatch && adMatch && dateTypeMatch && fromMatch && toMatch && responsavelMatch;
  });

  const filterOptions = (values: string[]) => Array.from(new Set(values.filter((value) => value && value !== '-'))).sort((a, b) => a.localeCompare(b));

  const sheetTabs = useMemo(() => {
    const fromLeads = leads
      .map((lead) => tabLabel(lead.operadora))
      .filter((operadora) => operadora !== 'Sem aba');
    return Array.from(new Set(fromLeads)).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const campaignOptions = useMemo(() => filterOptions(leads.map(leadCampaign)), [leads]);
  const origemOptions = useMemo(() => filterOptions(leads.map(leadOrigem)), [leads]);
  const adsetOptions = useMemo(() => filterOptions(leads.map(leadAdset)), [leads]);
  const adOptions = useMemo(() => filterOptions(leads.map(leadAd)), [leads]);

  const tabCounts = useMemo(() => {
    return leads.reduce<Record<string, number>>((acc, lead) => {
      const key = tabLabel(lead.operadora);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [leads]);

  const hasActiveFilters = Boolean(
    searchTerm ||
    dateFrom ||
    dateTo ||
    dateFilterType !== 'com_data' ||
    cnpjFilter !== 'todos' ||
    statusFilter !== 'todos' ||
    operadoraFilter !== 'todas' ||
    origemFilter !== 'todos' ||
    campaignFilter !== 'todos' ||
    adsetFilter !== 'todos' ||
    adFilter !== 'todos' ||
    responsavelFilter !== defaultResponsavelFilter
  );

  const clearFilters = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setDateFilterType('com_data');
    setCnpjFilter('todos');
    setStatusFilter('todos');
    setOperadoraFilter('todas');
    setOrigemFilter('todos');
    setCampaignFilter('todos');
    setAdsetFilter('todos');
    setAdFilter('todos');
    setResponsavelFilter(defaultResponsavelFilter);
  };

  const exportToCsv = () => {
    if (filteredLeads.length === 0) {
      alert('Nenhum lead para exportar.');
      return;
    }

    const headers = [
      'Data de Entrada',
      'Nome',
      'Telefone',
      'Idades',
      'Possui CNPJ',
      'CNPJ',
      'Plano Ativo',
      'Plano Atual',
      'Custo Plano Atual',
      'Investimento',
      'Cidade',
      'Status',
      'Página/Operadora',
      'Origem',
      'UTM Source',
      'Meio (UTM Medium)',
      'Campanha (UTM Campaign)',
      'Termo (UTM Term)',
      'Conteúdo (UTM Content)',
      'Observações'
    ];

    const rows = filteredLeads.map(lead => [
      lead.data_entrada ? new Date(lead.data_entrada).toLocaleDateString('pt-BR') : '',
      lead.nome || '',
      lead.telefone || '',
      lead.idades || '',
      lead.possui_cnpj || '',
      lead.cnpj || '',
      lead.tem_plano_ativo || '',
      lead.plano_atual || '',
      lead.custo_plano_atual || '',
      lead.investimento || '',
      lead.cidade || '',
      lead.status || '',
      lead.operadora || '',
      leadOrigem(lead),
      lead.utm_source || '',
      lead.utm_medium || '',
      lead.utm_campaign || '',
      lead.utm_term || '',
      lead.utm_content || '',
      lead.observacoes || ''
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `leads_export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const teamStats = useMemo(() => {
    return teamMembers.map((member) => {
      const memberLeads = leads.filter((lead) => lead.responsavel_membro_id === member.id);
      const semResposta = memberLeads.filter((lead) => {
        const status = normalizeLeadStatus(lead.status);
        if (normalizeText(status).includes('retorno')) return true;
        if (status !== 'Aguardando atendimento' || !lead.data_entrada) return false;
        return Date.now() - new Date(lead.data_entrada).getTime() > 20 * 60 * 1000;
      }).length;
      const vendas = memberLeads.filter(isLeadSale).length;
      const negociacao = memberLeads.filter((lead) => normalizeText(normalizeLeadStatus(lead.status)).includes('negocia')).length;
      return {
        ...member,
        total: memberLeads.length,
        semResposta,
        vendas,
        negociacao,
      };
    });
  }, [teamMembers, leads]);

  const ranking = useMemo(() => {
    return [...teamStats].sort((a, b) => b.vendas - a.vendas || b.total - a.total);
  }, [teamStats]);

  return (
    <InternalLayout>
      <div className="orion-leads-page">
      <div className="orion-leads-header mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Leads</h1>
          <p className="font-medium text-gray-500">Lista detalhada com filtros, status comercial, página de origem e UTMs.</p>
        </div>
        <div className={`orion-leads-actions grid w-full grid-cols-1 gap-3 md:w-auto ${canCreateManualLead ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          {canCreateManualLead && (
            <button
              onClick={() => {
                setManualLeadError(null);
                setShowManualLeadModal(true);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-100 bg-cyan-50 px-5 py-3 font-black text-cyan-700 transition-all hover:bg-cyan-100"
            >
              <Plus size={18} /> Adicionar lead
            </button>
          )}
          <button
            onClick={() => setShowCrmModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 font-black text-blue-600 transition-all hover:bg-blue-100"
          >
            <Plug size={18} /> Conectar CRM
          </button>
          <button
            onClick={exportToCsv}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white px-5 py-3 font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50"
          >
            <Download size={18} /> Exportar
          </button>
          {isViewingAsCorretor && (
            <button
              onClick={() => setShowImportModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-3 font-black text-emerald-700 transition-all hover:bg-emerald-100"
            >
              <Upload size={18} /> Importar
            </button>
          )}
        </div>
      </div>

      {canAssignTeamLeads && teamMembers.length > 0 && (
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Time comercial</p>
              <h2 className="text-xl font-black text-slate-950">Resumo dos vendedores</h2>
              <p className="text-sm font-bold text-slate-500">Acompanhe quem esta com leads, sem resposta e vendas realizadas.</p>
            </div>
            <button
              type="button"
              onClick={() => setRankingEnabled((current) => !current)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                rankingEnabled ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              <Trophy size={15} /> {rankingEnabled ? 'Ranking ativo' : 'Ativar ranking'}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {teamStats.map((member) => (
              <div key={member.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-xs font-black text-white">
                    {member.nome.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-950">{member.nome}</p>
                    <p className="truncate text-[11px] font-bold text-slate-400">{member.email}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-black">
                  <div className="rounded-xl bg-white p-3 text-slate-700"><span className="block text-[9px] uppercase tracking-widest text-slate-400">Leads</span>{member.total}</div>
                  <div className="rounded-xl bg-amber-50 p-3 text-amber-700"><span className="block text-[9px] uppercase tracking-widest text-amber-500">Sem resposta</span>{member.semResposta}</div>
                  <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><span className="block text-[9px] uppercase tracking-widest text-blue-500">Negociacao</span>{member.negociacao}</div>
                  <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><span className="block text-[9px] uppercase tracking-widest text-emerald-500">Vendas</span>{member.vendas}</div>
                </div>
              </div>
            ))}
          </div>

          {rankingEnabled && (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-blue-700">Ranking de vendas</p>
              <div className="space-y-2">
                {ranking.map((member, index) => (
                  <div key={member.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-800">
                    <span>#{index + 1} {member.nome}</span>
                    <span className="text-blue-700">{member.vendas} venda(s)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="orion-leads-filters orion-panel mb-6 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-[1_1_320px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por nome, telefone ou cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="orion-control w-full py-3.5 pl-12 pr-4 text-sm transition-all"
            />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="orion-control min-w-[165px] flex-[0_0_165px] px-4 py-3.5 text-sm" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="orion-control min-w-[165px] flex-[0_0_165px] px-4 py-3.5 text-sm" />
          <select value={dateFilterType} onChange={(e) => setDateFilterType(e.target.value)} className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm">
            <option value="com_data">Leads com data</option>
            <option value="sem_data">Leads sem data</option>
          </select>
          <select value={cnpjFilter} onChange={(e) => setCnpjFilter(e.target.value)} className="orion-control min-w-[170px] flex-[1_1_170px] px-4 py-3.5 text-sm">
            <option value="todos">CNPJ: todos</option>
            <option value="com">Com CNPJ</option>
            <option value="sem">Sem CNPJ</option>
            <option value="nao_informado">Nao informado</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="orion-control min-w-[220px] flex-[1_1_220px] px-4 py-3.5 text-sm">
            <option value="todos">Todos os status</option>
            {kanbanStages.map(stage => <option key={stage.id} value={stage.id}>{getKanbanStageLabel(kanbanStages, stage.id)}</option>)}
          </select>
          {canManageLeadResponsible && (
            <select
              value={responsavelFilter}
              onChange={(e) => setResponsavelFilter(e.target.value)}
              className="orion-control min-w-[220px] flex-[1_1_220px] px-4 py-3.5 text-sm"
            >
              <option value="meus">Responsavel: meus leads</option>
              <option value="todos">Responsavel: todos</option>
              <option value="sem_responsavel">Sem responsavel</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.nome}
                </option>
              ))}
            </select>
          )}
          <select value={operadoraFilter} onChange={(e) => setOperadoraFilter(e.target.value)} className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm">
            <option value="todas">Página: todas</option>
            {sheetTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
            <option value="__sem_aba__">Sem página</option>
          </select>
          <select value={origemFilter} onChange={(e) => setOrigemFilter(e.target.value)} className="orion-control min-w-[190px] flex-[1_1_190px] px-4 py-3.5 text-sm">
            <option value="todos">Origem: todas</option>
            {origemOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm">
            <option value="todos">Campanha: todas</option>
            {campaignOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={adsetFilter} onChange={(e) => setAdsetFilter(e.target.value)} className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm">
            <option value="todos">Conjunto: todos</option>
            {adsetOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={adFilter} onChange={(e) => setAdFilter(e.target.value)} className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm">
            <option value="todos">Anuncio: todos</option>
            {adOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className="flex min-h-[50px] min-w-[132px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-600 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={15} /> Limpar
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
          <span className="orion-chip bg-slate-100 text-slate-600">
            {filteredLeads.length} de {totalLeadsCount ?? leads.length} leads
            {totalLeadsCount && leads.length < totalLeadsCount ? ` (${leads.length} carregados)` : ''}
          </span>
          <span className="orion-chip bg-blue-50 text-blue-700">
            Página: {operadoraFilter === 'todas' ? 'todas' : operadoraFilter === '__sem_aba__' ? 'sem página' : operadoraFilter}
          </span>
          <span className="orion-chip bg-amber-50 text-amber-700">
            CNPJ: {cnpjFilter === 'todos' ? 'todos' : cnpjFilter === 'com' ? 'com CNPJ' : cnpjFilter === 'sem' ? 'sem CNPJ' : 'nao informado'}
          </span>
          {origemFilter !== 'todos' && (
            <span className="orion-chip bg-cyan-50 text-cyan-700">
              Origem: {origemFilter}
            </span>
          )}
          {!isTeamMemberProfile && responsavelFilter !== 'todos' && (
            <span className="orion-chip bg-indigo-50 text-indigo-700">
              Responsável: {responsavelFilter === 'meus'
                ? 'meus leads'
                : responsavelFilter === 'sem_responsavel'
                  ? 'sem responsável'
                  : teamMembers.find(m => m.id === responsavelFilter)?.nome || 'carregando...'}
            </span>
          )}
        </div>
      </div>

      <div className="orion-leads-table-shell -mx-5 sm:-mx-6 lg:-mx-8">
        <div className="scrollbar-visible overflow-x-auto overflow-y-visible px-5 sm:px-6 lg:px-8">
          {error ? (
            <div className="py-24 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <ShieldAlert size={32} />
              </div>
              <h3 className="mb-2 text-xl font-bold text-gray-900">Ops! Algo deu errado.</h3>
              <p className="mx-auto mb-6 max-w-md font-medium text-red-500">{error}</p>
              <button onClick={() => fetchLeads(0, false)} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 hover:underline">
                <RefreshCw size={14} /> Tentar novamente
              </button>
            </div>
          ) : (
            <table className="orion-leads-table w-full min-w-[2820px] border-collapse text-left text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100">
                  <th className="w-12 border border-slate-200 px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Data</th>
                  <th className="min-w-[240px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Nome</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Telefone</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Idades</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Possui CNPJ</th>
                  <th className="min-w-[150px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">CNPJ</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Tem plano ativo?</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Plano atual</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Investimento pretendido</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Cidade</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Valor negociação</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Etiqueta</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Operadora venda</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th>
                  <th className="min-w-[150px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Página / Operadora</th>
                  <th className="min-w-[150px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Origem</th>
                  <th className="min-w-[180px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Responsavel</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Campanha</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Conjunto</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Anuncio</th>
                  <th className="min-w-[280px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Observações</th>
                  {isViewingAsCorretor && <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Admin</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={isViewingAsCorretor ? 23 : 22} className="py-20 text-center">
                      <Loader2 className="mx-auto animate-spin text-blue-600" size={40} />
                    </td>
                  </tr>
                ) : filteredLeads.map((lead, index) => {
                  const statusStyle = getLeadStatusStyle(isSaleEquivalentStage(kanbanStages, lead.status) ? 'Venda realizada' : lead.status);
                  const leadTab = tabLabel(lead.operadora);
                  const importWarnings = getLeadImportWarnings(lead);
                  const cleanObservacoes = cleanLeadObservationText(lead.observacoes);

                  return (
                  <tr
                    key={lead.id}
                    onClick={(event) => {
                      if (isInteractiveTableTarget(event.target)) return;
                      openLeadInCrm(lead.id);
                    }}
                    title="Abrir lead no CRM"
                    className="cursor-pointer transition-colors border-b border-slate-100 dark:border-white/5 hover:bg-blue-50/50 dark:hover:bg-blue-500/10"
                  >
                    <td className="border border-slate-100 bg-slate-50 px-3 py-3 text-center text-xs font-black text-slate-400">{index + 1}</td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">
                      {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}
                    </td>
                    <td className="max-w-[280px] whitespace-nowrap border border-slate-100 px-3 py-3 font-bold text-gray-900" title={lead.nome || ''}>
                      <span className="flex items-center gap-2">
                        <span className="block overflow-hidden text-ellipsis">{lead.nome}</span>
                        {importWarnings.length > 0 && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-amber-700"
                            title={importWarnings.join('\n')}
                          >
                            <AlertTriangle size={12} /> Aviso
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-medium text-slate-600">
                      <PhoneAction phone={lead.telefone} leadId={lead.id} />
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">{lead.idades || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3">
                      <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${cnpjBadgeStyle(lead.possui_cnpj)}`}>
                        {cnpjLabel(lead.possui_cnpj)}
                      </span>
                    </td>
                    <td className="border border-slate-100 px-3 py-3">
                      <input
                        defaultValue={lead.cnpj || ''}
                        onBlur={(event) => updateLeadTextField(lead, 'cnpj', event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        placeholder="Inserir CNPJ"
                        className="w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </td>
                    <td className="border border-slate-100 px-3 py-3">
                      <span className={`inline-flex min-w-[190px] max-w-[240px] whitespace-normal rounded-lg px-3 py-2 text-[11px] font-black uppercase leading-relaxed tracking-widest ${
                        normalizeText(lead.tem_plano_ativo).includes('sim') ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' :
                        normalizeText(lead.tem_plano_ativo).includes('nao') ? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' :
                        'bg-slate-50 text-slate-500'
                      }`}>
                        {lead.tem_plano_ativo || 'Nao informado'}
                      </span>
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-medium text-slate-500">{lead.plano_atual || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">{lead.investimento || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3 font-medium text-slate-500">{lead.cidade || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3">
                      <input
                        defaultValue={lead.valor_negociacao ? formatCurrencyValue(lead.valor_negociacao) : ''}
                        onBlur={(event) => updateLeadNegotiationValue(lead, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        placeholder="R$ 0,00"
                        className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </td>
                    <td className="border border-slate-100 px-3 py-3">
                      <select
                        value={lead.etiqueta || ''}
                        onChange={async (event) => {
                          let etiqueta = event.target.value;
                          if (etiqueta === 'Outra etiqueta') {
                            etiqueta = window.prompt('Nome da nova etiqueta', lead.etiqueta || '') || '';
                          }
                          setLeads(prev => prev.map(item => item.id === lead.id ? { ...item, etiqueta } : item));
                          await supabase.from('leads').update({ etiqueta: etiqueta || null, updated_at: new Date().toISOString() }).eq('id', lead.id);
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700"
                      >
                        <option value="">Sem etiqueta</option>
                        {READY_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
                        {lead.etiqueta && !READY_LABELS.includes(lead.etiqueta) && <option value={lead.etiqueta}>{lead.etiqueta}</option>}
                      </select>
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">{lead.operadora_negociacao || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={lead.status}
                          onChange={(e) => updateLeadStatus(lead.id, e.target.value as LeadStatus)}
                          className={`orion-status-select border px-3 py-2 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-blue-500/20 ${statusStyle.chip}`}
                        >
                          {!kanbanStages.some((stage) => stage.id === lead.status) && <option value={lead.status}>{lead.status}</option>}
                          {kanbanStages.map(stage => <option key={stage.id} value={stage.id}>{getKanbanStageLabel(kanbanStages, stage.id)}</option>)}
                        </select>
                        {savingStatusId === lead.id && <Loader2 className="animate-spin text-blue-600" size={16} />}
                      </div>
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-black text-slate-600">{leadTab}</td>
                    <td className="border border-slate-100 px-3 py-3">
                      <input
                        defaultValue={leadOrigem(lead) === '-' ? '' : leadOrigem(lead)}
                        onBlur={(event) => updateLeadTextField(lead, 'origem', event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        placeholder="Origem"
                        className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </td>
                    <td className="border border-slate-100 px-3 py-3">
                      {canManageLeadResponsible && teamMembers.length > 0 ? (
                        <select
                          value={lead.responsavel_membro_id || 'unassigned'}
                          onChange={(event) => assignLeadToMember(lead.id, event.target.value)}
                          className="w-full min-w-[170px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="unassigned">Sem responsavel (liberado)</option>
                          {teamMembers.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}
                        </select>
                      ) : (
                        <>
                          <div className="max-w-[170px] truncate text-xs font-black text-slate-700">
                            {lead.responsavel_membro?.nome || '-'}
                          </div>
                          {lead.responsavel_membro?.email && (
                            <div className="max-w-[170px] truncate text-[10px] font-bold text-slate-400">
                              {lead.responsavel_membro.email}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-bold text-slate-600">{leadCampaign(lead)}</td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-bold text-slate-600">{leadAdset(lead)}</td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-bold text-slate-600">
                      {leadAd(lead) === '-' ? '-' : (
                        <button
                          type="button"
                          data-row-action
                          onClick={() => openAdPreview(leadAd(lead))}
                          className="inline-flex max-w-[240px] items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-left font-black text-cyan-800 transition-colors hover:border-cyan-400 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                          title={`Visualizar criativo do anuncio ${leadAd(lead)}`}
                        >
                          <ImageIcon size={14} className="shrink-0" />
                          <span className="truncate">{leadAd(lead)}</span>
                        </button>
                      )}
                    </td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-medium leading-relaxed text-slate-600">
                      <textarea
                        defaultValue={cleanObservacoes || ''}
                        onBlur={(event) => updateLeadTextField(lead, 'observacoes', event.target.value)}
                        placeholder="Adicionar observacao"
                        rows={2}
                        className="min-w-[260px] max-w-[320px] resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-relaxed text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </td>
                    {isViewingAsCorretor && (
                      <td className="border border-slate-100 px-3 py-3">
                        <button
                          type="button"
                          onClick={() => deleteLead(lead)}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-100"
                        >
                          <Trash2 size={13} /> Remover
                        </button>
                      </td>
                    )}
                  </tr>
                )})}
              </tbody>
            </table>
          )}
        </div>

        <div className="hidden">
          <button
            type="button"
            onClick={() => setOperadoraFilter('todas')}
            className={`whitespace-nowrap rounded-t-xl border px-4 py-2 text-xs font-black transition-all ${operadoraFilter === 'todas' ? 'border-emerald-400 bg-white text-emerald-700 shadow-sm' : 'border-transparent bg-slate-200 text-slate-600 hover:bg-white'}`}
          >
            Todas as páginas ({leads.length})
          </button>
          {sheetTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setOperadoraFilter(tab)}
              className={`whitespace-nowrap rounded-t-xl border px-4 py-2 text-xs font-black transition-all ${operadoraFilter === tab ? 'border-emerald-400 bg-white text-emerald-700 shadow-sm' : 'border-transparent bg-slate-200 text-slate-600 hover:bg-white'}`}
            >
              {tab} ({tabCounts[tab] || 0})
            </button>
          ))}
          {tabCounts['Sem aba'] && (
            <button
              type="button"
              onClick={() => setOperadoraFilter('__sem_aba__')}
              className={`whitespace-nowrap rounded-t-xl border px-4 py-2 text-xs font-black transition-all ${operadoraFilter === '__sem_aba__' ? 'border-emerald-400 bg-white text-emerald-700 shadow-sm' : 'border-transparent bg-slate-200 text-slate-600 hover:bg-white'}`}
            >
              Sem página ({tabCounts['Sem aba']})
            </button>
          )}
        </div>

        {!loading && !error && filteredLeads.length === 0 && (
          <div className="py-24 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
              <AlertCircle size={32} />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nenhum lead encontrado</p>
          </div>
        )}
      </div>
      {hasMoreLeads && !error && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => fetchLeads(leadPage + 1, true)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-4 text-sm font-black text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-50"
          >
            {loadingMore ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            Carregar mais leads
          </button>
        </div>
      )}
      </div>

      {showCrmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md sm:p-6">
          <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white shadow-2xl sm:rounded-[2.5rem]">
            <div className="flex items-center justify-between border-b border-gray-100 p-5 sm:p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-600">Atendimento</p>
                <h2 className="text-xl font-black text-gray-900">Conectar CRM</h2>
              </div>
              <button onClick={() => setShowCrmModal(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={22} />
              </button>
            </div>
            <form onSubmit={saveCrmConfig} className="space-y-5 p-5 sm:p-8">
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Link de conexao do seu CRM</label>
                <input
                  type="url"
                  value={crmApiUrl}
                  onChange={(e) => setCrmApiUrl(e.target.value)}
                  placeholder="Cole aqui o link enviado pelo seu CRM"
                  className="w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500"
                />
                <p className="px-1 text-xs font-bold leading-relaxed text-slate-500">
                  Use esse campo apenas se voce atende seus leads em outro sistema e quer manter tudo conectado.
                </p>
              </div>
              <button disabled={savingCrm} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 py-5 font-black text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-50">
                {savingCrm ? <Loader2 className="animate-spin" size={20} /> : <><Save size={18} /> Salvar conexao</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {showManualLeadModal && canCreateManualLead && (
        <div className="fixed inset-0 z-[9999] flex min-h-dvh items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-10 backdrop-blur-md sm:py-16">
          <div className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-[#08111f] shadow-2xl shadow-black/40 sm:rounded-[2.5rem]">
            <div className="flex items-center justify-between border-b border-white/10 p-5 sm:p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-cyan-600">Cadastro manual</p>
                <h2 className="text-xl font-black text-white">Adicionar lead</h2>
                <p className="mt-1 text-sm font-bold text-slate-400">Selecione o responsavel para avisar automaticamente.</p>
              </div>
              <button onClick={() => setShowManualLeadModal(false)} className="rounded-full bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <X size={22} />
              </button>
            </div>
            <form onSubmit={createManualLead} className="max-h-[calc(100dvh-12rem)] space-y-5 overflow-y-auto p-5 sm:p-8">
              {manualLeadError && (
                <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-black text-red-600">
                  {manualLeadError}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Nome</label>
                  <input
                    required
                    value={manualLeadForm.nome}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, nome: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="Nome do cliente"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Telefone</label>
                  <input
                    required
                    value={manualLeadForm.telefone}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, telefone: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="55 11 99999-9999"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Responsavel</label>
                  <select
                    value={manualLeadForm.responsavel_membro_id}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, responsavel_membro_id: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                  >
                    <option value="unassigned">Sem responsavel</option>
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.nome}</option>
                    ))}
                  </select>
                  {leadSettingsEnabled && manualLeadForm.origem_config_id && (
                    <p className="px-1 text-[11px] font-semibold text-cyan-300">
                      Preenchido pela origem. Voce pode trocar somente para este lead.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Cidade</label>
                  <input
                    value={manualLeadForm.cidade}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, cidade: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="Cidade"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Origem</label>
                  {leadSettingsEnabled || isFacilita ? (
                    <div className="flex gap-2">
                      <select
                        required
                        value={manualLeadForm.origem_config_id}
                        onChange={(event) => selectConfiguredOrigin(event.target.value)}
                        className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                      >
                        <option value="">Selecione a origem</option>
                        {leadOriginConfigs.map((origin) => (
                          <option key={origin.id} value={origin.id}>{origin.nome}</option>
                        ))}
                      </select>
                      {canAssignTeamLeads && (
                        <button
                          type="button"
                          onClick={() => setShowNewOriginForm((current) => !current)}
                          className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 text-xs font-black text-cyan-200 hover:bg-cyan-400/20"
                        >
                          <Plus size={16} className="mx-auto" />
                          Origem
                        </button>
                      )}
                    </div>
                  ) : (
                    <input
                      value={manualLeadForm.origem}
                      onChange={(e) => setManualLeadForm((current) => ({ ...current, origem: e.target.value }))}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                      placeholder="Manual, Orion, Indicacao..."
                    />
                  )}
                </div>
                {(leadSettingsEnabled || isFacilita) && (
                  <div className="space-y-2">
                    <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Etiqueta</label>
                    <div className="flex gap-2">
                      <select
                        value={manualLeadForm.etiqueta}
                        onChange={(event) => setManualLeadForm((current) => ({ ...current, etiqueta: event.target.value }))}
                        className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                      >
                        <option value="">Sem etiqueta</option>
                        {leadLabelConfigs.map((label) => <option key={label.id} value={label.nome}>{label.nome}</option>)}
                      </select>
                      {canAssignTeamLeads && (
                        <button
                          type="button"
                          onClick={() => setShowNewLabelForm((current) => !current)}
                          className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 text-xs font-black text-cyan-200 hover:bg-cyan-400/20"
                        >
                          <Plus size={16} className="mx-auto" />
                          Etiqueta
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {showNewOriginForm && canAssignTeamLeads && (
                  <div className="space-y-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 md:col-span-2">
                    <div>
                      <p className="text-sm font-black text-white">Nova origem e pipeline</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">O responsavel escolhido sera sugerido automaticamente nos proximos leads desta origem.</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        value={newOriginName}
                        onChange={(event) => setNewOriginName(event.target.value)}
                        placeholder="Ex: Indicacao Camila"
                        maxLength={80}
                        className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
                      />
                      <select
                        value={newOriginResponsible}
                        onChange={(event) => setNewOriginResponsible(event.target.value)}
                        className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
                      >
                        <option value="unassigned">Sem responsavel padrao</option>
                        {teamMembers.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={savingLeadSetting}
                        onClick={() => saveLeadSetting('create_origin')}
                        className="rounded-xl bg-cyan-600 px-5 py-3 text-sm font-black text-white hover:bg-cyan-700 disabled:opacity-50"
                      >
                        Salvar origem
                      </button>
                    </div>
                  </div>
                )}
                {showNewLabelForm && canAssignTeamLeads && (
                  <div className="grid gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 md:col-span-2 md:grid-cols-[1fr_auto]">
                    <input
                      value={newLabelName}
                      onChange={(event) => setNewLabelName(event.target.value)}
                      placeholder="Nome da etiqueta fixa"
                      maxLength={60}
                      className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
                    />
                    <button
                      type="button"
                      disabled={savingLeadSetting}
                      onClick={() => saveLeadSetting('create_label')}
                      className="rounded-xl bg-cyan-600 px-5 py-3 text-sm font-black text-white hover:bg-cyan-700 disabled:opacity-50"
                    >
                      Salvar etiqueta
                    </button>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Idade</label>
                  <input
                    value={manualLeadForm.idades}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, idades: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="Ex: 32"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Investimento</label>
                  <input
                    value={manualLeadForm.investimento}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, investimento: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="Ex: Ate R$2.000,00"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Possui CNPJ?</label>
                  <select
                    value={manualLeadForm.possui_cnpj}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, possui_cnpj: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                  >
                    <option>Sim</option>
                    <option>Nao</option>
                    <option>Tenho MEI</option>
                    <option>Nao informado</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">CNPJ</label>
                  <input
                    value={manualLeadForm.cnpj}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, cnpj: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="Opcional"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Tem plano ativo?</label>
                  <select
                    value={manualLeadForm.tem_plano_ativo}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, tem_plano_ativo: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                  >
                    <option>Sim</option>
                    <option>Nao</option>
                    <option>Nao informado</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Plano atual</label>
                  <input
                    value={manualLeadForm.plano_atual}
                    onChange={(e) => setManualLeadForm((current) => ({ ...current, plano_atual: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowManualLeadModal(false)}
                  className="rounded-2xl border border-white/10 px-6 py-4 text-sm font-black text-slate-300 hover:bg-white/5 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  disabled={creatingManualLead}
                  className="flex items-center justify-center gap-3 rounded-2xl bg-cyan-600 px-6 py-4 text-sm font-black text-white shadow-xl shadow-cyan-600/20 hover:bg-cyan-700 disabled:opacity-50"
                >
                  {creatingManualLead ? <Loader2 className="animate-spin" size={18} /> : <><Plus size={18} /> Criar lead</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-[9999] flex min-h-dvh items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-10 backdrop-blur-md sm:py-16">
          <div className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/10 bg-[#08111f] shadow-2xl shadow-black/40 sm:rounded-[2.5rem]">
            <div className="flex items-center justify-between border-b border-white/10 p-5 sm:p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-emerald-600">Admin</p>
                <h2 className="text-xl font-black text-white">Importar planilha</h2>
              </div>
              <button onClick={() => setShowImportModal(false)} className="rounded-full bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <X size={22} />
              </button>
            </div>
            <form onSubmit={importSheet} className="max-h-[calc(100dvh-12rem)] space-y-5 overflow-y-auto p-5 sm:p-8">
              {importMessage && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm font-black text-emerald-300">
                  {importMessage}
                </div>
              )}
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Link do Google Sheets</label>
                <input
                  type="url"
                  required
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-5 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Origem dos leads</label>
                <select
                  value={sheetOrigin}
                  onChange={(event) => setSheetOrigin(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-5 py-4 text-sm font-bold text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                >
                  {IMPORT_ORIGIN_OPTIONS.map((origin) => (
                    <option key={origin.value} value={origin.value}>{origin.label}</option>
                  ))}
                </select>
                <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-bold leading-5 text-emerald-200">
                  Leads que nao forem Orion entram no CRM, Kanban e Inbox, mas ficam fora do CPL e da conversao das campanhas. Se a planilha tiver [ORION], o sistema marca como Orion automaticamente.
                </p>
              </div>
              <button disabled={importing} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 py-5 font-black text-white shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50">
                {importing ? <Loader2 className="animate-spin" size={20} /> : <><Upload size={18} /> Importar leads</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {adPreview && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Criativo do anuncio ${adPreview.adName}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setAdPreview(null);
          }}
        >
          <div className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-cyan-500/30 bg-[#071521] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#071521]/95 px-6 py-5 backdrop-blur sm:px-8">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">Anuncio ativo na Meta</p>
                <h2 className="mt-1 text-xl font-black text-white sm:text-2xl">{adPreview.adName}</h2>
              </div>
              <button
                type="button"
                onClick={() => setAdPreview(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Fechar visualizacao"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 sm:p-8">
              {adPreview.loading ? (
                <div className="flex min-h-80 flex-col items-center justify-center gap-4 text-slate-300">
                  <Loader2 size={38} className="animate-spin text-cyan-400" />
                  <p className="text-sm font-bold">Buscando o criativo na conta Meta...</p>
                </div>
              ) : adPreview.error ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/5 px-6 text-center">
                  <AlertCircle size={34} className="mb-4 text-amber-400" />
                  <p className="max-w-lg text-sm font-bold leading-relaxed text-amber-100">{adPreview.error}</p>
                </div>
              ) : adPreview.creative ? (
                <div className="grid gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                  <div className="flex min-h-80 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
                    {adPreview.creative.image_url || adPreview.creative.thumbnail_url ? (
                      <img
                        src={adPreview.creative.image_url || adPreview.creative.thumbnail_url || ''}
                        alt={`Criativo do anuncio ${adPreview.creative.ad_name}`}
                        className="max-h-[68vh] w-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 px-6 text-center text-slate-400">
                        <ImageIcon size={40} />
                        <p className="text-sm font-bold">A Meta nao retornou uma imagem para este anuncio.</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Status</span>
                      <p className="mt-1 text-sm font-black text-emerald-100">Ativo</p>
                    </div>
                    {adPreview.creative.title && (
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Titulo</span>
                        <p className="mt-2 text-lg font-black leading-snug text-white">{adPreview.creative.title}</p>
                      </div>
                    )}
                    {adPreview.creative.body && (
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Texto do anuncio</span>
                        <p className="mt-2 whitespace-pre-line text-sm font-medium leading-relaxed text-slate-300">{adPreview.creative.body}</p>
                      </div>
                    )}
                    {adPreview.creative.creative_name && (
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Nome do criativo</span>
                        <p className="mt-2 text-sm font-bold text-slate-300">{adPreview.creative.creative_name}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )}

      {commercialModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <form
            onSubmit={submitCommercialModal}
            className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/25"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Dados comerciais</p>
                <h2 className="mt-1 text-2xl font-black text-slate-950">Avancar para {getKanbanStageLabel(kanbanStages, commercialModal.status)}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">{commercialModal.lead.nome}</p>
              </div>
              <button
                type="button"
                onClick={() => closeCommercialModal(null)}
                className="rounded-2xl bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {commercialModalError && (
              <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-600">
                {commercialModalError}
              </div>
            )}

            {commercialModal.status === 'Sem interesse' ? (
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Motivo</span>
                  <select
                    autoFocus
                    value={commercialModal.sem_interesse_motivo}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, sem_interesse_motivo: event.target.value } : current)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-black text-slate-950 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  >
                    <option value="">Selecione o motivo</option>
                    <option value="Preco acima do esperado">Preco acima do esperado</option>
                    <option value="Ja fechou com outro corretor">Ja fechou com outro corretor</option>
                    <option value="Nao quer contratar agora">Nao quer contratar agora</option>
                    <option value="Fora do perfil de atendimento">Fora do perfil de atendimento</option>
                    <option value="Nao respondeu apos tentativas">Nao respondeu apos tentativas</option>
                    <option value="Outro motivo">Outro motivo</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-black text-slate-800">Chegou a fazer cotacao?</span>
                  <input
                    type="checkbox"
                    checked={commercialModal.sem_interesse_fez_cotacao}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, sem_interesse_fez_cotacao: event.target.checked } : current)}
                    className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </label>
                {commercialModal.sem_interesse_fez_cotacao && (
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Valor da cotacao</span>
                    <input
                      value={commercialModal.valor_negociacao}
                      onChange={(event) => setCommercialModal((current) => current ? { ...current, valor_negociacao: event.target.value } : current)}
                      placeholder="Ex: 1200"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-black text-slate-950 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Valor da negociacao</span>
                  <input
                    autoFocus
                    value={commercialModal.valor_negociacao}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, valor_negociacao: event.target.value } : current)}
                    placeholder="Ex: 1200"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-black text-slate-950 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  />
                </label>
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => closeCommercialModal(null)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                Salvar e mover lead
              </button>
            </div>
          </form>
        </div>
      )}
    </InternalLayout>
  );
}
