'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { AlertCircle, Download, Loader2, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Lead } from '@/types';
import { getLeadStatusStyle, LEAD_STATUSES } from '@/lib/leadStatus';

type TrafficLead = Lead & {
  corretores?: {
    nome: string;
    nome_empresa?: string | null;
  } | null;
};

type CorretorOption = {
  id: string;
  nome: string;
  nome_empresa?: string | null;
};

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
  ];
  return known.find(([key]) => normalized.includes(key))?.[1] || raw;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TrafficLeadsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<TrafficLead[]>([]);
  const [corretores, setCorretores] = useState<CorretorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedConcessionaria, setSelectedConcessionaria] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [cnpjFilter, setCnpjFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [operadoraFilter, setOperadoraFilter] = useState('todas');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [dragSelecting, setDragSelecting] = useState(false);

  async function fetchLeads() {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessão expirada.');

      const response = await fetch(`/api/trafego/leads?gestor_id=${encodeURIComponent(profile.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || 'Erro ao carregar leads.');

      setCorretores((payload.corretores || []) as CorretorOption[]);
      setLeads((payload.leads || []) as TrafficLead[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar leads.');
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
    void fetchLeads();
  }, [profile?.id]);

  const concessionarias = useMemo(() => {
    const groups = new Map<string, { key: string; nome: string; brokerIds: string[]; total: number }>();

    corretores.forEach((corretor) => {
      const nome = String(corretor.nome_empresa || corretor.nome || 'Sem concessionaria').trim();
      const key = normalizeText(nome);
      const current = groups.get(key);
      if (current) current.brokerIds.push(corretor.id);
      else groups.set(key, { key, nome, brokerIds: [corretor.id], total: 0 });
    });

    leads.forEach((lead) => {
      const nome = String(lead.corretores?.nome_empresa || lead.corretores?.nome || '').trim();
      const key = normalizeText(nome);
      const current = groups.get(key);
      if (current) current.total += 1;
    });

    return Array.from(groups.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [corretores, leads]);

  const selectedGroup = concessionarias.find((item) => item.key === selectedConcessionaria) || null;

  const sheetTabs = useMemo(() => {
    const fromLeads = leads.map((lead) => sheetTabLabel(lead.operadora)).filter((item) => item !== 'Sem aba');
    return Array.from(new Set(fromLeads)).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const filteredLeads = useMemo(() => {
    if (!selectedGroup) return [];
    const term = searchTerm.trim().toLowerCase();

    return leads.filter((lead) => {
      if (!selectedGroup.brokerIds.includes(String(lead.corretor_id || ''))) return false;
      const leadDate = lead.data_entrada ? new Date(lead.data_entrada) : null;
      const searchMatch = !term || [
        lead.nome,
        lead.telefone,
        lead.cidade,
        lead.idades,
        lead.investimento,
        lead.observacoes,
      ].join(' ').toLowerCase().includes(term);
      const fromMatch = !dateFrom || (leadDate && leadDate >= new Date(dateFrom));
      const toMatch = !dateTo || (leadDate && leadDate <= new Date(`${dateTo}T23:59:59`));
      const cnpjMatch = cnpjFilter === 'todos' || cnpjCategory(lead.possui_cnpj) === cnpjFilter;
      const statusMatch = statusFilter === 'todos' || lead.status === statusFilter;
      const pageMatch = operadoraFilter === 'todas' || sheetTabLabel(lead.operadora) === operadoraFilter;
      return searchMatch && fromMatch && toMatch && cnpjMatch && statusMatch && pageMatch;
    });
  }, [leads, selectedGroup, searchTerm, dateFrom, dateTo, cnpjFilter, statusFilter, operadoraFilter]);

  const hasFilters = Boolean(searchTerm || dateFrom || dateTo || cnpjFilter !== 'todos' || statusFilter !== 'todos' || operadoraFilter !== 'todas');

  function clearFilters() {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setCnpjFilter('todos');
    setStatusFilter('todos');
    setOperadoraFilter('todas');
  }

  function toggleSelection(id: string) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectWhileDragging(id: string) {
    if (!dragSelecting) return;
    setSelectedLeadIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function exportToCsv() {
    if (!filteredLeads.length) return alert('Nenhum lead para exportar.');
    const headers = ['Data', 'Nome', 'Telefone', 'Idades', 'Possui CNPJ', 'Cidade', 'Investimento', 'Status', 'Pagina', 'Campanha', 'Conjunto', 'Anuncio'];
    const rows = filteredLeads.map((lead) => [
      formatDate(lead.data_entrada),
      lead.nome || '',
      lead.telefone || '',
      lead.idades || '',
      lead.possui_cnpj || '',
      lead.cidade || '',
      lead.investimento || '',
      lead.status || '',
      sheetTabLabel(lead.operadora),
      leadCampaign(lead),
      leadAdset(lead),
      leadAd(lead),
    ]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leads_${selectedGroup?.nome || 'concessionaria'}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <InternalLayout>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Leads</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400">Planilha por concessionária. Os leads só aparecem depois da seleção.</p>
        </div>
        <button
          onClick={exportToCsv}
          disabled={!filteredLeads.length}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-white/10 disabled:opacity-40"
        >
          <Download size={15} /> Exportar
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
        <select
          value={selectedConcessionaria}
          onChange={(event) => {
            setSelectedConcessionaria(event.target.value);
            setSelectedLeadIds(new Set());
          }}
          className="h-9 min-w-[260px] rounded-md border border-white/10 bg-slate-950 px-3 text-xs font-black text-white outline-none focus:border-cyan-400"
        >
          <option value="">Selecionar concessionária</option>
          {concessionarias.map((item) => (
            <option key={item.key} value={item.key}>{item.nome} ({item.total})</option>
          ))}
        </select>

        <label className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar..."
            className="h-9 w-full rounded-md border border-white/10 bg-slate-950 pl-8 pr-3 text-xs font-bold text-white outline-none focus:border-cyan-400"
          />
        </label>

        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 rounded-md border border-white/10 bg-slate-950 px-3 text-xs font-bold text-white outline-none focus:border-cyan-400" />
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 rounded-md border border-white/10 bg-slate-950 px-3 text-xs font-bold text-white outline-none focus:border-cyan-400" />

        <select value={cnpjFilter} onChange={(event) => setCnpjFilter(event.target.value)} className="h-9 rounded-md border border-white/10 bg-slate-950 px-3 text-xs font-bold text-white outline-none focus:border-cyan-400">
          <option value="todos">CNPJ: todos</option>
          <option value="com">Com CNPJ</option>
          <option value="sem">Sem CNPJ</option>
          <option value="nao_informado">Não informado</option>
        </select>

        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-md border border-white/10 bg-slate-950 px-3 text-xs font-bold text-white outline-none focus:border-cyan-400">
          <option value="todos">Status: todos</option>
          {LEAD_STATUSES.map((status) => <option key={status} value={status}>{getLeadStatusStyle(status).label}</option>)}
        </select>

        <select value={operadoraFilter} onChange={(event) => setOperadoraFilter(event.target.value)} className="h-9 rounded-md border border-white/10 bg-slate-950 px-3 text-xs font-bold text-white outline-none focus:border-cyan-400">
          <option value="todas">Página: todas</option>
          {sheetTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
        </select>

        <button onClick={fetchLeads} className="grid h-9 w-9 place-items-center rounded-md bg-white/5 text-slate-300 hover:bg-white/10">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={clearFilters} disabled={!hasFilters} className="grid h-9 w-9 place-items-center rounded-md bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-40">
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
        <span>{selectedGroup ? `${filteredLeads.length} de ${selectedGroup.total} leads` : 'Selecione uma concessionária'}</span>
        {selectedGroup && <span className="rounded bg-cyan-400/10 px-2 py-1 text-cyan-300">{selectedGroup.nome}</span>}
      </div>

      <div className="relative overflow-hidden border border-white/10 bg-white">
        {!selectedGroup ? (
          <div className="flex h-[520px] flex-col items-center justify-center text-center">
            <AlertCircle className="mb-3 text-slate-300" size={36} />
            <p className="text-sm font-black text-slate-700">Escolha uma concessionária para abrir a planilha.</p>
          </div>
        ) : error ? (
          <div className="flex h-[520px] items-center justify-center text-sm font-bold text-red-600">{error}</div>
        ) : (
          <div
            className="max-h-[calc(100vh-260px)] overflow-auto"
            onMouseUp={() => setDragSelecting(false)}
            onMouseLeave={() => setDragSelecting(false)}
          >
            <table className="w-full min-w-[1480px] border-collapse text-[12px] text-black">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#1e88e5] text-white">
                  <SheetHead className="w-10 text-center">#</SheetHead>
                  <SheetHead>DATA</SheetHead>
                  <SheetHead>NOME</SheetHead>
                  <SheetHead>TELEFONE</SheetHead>
                  <SheetHead>IDADES</SheetHead>
                  <SheetHead>POSSUI CNPJ</SheetHead>
                  <SheetHead>CIDADE</SheetHead>
                  <SheetHead>INVESTIMENTO</SheetHead>
                  <SheetHead>STATUS</SheetHead>
                  <SheetHead>PÁGINA</SheetHead>
                  <SheetHead>CAMPANHA</SheetHead>
                  <SheetHead>CONJUNTO</SheetHead>
                  <SheetHead>ANÚNCIO</SheetHead>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} className="h-40 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" /></td></tr>
                ) : filteredLeads.map((lead, index) => {
                  const selected = selectedLeadIds.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      onMouseDown={() => {
                        setDragSelecting(true);
                        toggleSelection(lead.id);
                      }}
                      onMouseEnter={() => selectWhileDragging(lead.id)}
                      className={`h-6 cursor-cell select-none ${selected ? 'bg-blue-100 outline outline-1 outline-blue-500' : index % 2 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50`}
                    >
                      <SheetCell className="bg-slate-100 text-center text-slate-600">{index + 1}</SheetCell>
                      <SheetCell>{formatDate(lead.data_entrada)}</SheetCell>
                      <SheetCell strong>{lead.nome || '-'}</SheetCell>
                      <SheetCell>{lead.telefone || '-'}</SheetCell>
                      <SheetCell>{lead.idades || '-'}</SheetCell>
                      <SheetCell strong>{lead.possui_cnpj || '-'}</SheetCell>
                      <SheetCell>{lead.cidade || '-'}</SheetCell>
                      <SheetCell strong>{lead.investimento || '-'}</SheetCell>
                      <SheetCell>{getLeadStatusStyle(lead.status).label}</SheetCell>
                      <SheetCell>{sheetTabLabel(lead.operadora)}</SheetCell>
                      <SheetCell>{leadCampaign(lead)}</SheetCell>
                      <SheetCell>{leadAdset(lead)}</SheetCell>
                      <SheetCell>{leadAd(lead)}</SheetCell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selectedLeadIds.size > 0 && (
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-950 px-5 py-3 text-xs font-black text-white shadow-2xl">
            {selectedLeadIds.size} lead(s) selecionado(s)
            <button onClick={() => setSelectedLeadIds(new Set())} className="rounded-full bg-white/10 px-3 py-1 text-[10px] uppercase tracking-widest hover:bg-white/20">Limpar</button>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}

function SheetHead({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`border border-[#8bbbe8] px-2 py-0.5 text-left text-[14px] font-black leading-5 ${className}`}>{children}</th>;
}

function SheetCell({ children, strong = false, className = '' }: { children: ReactNode; strong?: boolean; className?: string }) {
  return <td className={`max-w-[220px] truncate border border-slate-300 px-2 py-0.5 leading-5 ${strong ? 'font-bold' : 'font-semibold'} ${className}`}>{children}</td>;
}
