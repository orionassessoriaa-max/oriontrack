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
  RotateCcw
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
      const { data, error: supabaseError } = await supabase
        .from('leads')
        .select('*')
        .eq('corretor_id', profile.corretor_id)
        .order('data_entrada', { ascending: false });

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
    setSavingStatusId(leadId);
    setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, status } : lead));

    const { error: updateError } = await supabase
      .from('leads')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateError) {
      alert('Erro ao atualizar status: ' + updateError.message);
      fetchLeads();
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
    const leadDate = lead.data_entrada ? new Date(lead.data_entrada) : null;
    const fromMatch = !dateFrom || (leadDate && leadDate >= new Date(dateFrom));
    const toMatch = !dateTo || (leadDate && leadDate <= new Date(dateTo + 'T23:59:59'));

    return searchMatch && cnpjMatch && statusMatch && operadoraMatch && fromMatch && toMatch;
  });

  const sheetTabs = useMemo(() => {
    const fromLeads = leads
      .map((lead) => tabLabel(lead.operadora))
      .filter((operadora) => operadora !== 'Sem aba');
    return Array.from(new Set(fromLeads)).sort((a, b) => a.localeCompare(b));
  }, [leads]);

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
    operadoraFilter !== 'todas'
  );

  const clearFilters = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setCnpjFilter('todos');
    setStatusFilter('todos');
    setOperadoraFilter('todas');
  };

  return (
    <InternalLayout>
      <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Planilha</h1>
          <p className="font-medium text-gray-500">Lista detalhada com filtros, status comercial, aba de origem e UTMs.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowCrmModal(true)}
            className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 font-black text-blue-600 transition-all hover:bg-blue-100"
          >
            <Plug size={18} /> Conectar CRM
          </button>
          <button className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-5 py-3 font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50">
            <Download size={18} /> Exportar
          </button>
          {isViewingAsCorretor && (
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-3 font-black text-emerald-700 transition-all hover:bg-emerald-100"
            >
              <Upload size={18} /> Importar
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.7fr_160px_160px_170px_230px_220px_auto]">
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
        <div className="scrollbar-visible overflow-x-scroll">
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
            <table className="w-full min-w-[1720px] border-collapse text-left text-[13px]">
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
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Custo atual</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Investimento pretendido</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Cidade</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th>
                  <th className="min-w-[150px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Página / Operadora</th>
                  <th className="min-w-[280px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Observações / UTMs</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={14} className="py-20 text-center">
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
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">{lead.custo_plano_atual || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3 font-bold text-slate-600">{lead.investimento || '-'}</td>
                    <td className="border border-slate-100 px-3 py-3 font-medium text-slate-500">{lead.cidade || '-'}</td>
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
                    <td className="border border-slate-100 px-3 py-3 text-xs font-medium leading-relaxed text-slate-600">
                      <div className="max-w-[300px] whitespace-normal">
                        {lead.observacoes || '-'}
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto border-t border-slate-200 bg-slate-100 px-4 py-2">
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-6 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-[2.5rem] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-600">Integracao</p>
                <h2 className="text-xl font-black text-gray-900">Conectar CRM</h2>
              </div>
              <button onClick={() => setShowCrmModal(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={22} />
              </button>
            </div>
            <form onSubmit={saveCrmConfig} className="space-y-5 p-8">
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-6 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-[2.5rem] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-emerald-600">Admin</p>
                <h2 className="text-xl font-black text-gray-900">Importar planilha</h2>
              </div>
              <button onClick={() => setShowImportModal(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={22} />
              </button>
            </div>
            <form onSubmit={importSheet} className="space-y-5 p-8">
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
