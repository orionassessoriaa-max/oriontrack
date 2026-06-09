'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
  Users
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadStatus } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { useDialog } from '@/components/providers/DialogProvider';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getLeadStatusStyle, LEAD_STATUSES, normalizeLeadStatus } from '@/lib/leadStatus';
import { cleanLeadObservationText, getLeadImportWarnings } from '@/lib/leadWarnings';
import PhoneAction from '@/components/ui/PhoneAction';
import SaleFinanceRedirect from '@/components/ui/SaleFinanceRedirect';

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function cnpjCategory(value?: string | null) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.includes('nao informado')) return 'nao_informado';
  if (normalized.includes('nao')) return 'sem';
  if (normalized.includes('sim') || normalized.includes('mei') || normalized.includes('cnpj')) return 'com';
  return 'nao_informado';
}

function cnpjLabel(value?: string | null) {
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

function calculateCommissionFromSale(value?: string | number | null) {
  return parseCurrencyInput(value) * 2.5;
}

function requiresCommercialData(status: LeadStatus) {
  return COMMERCIAL_REQUIRED_STATUSES.includes(status);
}

function requiresStatusMoveModal(status: LeadStatus) {
  return requiresCommercialData(status) || status === 'Sem interesse';
}

type CommercialPayload = {
  valor_negociacao?: number | null;
  operadora_negociacao?: string | null;
  valor_comissao?: number | null;
  sem_interesse_motivo?: string | null;
  sem_interesse_fez_cotacao?: boolean;
};

type CommercialModalState = {
  lead: Lead;
  status: LeadStatus;
  valor_negociacao: string;
  operadora_negociacao: string;
  valor_comissao: string;
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

export default function BrokerLeadsPage() {
  const { profile, isViewingAsCorretor } = useAuth();
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
  const [dateFilterType, setDateFilterType] = useState('todos');
  const [operadoraFilter, setOperadoraFilter] = useState('todas');
  const [campaignFilter, setCampaignFilter] = useState('todos');
  const [adsetFilter, setAdsetFilter] = useState('todos');
  const [adFilter, setAdFilter] = useState('todos');
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [crmApiUrl, setCrmApiUrl] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [commercialModal, setCommercialModal] = useState<CommercialModalState>(null);
  const [commercialModalError, setCommercialModalError] = useState<string | null>(null);
  const [financeRedirect, setFinanceRedirect] = useState<{ leadId: string; leadName?: string | null } | null>(null);
  const commercialResolverRef = useRef<((payload: CommercialPayload | null) => void) | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [rankingEnabled, setRankingEnabled] = useState(false);
  const canAssignTeamLeads = profile?.tipo_usuario === 'corretor' || profile?.tipo_usuario === 'corretor_admin';
  const canManageLeadResponsible = profile?.tipo_usuario === 'admin' || profile?.tipo_usuario === 'corretor_admin';

  useEffect(() => {
    const urlStatus = new URLSearchParams(window.location.search).get('status');
    if (urlStatus) setStatusFilter(urlStatus);
  }, []);

  useEffect(() => {
    if (profile?.corretor_id) {
      fetchLeads(0, false);
      fetchCrmConfig();
      fetchTeamMembers();
    }
  }, [profile?.corretor_id, profile?.nome_empresa]);

  const fetchLeads = async (page = 0, append = false) => {
    if (!profile?.corretor_id) {
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

      let idsToFetch = [profile.corretor_id];
      if (profile.nome_empresa) {
        const { data: siblings } = await supabase
          .from('corretores')
          .select('id')
          .eq('nome_empresa', profile.nome_empresa);
        if (siblings && siblings.length > 0) {
          idsToFetch = siblings.map((s) => s.id);
        }
      }

      let leadsQuery = supabase
        .from('leads')
        .select('*, responsavel_membro:responsavel_membro_id(nome,email)', { count: 'exact' })
        .in('corretor_id', idsToFetch)
        .order('data_entrada', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (!profile.nome_empresa && profile.tipo_usuario === 'corretor_membro') {
        leadsQuery = leadsQuery.or(`responsavel_profile_id.eq.${profile.id},responsavel_profile_id.is.null`);
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
    if (!profile?.corretor_id) return;

    const { data } = await supabase
      .from('corretores')
      .select('crm_api_url, operadoras_info')
      .eq('id', profile.corretor_id)
      .maybeSingle();

    setCrmApiUrl(data?.crm_api_url || '');
  };

  const fetchTeamMembers = async () => {
    if (!profile?.corretor_id || !canAssignTeamLeads) return;

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const response = await fetch(`/api/corretor/times?corretor_id=${encodeURIComponent(profile.corretor_id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setTeamMembers(payload.membros || []);
    }
  };

  const assignLeadToMember = async (leadId: string, memberId: string) => {
    if (!profile?.corretor_id) return;

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
      body: JSON.stringify({ action: 'assign_lead', lead_id: leadId, member_id: memberId || 'unassigned', corretor_id: profile.corretor_id }),
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
    if (!requiresStatusMoveModal(status)) return Promise.resolve(null);
    if (requiresCommercialData(status) && parseCurrencyInput(lead.valor_negociacao) > 0) return Promise.resolve(null);

    setCommercialModalError(null);
    setCommercialModal({
      lead,
      status,
      valor_negociacao: lead.valor_negociacao ? String(lead.valor_negociacao) : '',
      operadora_negociacao: lead.operadora_negociacao || '',
      valor_comissao: lead.valor_comissao ? String(lead.valor_comissao) : '',
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
      valor_comissao: calculateCommissionFromSale(commercialModal.valor_negociacao),
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
    if (requiresStatusMoveModal(status)) {
      commercialPayload = await requestCommercialPayload(currentLead, status);
      if (commercialPayload === null && requiresStatusMoveModal(status) && !(requiresCommercialData(status) && parseCurrencyInput(currentLead.valor_negociacao) > 0)) return;
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
    if (response.ok && status === 'Venda realizada') {
      setFinanceRedirect({ leadId, leadName: currentLead.nome });
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
    if (!profile?.corretor_id) return;

    setSavingCrm(true);
    const { error: updateError } = await supabase
      .from('corretores')
      .update({ crm_api_url: crmApiUrl || null })
      .eq('id', profile.corretor_id);

    setSavingCrm(false);
    if (updateError) {
      alert('Nao consegui salvar a conexao agora. Tente novamente em instantes ou avise a equipe Orion.');
      return;
    }

    setShowCrmModal(false);
  };

  const importSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.corretor_id || !sheetUrl.trim()) {
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
        corretor_id: profile.corretor_id,
        sheet_url: sheetUrl,
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
    setImportMessage(`${payload.imported} lead(s) importado(s).${paginasText}${incompleteText}${skippedText}`);
    setSheetUrl('');
    await fetchLeads(0, false);
  };

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
    const adsetMatch = adsetFilter === 'todos' || leadAdset(lead) === adsetFilter;
    const adMatch = adFilter === 'todos' || leadAd(lead) === adFilter;
    const leadDate = lead.data_entrada ? new Date(lead.data_entrada) : null;
    const dateTypeMatch =
      dateFilterType === 'todos' ||
      (dateFilterType === 'com_data' && lead.data_entrada !== null) ||
      (dateFilterType === 'sem_data' && lead.data_entrada === null);
    const fromMatch = !dateFrom || (leadDate && leadDate >= new Date(dateFrom));
    const toMatch = !dateTo || (leadDate && leadDate <= new Date(dateTo + 'T23:59:59'));

    return searchMatch && cnpjMatch && statusMatch && operadoraMatch && campaignMatch && adsetMatch && adMatch && dateTypeMatch && fromMatch && toMatch;
  });

  const filterOptions = (values: string[]) => Array.from(new Set(values.filter((value) => value && value !== '-'))).sort((a, b) => a.localeCompare(b));

  const sheetTabs = useMemo(() => {
    const fromLeads = leads
      .map((lead) => tabLabel(lead.operadora))
      .filter((operadora) => operadora !== 'Sem aba');
    return Array.from(new Set(fromLeads)).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const campaignOptions = useMemo(() => filterOptions(leads.map(leadCampaign)), [leads]);
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
    dateFilterType !== 'todos' ||
    cnpjFilter !== 'todos' ||
    statusFilter !== 'todos' ||
    operadoraFilter !== 'todas' ||
    campaignFilter !== 'todos' ||
    adsetFilter !== 'todos' ||
    adFilter !== 'todos'
  );

  const clearFilters = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setDateFilterType('todos');
    setCnpjFilter('todos');
    setStatusFilter('todos');
    setOperadoraFilter('todas');
    setCampaignFilter('todos');
    setAdsetFilter('todos');
    setAdFilter('todos');
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
      const vendas = memberLeads.filter((lead) => normalizeLeadStatus(lead.status) === 'Venda realizada').length;
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
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Leads</h1>
          <p className="font-medium text-gray-500">Lista detalhada com filtros, status comercial, página de origem e UTMs.</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 md:w-auto">
          <button
            onClick={() => setShowCrmModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 font-black text-blue-600 transition-all hover:bg-blue-100"
          >
            <Plug size={18} /> Conectar CRM
          </button>
          <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white px-5 py-3 font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50">
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

      <div className="orion-panel mb-6 p-4 sm:p-5">
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
            <option value="todos">Data: todos</option>
            <option value="com_data">Apenas com data</option>
            <option value="sem_data">Sem data</option>
          </select>
          <select value={cnpjFilter} onChange={(e) => setCnpjFilter(e.target.value)} className="orion-control min-w-[170px] flex-[1_1_170px] px-4 py-3.5 text-sm">
            <option value="todos">CNPJ: todos</option>
            <option value="com">Com CNPJ</option>
            <option value="sem">Sem CNPJ</option>
            <option value="nao_informado">Nao informado</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="orion-control min-w-[220px] flex-[1_1_220px] px-4 py-3.5 text-sm">
            <option value="todos">Todos os status</option>
            {LEAD_STATUSES.map(status => <option key={status} value={status}>{getLeadStatusStyle(status).label}</option>)}
          </select>
          <select value={operadoraFilter} onChange={(e) => setOperadoraFilter(e.target.value)} className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm">
            <option value="todas">Página: todas</option>
            {sheetTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
            <option value="__sem_aba__">Sem página</option>
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
        </div>
      </div>

      <div className="orion-table-shell overflow-hidden">
        <div className="scrollbar-visible max-h-[calc(100dvh-300px)] overflow-auto sm:max-h-[calc(100vh-330px)]">
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
            <table className="w-full min-w-[2700px] border-collapse text-left text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100">
                  <th className="w-12 border border-slate-200 px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Data</th>
                  <th className="min-w-[240px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Nome</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Telefone</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Idades</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Possui CNPJ</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Tem plano ativo?</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Plano atual</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Investimento pretendido</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Cidade</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Valor negociação</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Etiqueta</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Operadora venda</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Comissão</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th>
                  <th className="min-w-[150px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Página / Operadora</th>
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
                    <td colSpan={isViewingAsCorretor ? 22 : 21} className="py-20 text-center">
                      <Loader2 className="mx-auto animate-spin text-blue-600" size={40} />
                    </td>
                  </tr>
                ) : filteredLeads.map((lead, index) => {
                  const statusStyle = getLeadStatusStyle(lead.status);
                  const leadTab = tabLabel(lead.operadora);
                  const importWarnings = getLeadImportWarnings(lead);
                  const cleanObservacoes = cleanLeadObservationText(lead.observacoes);

                  return (
                  <tr key={lead.id} className="transition-colors border-b border-slate-100 dark:border-white/5 hover:bg-blue-50/50 dark:hover:bg-blue-500/10">
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
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">{lead.valor_negociacao ? formatCurrencyValue(lead.valor_negociacao) : '-'}</td>
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
                    <td className="border border-slate-100 px-3 py-3 font-bold text-blue-700">{lead.valor_comissao ? formatCurrencyValue(lead.valor_comissao) : '-'}</td>
                    <td className="border border-slate-100 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={lead.status}
                          onChange={(e) => updateLeadStatus(lead.id, e.target.value as LeadStatus)}
                          className={`orion-status-select border px-3 py-2 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-blue-500/20 ${statusStyle.chip}`}
                        >
                          {LEAD_STATUSES.map(status => <option key={status} value={status}>{getLeadStatusStyle(status).label}</option>)}
                        </select>
                        {savingStatusId === lead.id && <Loader2 className="animate-spin text-blue-600" size={16} />}
                      </div>
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-black text-slate-600">{leadTab}</td>
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
                    <td className="border border-slate-100 px-3 py-3 text-xs font-bold text-slate-600">{leadAd(lead)}</td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-medium leading-relaxed text-slate-600">
                      <div className="max-w-[300px] whitespace-normal">
                        {cleanObservacoes || '-'}
                      </div>
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

      {showImportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md sm:p-6">
          <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white shadow-2xl sm:rounded-[2.5rem]">
            <div className="flex items-center justify-between border-b border-gray-100 p-5 sm:p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-emerald-600">Admin</p>
                <h2 className="text-xl font-black text-gray-900">Importar planilha</h2>
              </div>
              <button onClick={() => setShowImportModal(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={22} />
              </button>
            </div>
            <form onSubmit={importSheet} className="space-y-5 p-5 sm:p-8">
              {importMessage && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-black text-emerald-700">
                  {importMessage}
                </div>
              )}
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Link do Google Sheets</label>
                <input
                  type="url"
                  required
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button disabled={importing} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 py-5 font-black text-white shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50">
                {importing ? <Loader2 className="animate-spin" size={20} /> : <><Upload size={18} /> Importar leads</>}
              </button>
            </form>
          </div>
        </div>
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
                <h2 className="mt-1 text-2xl font-black text-slate-950">Avancar para {getLeadStatusStyle(commercialModal.status).label}</h2>
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
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-emerald-700">Comissão calculada automaticamente</span>
                  <p className="text-lg font-black text-emerald-800">{formatCurrencyValue(calculateCommissionFromSale(commercialModal.valor_negociacao))}</p>
                  <p className="mt-1 text-xs font-bold text-emerald-700">250% sobre o valor da negociação.</p>
                </div>
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
      {financeRedirect && (
        <SaleFinanceRedirect
          leadId={financeRedirect.leadId}
          leadName={financeRedirect.leadName}
          onCancel={() => setFinanceRedirect(null)}
        />
      )}
    </InternalLayout>
  );
}
