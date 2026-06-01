'use client';

import { useEffect, useState, useMemo } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { AlertCircle, Download, Loader2, RefreshCw, Search, ShieldAlert, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import PhoneAction from '@/components/ui/PhoneAction';
import { getLeadStatusStyle, LEAD_STATUSES } from '@/lib/leadStatus';

type TrafficLead = Lead & {
  corretores?: {
    nome: string;
  } | null;
};

type CorretorOption = {
  id: string;
  nome: string;
};

function cnpjCategory(value?: string | null) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.includes('nao informado')) return 'nao_informado';
  if (normalized.includes('nao')) return 'sem';
  if (normalized.includes('sim') || normalized.includes('mei') || normalized.includes('cnpj')) return 'com';
  return 'nao_informado';
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
  return lead.utm_medium || noteValue(lead, 'utm_medium') || '-';
}

function leadAd(lead: Lead) {
  return lead.utm_content || noteValue(lead, 'utm_content') || '-';
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sheetTabLabel(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('{{')) return 'Sem aba';
  const normalized = normalizeText(raw);
  const known: Array<[string, string]> = [
    ['bradesco', 'BRADESCO'],
    ['amil', 'AMIL'],
    ['sulamerica', 'SULAMERICA'],
    ['sul america', 'SULAMERICA'],
    ['porto', 'PORTO'],
    ['medsenior', 'MEDSENIOR'],
    ['hapvida', 'HAPVIDA'],
    ['alice', 'ALICE'],
    ['odontoprev', 'ODONTOPREV'],
    ['aurora', 'AURORA'],
    ['sao lucas', 'SAO LUCAS'],
  ];
  const found = known.find(([key]) => normalized.includes(key));
  return found?.[1] || raw;
}

export default function TrafficLeadsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<TrafficLead[]>([]);
  const [corretores, setCorretores] = useState<CorretorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCorretorId, setSelectedCorretorId] = useState('todos');

  // Filtros Premium do Leads Screen
  const [cnpjFilter, setCnpjFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateFilterType, setDateFilterType] = useState('todos');
  const [operadoraFilter, setOperadoraFilter] = useState('todas');
  const [campaignFilter, setCampaignFilter] = useState('todos');
  const [adsetFilter, setAdsetFilter] = useState('todos');
  const [adFilter, setAdFilter] = useState('todos');

  async function fetchLeads() {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch(`/api/trafego/leads?gestor_id=${encodeURIComponent(profile.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Erro ao carregar leads vinculados a sua gestao.');
      }

      setCorretores((payload.corretores || []) as CorretorOption[]);
      setLeads((payload.leads || []) as TrafficLead[]);
    } catch (err: unknown) {
      console.error('Error fetching traffic leads:', err);
      const errorMessage = err instanceof Error ? err.message : '';
      const errorCode = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';

      if (errorCode === '42501' || errorMessage.toLowerCase().includes('row-level security')) {
        setError('Acesso negado: voce nao tem permissao para visualizar estes leads.');
      } else {
        setError('Erro ao carregar leads vinculados a sua gestao.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile) return;

    if (profile.tipo_usuario === 'admin') {
      router.push('/admin/leads');
      return;
    }

    if (profile.tipo_usuario !== 'gestor_trafego') {
      router.push('/dashboard');
      return;
    }

    void Promise.resolve().then(fetchLeads);
  }, [profile]);

  const filteredLeads = leads.filter(lead => {
    const matchesCorretor = selectedCorretorId === 'todos' || lead.corretor_id === selectedCorretorId;
    if (!matchesCorretor) return false;

    const leadTab = sheetTabLabel(lead.operadora);
    const term = searchTerm.toLowerCase();
    const searchMatch =
      (lead.nome?.toLowerCase() || '').includes(term) ||
      (lead.telefone || '').includes(searchTerm) ||
      (lead.cidade?.toLowerCase() || '').includes(term) ||
      (lead.corretores?.nome?.toLowerCase() || '').includes(term) ||
      (lead.operadora?.toLowerCase() || '').includes(term) ||
      (lead.observacoes?.toLowerCase() || '').includes(term);

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
      .map((lead) => sheetTabLabel(lead.operadora))
      .filter((operadora) => operadora !== 'Sem aba');
    return Array.from(new Set(fromLeads)).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const campaignOptions = useMemo(() => filterOptions(leads.map(leadCampaign)), [leads]);
  const adsetOptions = useMemo(() => filterOptions(leads.map(leadAdset)), [leads]);
  const adOptions = useMemo(() => filterOptions(leads.map(leadAd)), [leads]);

  const clearFilters = () => {
    setSearchTerm('');
    setCnpjFilter('todos');
    setStatusFilter('todos');
    setDateFrom('');
    setDateTo('');
    setDateFilterType('todos');
    setOperadoraFilter('todas');
    setCampaignFilter('todos');
    setAdsetFilter('todos');
    setAdFilter('todos');
  };

  const hasActiveFilters =
    searchTerm !== '' ||
    cnpjFilter !== 'todos' ||
    statusFilter !== 'todos' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    dateFilterType !== 'todos' ||
    operadoraFilter !== 'todas' ||
    campaignFilter !== 'todos' ||
    adsetFilter !== 'todos' ||
    adFilter !== 'todos';

  return (
    <InternalLayout>
      <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Planilhas dos Corretores</h1>
          <p className="font-medium text-gray-500">Selecione o corretor e veja a planilha com origem da aba, status e UTMs.</p>
        </div>
        <button className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-6 py-3 font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50">
          <Download size={18} /> Exportar
        </button>
      </div>

      <div className="orion-panel mb-6 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* Corretor Selector */}
          <select
            value={selectedCorretorId}
            onChange={(event) => setSelectedCorretorId(event.target.value)}
            className="orion-control min-w-[200px] flex-[1_1_200px] px-4 py-3.5 text-sm font-black"
          >
            <option value="todos">Todos os corretores</option>
            {corretores.map((corretor) => (
              <option key={corretor.id} value={corretor.id}>{corretor.nome}</option>
            ))}
          </select>

          {/* Search Term */}
          <div className="relative min-w-[260px] flex-[1_1_320px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por lead, telefone, cidade, corretor, aba ou UTM..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="orion-control w-full py-3.5 pl-12 pr-4 text-sm transition-all"
            />
          </div>

          {/* Dates */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="orion-control min-w-[165px] flex-[0_0_165px] px-4 py-3.5 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="orion-control min-w-[165px] flex-[0_0_165px] px-4 py-3.5 text-sm"
          />

          {/* Date filter type */}
          <select
            value={dateFilterType}
            onChange={(e) => setDateFilterType(e.target.value)}
            className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm"
          >
            <option value="todos">Data: todos</option>
            <option value="com_data">Apenas com data</option>
            <option value="sem_data">Sem data</option>
          </select>

          {/* CNPJ Filter */}
          <select
            value={cnpjFilter}
            onChange={(e) => setCnpjFilter(e.target.value)}
            className="orion-control min-w-[170px] flex-[1_1_170px] px-4 py-3.5 text-sm"
          >
            <option value="todos">CNPJ: todos</option>
            <option value="com">Com CNPJ</option>
            <option value="sem">Sem CNPJ</option>
            <option value="nao_informado">Nao informado</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="orion-control min-w-[220px] flex-[1_1_220px] px-4 py-3.5 text-sm"
          >
            <option value="todos">Todos os status</option>
            {LEAD_STATUSES.map(status => (
              <option key={status} value={status}>
                {getLeadStatusStyle(status).label}
              </option>
            ))}
          </select>

          {/* Page/Operadora Filter */}
          <select
            value={operadoraFilter}
            onChange={(e) => setOperadoraFilter(e.target.value)}
            className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm"
          >
            <option value="todas">Página: todas</option>
            {sheetTabs.map((tab) => (
              <option key={tab} value={tab}>{tab}</option>
            ))}
            <option value="__sem_aba__">Sem página</option>
          </select>

          {/* Campaign Filter */}
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm"
          >
            <option value="todos">Campanha: todas</option>
            {campaignOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>

          {/* Adset Filter */}
          <select
            value={adsetFilter}
            onChange={(e) => setAdsetFilter(e.target.value)}
            className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm"
          >
            <option value="todos">Conjunto: todos</option>
            {adsetOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>

          {/* Ad Filter */}
          <select
            value={adFilter}
            onChange={(e) => setAdFilter(e.target.value)}
            className="orion-control min-w-[210px] flex-[1_1_210px] px-4 py-3.5 text-sm"
          >
            <option value="todos">Anuncio: todos</option>
            {adOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>

          {/* Refresh and Clear Actions */}
          <div className="flex gap-2 min-h-[50px] items-center">
            <button
              onClick={fetchLeads}
              className="flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-slate-100 px-5 font-black text-slate-600 transition-all hover:bg-slate-200"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="flex min-h-[50px] min-w-[120px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-600 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={15} /> Limpar
            </button>
          </div>
        </div>

        {/* Lead Count Badge and Active Chips */}
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
          <span className="orion-chip bg-slate-100 text-slate-600">
            {filteredLeads.length} de {leads.length} leads
          </span>
          <span className="orion-chip bg-blue-50 text-blue-700">
            Página: {operadoraFilter === 'todas' ? 'todas' : operadoraFilter === '__sem_aba__' ? 'sem página' : operadoraFilter}
          </span>
          {cnpjFilter !== 'todos' && (
            <span className="orion-chip bg-amber-50 text-amber-700">
              CNPJ: {cnpjFilter === 'com' ? 'com CNPJ' : cnpjFilter === 'sem' ? 'sem CNPJ' : 'nao informado'}
            </span>
          )}
        </div>
      </div>

      <div className="orion-table-shell overflow-hidden">
        <div className="scrollbar-visible max-h-[calc(100vh-330px)] overflow-auto">
          {error ? (
            <div className="py-24 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <ShieldAlert size={32} />
              </div>
              <h3 className="mb-2 text-xl font-bold text-gray-900">Acesso restrito</h3>
              <p className="mx-auto mb-6 max-w-md font-medium text-red-500">{error}</p>
              <button onClick={fetchLeads} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 hover:underline">
                <RefreshCw size={14} /> Tentar novamente
              </button>
            </div>
          ) : (
            <table className="w-full min-w-[2200px] border-collapse text-left text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100">
                  <th className="w-12 border border-slate-200 px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Data</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Corretor</th>
                  <th className="min-w-[240px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Lead</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Telefone</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Idades</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">CNPJ</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Tem plano ativo?</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Cidade</th>
                  <th className="border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Investimento</th>
                  <th className="border border-slate-200 px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th>
                  <th className="min-w-[150px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Página / Operadora</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Campanha</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Conjunto</th>
                  <th className="min-w-[220px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Anuncio</th>
                  <th className="min-w-[280px] border border-slate-200 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Observações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={16} className="py-20 text-center">
                      <Loader2 className="mx-auto animate-spin text-blue-600" size={40} />
                    </td>
                  </tr>
                ) : filteredLeads.map((lead, index) => {
                  const statusStyle = getLeadStatusStyle(lead.status);
                  
                  return (
                    <tr key={lead.id} className="transition-colors border-b border-slate-100 hover:bg-blue-50/30">
                      <td className="border border-slate-100 bg-slate-50 px-3 py-3 text-center text-xs font-black text-slate-400">{index + 1}</td>
                      <td className="border border-slate-100 px-3 py-3 text-[13px] font-bold text-slate-500">
                        {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}
                      </td>
                      <td className="border border-slate-100 px-3 py-3 text-sm font-bold text-slate-600">{lead.corretores?.nome || '-'}</td>
                      <td className="border border-slate-100 px-3 py-3"><p className="text-sm font-bold text-gray-900">{lead.nome}</p></td>
                      <td className="border border-slate-100 px-3 py-3 text-sm font-medium text-slate-600">
                        <PhoneAction phone={lead.telefone} />
                      </td>
                      <td className="border border-slate-100 px-3 py-3 text-sm font-bold text-slate-500">{lead.idades || '-'}</td>
                      <td className="border border-slate-100 px-3 py-3">
                        <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                          cnpjCategory(lead.possui_cnpj) === 'com' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' :
                          cnpjCategory(lead.possui_cnpj) === 'sem' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-100' :
                          'bg-slate-50 text-slate-500 ring-1 ring-slate-100'
                        }`}>
                          {lead.possui_cnpj || 'Nao informado'}
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
                      <td className="border border-slate-100 px-3 py-3 text-sm font-medium text-slate-500">{lead.cidade || '-'}</td>
                      <td className="border border-slate-100 px-3 py-3 text-sm font-bold text-slate-600">{lead.investimento || '-'}</td>
                      <td className="border border-slate-100 px-3 py-3 text-center">
                        <span className={`inline-block rounded-full px-3 py-1.5 text-[9px] font-black uppercase tracking-widest ${statusStyle.chip}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="border border-slate-100 px-3 py-3 text-xs font-black uppercase tracking-widest text-slate-600">{sheetTabLabel(lead.operadora)}</td>
                      <td className="border border-slate-100 px-3 py-3 text-xs font-medium text-slate-600">{leadCampaign(lead)}</td>
                      <td className="border border-slate-100 px-3 py-3 text-xs font-medium text-slate-600">{leadAdset(lead)}</td>
                      <td className="border border-slate-100 px-3 py-3 text-xs font-medium text-slate-600">{leadAd(lead)}</td>
                      <td className="border border-slate-100 px-3 py-3 text-xs font-bold leading-relaxed text-slate-500">
                        <div className="max-w-[380px] whitespace-normal">{lead.observacoes || '-'}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
    </InternalLayout>
  );
}
