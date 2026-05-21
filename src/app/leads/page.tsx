'use client';

import { useState, useEffect, useMemo } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import {
  Search,
  Download,
  Loader2,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  Plug,
  X,
  Save,
  Upload,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadStatus } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getLeadStatusStyle, LEAD_STATUSES, normalizeLeadStatus } from '@/lib/leadStatus';
import PhoneAction from '@/components/ui/PhoneAction';

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
  'Sem interesse',
];

const READY_LABELS = ['Amil bronze', 'Amil platinum', 'Porto p470', 'Outra etiqueta'];

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

function requiresCommercialData(status: LeadStatus) {
  return COMMERCIAL_REQUIRED_STATUSES.includes(status);
}

function collectCommercialPayload(lead: Lead, status: LeadStatus) {
  if (!requiresCommercialData(status)) return null;

  const valorNegociacao = window.prompt('Valor da negociação. Ex: 1200', String(lead.valor_negociacao || ''));
  if (!valorNegociacao) return null;

  const operadoraNegociacao = window.prompt('Operadora da negociação. Ex: Amil, Bradesco, Porto', lead.operadora_negociacao || lead.operadora || '');
  if (!operadoraNegociacao) return null;

  const valorComissao = window.prompt('Valor da comissão. Ex: 240', String(lead.valor_comissao || ''));
  if (!valorComissao) return null;

  const payload = {
    valor_negociacao: parseCurrencyInput(valorNegociacao),
    operadora_negociacao: operadoraNegociacao.trim(),
    valor_comissao: parseCurrencyInput(valorComissao),
  };

  if (!payload.valor_negociacao || !payload.operadora_negociacao || !payload.valor_comissao) {
    alert('Para avançar para negociação em diante, preencha valor da negociação, operadora e comissão.');
    return null;
  }

  return payload;
}

function noteValue(lead: Lead, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(lead.observacoes || '').match(new RegExp(`${escaped}:\\s*([^|]+)`, 'i'));
  return match?.[1]?.trim() || '';
}

function leadCampaign(lead: Lead) {
  return lead.utm_campaign || noteValue(lead, 'utm_campaign') || '-';
}

function leadAdset(lead: Lead) {
  return lead.utm_term || noteValue(lead, 'utm_term') || '-';
}

function leadAd(lead: Lead) {
  return lead.utm_content || noteValue(lead, 'utm_content') || '-';
}

export default function BrokerLeadsPage() {
  const { profile, isViewingAsCorretor } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [savingCrm, setSavingCrm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [cnpjFilter, setCnpjFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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

  useEffect(() => {
    const urlStatus = new URLSearchParams(window.location.search).get('status');
    if (urlStatus) setStatusFilter(urlStatus);
  }, []);

  useEffect(() => {
    if (profile?.corretor_id) {
      fetchLeads();
      fetchCrmConfig();
    }
  }, [profile?.corretor_id]);

  const fetchLeads = async () => {
    if (!profile?.corretor_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let leadsQuery = supabase
        .from('leads')
        .select('*, responsavel_membro:responsavel_membro_id(nome,email)')
        .eq('corretor_id', profile.corretor_id)
        .order('data_entrada', { ascending: false });

      if (profile.tipo_usuario === 'corretor_membro') {
        leadsQuery = leadsQuery.eq('responsavel_profile_id', profile.id);
      }

      const { data, error: supabaseError } = await leadsQuery;

      if (supabaseError) {
        console.error('RLS/DB Error:', supabaseError);
        if (supabaseError.code === '42501' || supabaseError.message?.toLowerCase().includes('row-level security')) {
          setError('Acesso Negado (RLS): voce nao tem permissao para visualizar estes leads.');
        } else {
          setError('Erro ao buscar leads: ' + supabaseError.message);
        }
        return;
      }

      setLeads((data || []).map((lead) => ({ ...lead, status: normalizeLeadStatus(lead.status) })));
    } catch (err) {
      console.error('Catch Error:', err);
      setError('Erro inesperado ao carregar leads.');
    } finally {
      setLoading(false);
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

  const updateLeadStatus = async (leadId: string, status: LeadStatus) => {
    const currentLead = leads.find((lead) => lead.id === leadId);
    if (!currentLead) return;

    const commercialPayload = collectCommercialPayload(currentLead, status);
    if (requiresCommercialData(status) && !commercialPayload) return;

    setSavingStatusId(leadId);
    const optimisticPayload = { ...(commercialPayload || {}), status };
    setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, ...optimisticPayload } : lead));

    const { error: updateError } = await supabase
      .from('leads')
      .update({ ...optimisticPayload, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateError) {
      alert('Erro ao atualizar status: ' + updateError.message);
      fetchLeads();
    }
    setSavingStatusId(null);
  };

  const deleteLead = async (lead: Lead) => {
    if (!isViewingAsCorretor) return;
    if (!window.confirm(`Remover o lead ${lead.nome}? Essa ação só deve ser usada por admin.`)) return;

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
      alert('Erro ao salvar CRM. Aplique a migration crm_api_url no Supabase.');
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

    const skippedText = payload.skipped ? ` ${payload.skipped} linha(s) ignorada(s).` : '';
    const paginasText = payload.paginas ? ` ${payload.paginas} pagina(s) lida(s).` : '';
    setImportMessage(`${payload.imported} lead(s) importado(s).${paginasText}${skippedText}`);
    setSheetUrl('');
    await fetchLeads();
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
    const fromMatch = !dateFrom || (leadDate && leadDate >= new Date(dateFrom));
    const toMatch = !dateTo || (leadDate && leadDate <= new Date(dateTo + 'T23:59:59'));

    return searchMatch && cnpjMatch && statusMatch && operadoraMatch && campaignMatch && adsetMatch && adMatch && fromMatch && toMatch;
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
    setCnpjFilter('todos');
    setStatusFilter('todos');
    setOperadoraFilter('todas');
    setCampaignFilter('todos');
    setAdsetFilter('todos');
    setAdFilter('todos');
  };

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

      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1.7fr_160px_160px_170px_220px_200px_200px_200px_auto]">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por nome, telefone ou cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border-none bg-slate-50 py-4 pl-12 pr-4 text-sm font-medium transition-all focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
          <select value={cnpjFilter} onChange={(e) => setCnpjFilter(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
            <option value="todos">CNPJ: todos</option>
            <option value="com">Com CNPJ</option>
            <option value="sem">Sem CNPJ</option>
            <option value="nao_informado">Nao informado</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
            <option value="todos">Todos os status</option>
            {LEAD_STATUSES.map(status => <option key={status} value={status}>{getLeadStatusStyle(status).label}</option>)}
          </select>
          <select value={operadoraFilter} onChange={(e) => setOperadoraFilter(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
            <option value="todas">Página: todas</option>
            {sheetTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
            <option value="__sem_aba__">Sem página</option>
          </select>
          <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
            <option value="todos">Campanha: todas</option>
            {campaignOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={adsetFilter} onChange={(e) => setAdsetFilter(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
            <option value="todos">Conjunto: todos</option>
            {adsetOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={adFilter} onChange={(e) => setAdFilter(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
            <option value="todos">Anúncio: todos</option>
            {adOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={15} /> Limpar
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-2">{filteredLeads.length} de {leads.length} leads</span>
          <span className="rounded-full bg-blue-50 px-3 py-2 text-blue-700">
            Página: {operadoraFilter === 'todas' ? 'todas' : operadoraFilter === '__sem_aba__' ? 'sem página' : operadoraFilter}
          </span>
          <span className="rounded-full bg-amber-50 px-3 py-2 text-amber-700">
            CNPJ: {cnpjFilter === 'todos' ? 'todos' : cnpjFilter === 'com' ? 'com CNPJ' : cnpjFilter === 'sem' ? 'sem CNPJ' : 'nao informado'}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="scrollbar-visible max-h-[calc(100dvh-300px)] overflow-auto sm:max-h-[calc(100vh-330px)]">
          {error ? (
            <div className="py-24 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <ShieldAlert size={32} />
              </div>
              <h3 className="mb-2 text-xl font-bold text-gray-900">Ops! Algo deu errado.</h3>
              <p className="mx-auto mb-6 max-w-md font-medium text-red-500">{error}</p>
              <button onClick={fetchLeads} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 hover:underline">
                <RefreshCw size={14} /> Tentar novamente
              </button>
            </div>
          ) : (
            <table className="w-full min-w-[2540px] border-collapse text-left text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100">
                  <th className="w-12 border border-slate-200 px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Data</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Nome</th>
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
                  <th className="min-w-[180px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">ResponsÃ¡vel</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Campanha</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Conjunto de anúncio</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Anúncio</th>
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

                  return (
                  <tr key={lead.id} className="transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/50">
                    <td className="border border-slate-100 bg-slate-50 px-3 py-3 text-center text-xs font-black text-slate-400">{index + 1}</td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">
                      {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-gray-900">{lead.nome}</td>
                    <td className="border border-slate-100 px-3 py-3 font-medium text-slate-600">
                      <PhoneAction phone={lead.telefone} />
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">{lead.idades || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3">
                      <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${cnpjBadgeStyle(lead.possui_cnpj)}`}>
                        {cnpjLabel(lead.possui_cnpj)}
                      </span>
                    </td>
                    <td className="border border-slate-100 px-3 py-3">
                      <span className={`inline-flex max-w-[210px] whitespace-normal rounded-lg px-3 py-2 text-[11px] font-black uppercase leading-relaxed tracking-widest ${
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
                          className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-blue-500/20 ${statusStyle.chip}`}
                        >
                          {LEAD_STATUSES.map(status => <option key={status} value={status}>{getLeadStatusStyle(status).label}</option>)}
                        </select>
                        {savingStatusId === lead.id && <Loader2 className="animate-spin text-blue-600" size={16} />}
                      </div>
                    </td>
                    <td className="border border-slate-100 px-3 py-3 font-black text-slate-600">{leadTab}</td>
                    <td className="border border-slate-100 px-3 py-3">
                      <div className="max-w-[170px] truncate text-xs font-black text-slate-700">
                        {lead.responsavel_membro?.nome || '-'}
                      </div>
                      {lead.responsavel_membro?.email && (
                        <div className="max-w-[170px] truncate text-[10px] font-bold text-slate-400">
                          {lead.responsavel_membro.email}
                        </div>
                      )}
                    </td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-bold text-slate-600">{leadCampaign(lead)}</td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-bold text-slate-600">{leadAdset(lead)}</td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-bold text-slate-600">{leadAd(lead)}</td>
                    <td className="border border-slate-100 px-3 py-3 text-xs font-medium leading-relaxed text-slate-600">
                      <div className="max-w-[300px] whitespace-normal">
                        {lead.observacoes || '-'}
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

      {showCrmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md sm:p-6">
          <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white shadow-2xl sm:rounded-[2.5rem]">
            <div className="flex items-center justify-between border-b border-gray-100 p-5 sm:p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-600">Integracao</p>
                <h2 className="text-xl font-black text-gray-900">Conectar CRM</h2>
              </div>
              <button onClick={() => setShowCrmModal(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={22} />
              </button>
            </div>
            <form onSubmit={saveCrmConfig} className="space-y-5 p-5 sm:p-8">
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Link da API / Webhook do CRM</label>
                <input
                  type="url"
                  value={crmApiUrl}
                  onChange={(e) => setCrmApiUrl(e.target.value)}
                  placeholder="https://seu-crm.com/webhook/orion"
                  className="w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500"
                />
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
    </InternalLayout>
  );
}
