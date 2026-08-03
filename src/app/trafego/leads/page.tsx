'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { AlertCircle, Download, Loader2, Plus, RefreshCw, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Lead } from '@/types';
import { getLeadStatusStyle, LEAD_STATUSES } from '@/lib/leadStatus';
import { useDialog } from '@/components/providers/DialogProvider';

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

const EMPTY_MANUAL_LEAD = {
  nome: '',
  telefone: '',
  cidade: '',
  origem: 'Manual',
};

const IMPORT_ORIGINS = ['Orion', 'Manual', 'Base antiga', 'Indicacao', 'Organico', 'Outro'];

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
  const { confirmDialog } = useDialog();
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
  const [showManualLeadModal, setShowManualLeadModal] = useState(false);
  const [manualLeadForm, setManualLeadForm] = useState(EMPTY_MANUAL_LEAD);
  const [creatingManualLead, setCreatingManualLead] = useState(false);
  const [manualLeadError, setManualLeadError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetOrigin, setSheetOrigin] = useState('Manual');
  const [importingSheet, setImportingSheet] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [deletingLeads, setDeletingLeads] = useState(false);

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

  async function createManualLead(event: React.FormEvent) {
    event.preventDefault();
    const corretorId = selectedGroup?.brokerIds[0];
    if (!corretorId) {
      setManualLeadError('Selecione uma concessionaria.');
      return;
    }
    if (!manualLeadForm.nome.trim() || !manualLeadForm.telefone.trim()) {
      setManualLeadError('Informe nome e telefone do lead.');
      return;
    }

    setCreatingManualLead(true);
    setManualLeadError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch('/api/admin/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          corretor_id: corretorId,
          ...manualLeadForm,
          status: 'Aguardando atendimento',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao adicionar lead.');

      setManualLeadForm(EMPTY_MANUAL_LEAD);
      setShowManualLeadModal(false);
      await fetchLeads();
    } catch (err) {
      setManualLeadError(err instanceof Error ? err.message : 'Erro ao adicionar lead.');
    } finally {
      setCreatingManualLead(false);
    }
  }

  async function importSheet(event: React.FormEvent) {
    event.preventDefault();
    const corretorId = selectedGroup?.brokerIds[0];
    if (!corretorId) {
      setImportMessage('Selecione uma concessionaria.');
      return;
    }
    if (!sheetUrl.trim()) {
      setImportMessage('Cole o link da planilha.');
      return;
    }

    setImportingSheet(true);
    setImportMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch('/api/admin/leads/import-sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          corretor_id: corretorId,
          sheet_url: sheetUrl,
          origem: sheetOrigin,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao importar planilha.');

      setImportMessage(`${payload.imported || 0} lead(s) importado(s). ${payload.duplicated || 0} duplicado(s) ignorado(s).`);
      setSheetUrl('');
      await fetchLeads();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Erro ao importar planilha.');
    } finally {
      setImportingSheet(false);
    }
  }

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

  async function deleteSelectedLeads() {
    if (selectedLeadIds.size === 0 || deletingLeads) return;
    const total = selectedLeadIds.size;
    const confirmed = await confirmDialog(
      `Excluir ${total} lead${total > 1 ? 's' : ''} selecionado${total > 1 ? 's' : ''}? Esta ação não pode ser desfeita.`,
      { title: 'Excluir leads da planilha', confirmLabel: 'Excluir definitivamente', variant: 'danger' }
    );
    if (!confirmed) return;

    setDeletingLeads(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada.');
      const ids = Array.from(selectedLeadIds);
      const response = await fetch('/api/trafego/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível excluir os leads.');
      const removed = new Set<string>(payload.ids || ids);
      setLeads((current) => current.filter((lead) => !removed.has(lead.id)));
      setSelectedLeadIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir os leads.');
    } finally {
      setDeletingLeads(false);
    }
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setManualLeadError(null);
              setShowManualLeadModal(true);
            }}
            disabled={!selectedGroup}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-xs font-black uppercase tracking-widest text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={16} /> Adicionar lead
          </button>
          <button
            type="button"
            onClick={() => {
              setImportMessage(null);
              setShowImportModal(true);
            }}
            disabled={!selectedGroup}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 text-xs font-black uppercase tracking-widest text-emerald-300 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload size={16} /> Importar planilha
          </button>
          <button
            type="button"
            onClick={exportToCsv}
            disabled={!filteredLeads.length}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-white/10 disabled:opacity-40"
          >
            <Download size={15} /> Exportar
          </button>
        </div>
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

      <div className="relative overflow-hidden border border-slate-700 bg-slate-950">
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
            <table className="w-full min-w-[1480px] border-collapse text-[12px] text-slate-100">
              <thead className="sticky top-0 z-10">
                <tr className="!bg-[#1e88e5] !text-white">
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
                      className={`h-6 cursor-cell select-none text-slate-100 transition-colors ${selected ? '!bg-blue-800 !text-white outline outline-1 outline-cyan-300' : index % 2 ? '!bg-slate-950' : '!bg-slate-900'} hover:!bg-slate-800`}
                    >
                      <SheetCell className="!bg-slate-800 text-center !text-slate-200">{index + 1}</SheetCell>
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
            <button type="button" onClick={() => void deleteSelectedLeads()} disabled={deletingLeads} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-red-600 px-4 text-[10px] uppercase tracking-widest transition hover:bg-red-500 disabled:opacity-50">
              {deletingLeads ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />} Excluir
            </button>
            <button onClick={() => setSelectedLeadIds(new Set())} className="rounded-full bg-white/10 px-3 py-1 text-[10px] uppercase tracking-widest hover:bg-white/20">Limpar</button>
          </div>
        )}
      </div>

      {showManualLeadModal ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="traffic-manual-lead-title">
          <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0b1324] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Cadastro do gestor</p>
                <h2 id="traffic-manual-lead-title" className="mt-1 text-xl font-black text-white">Adicionar lead</h2>
                <p className="mt-1 text-xs font-semibold text-slate-400">{selectedGroup?.nome}</p>
              </div>
              <button type="button" onClick={() => setShowManualLeadModal(false)} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Fechar cadastro">
                <X size={18} />
              </button>
            </header>
            <form onSubmit={createManualLead} className="space-y-4 p-5">
              {manualLeadError ? <div role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm font-bold text-red-200">{manualLeadError}</div> : null}
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-slate-300">Nome *</span>
                <input value={manualLeadForm.nome} onChange={(event) => setManualLeadForm((current) => ({ ...current, nome: event.target.value }))} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-semibold text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/10" autoFocus />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-slate-300">Telefone *</span>
                <input type="tel" value={manualLeadForm.telefone} onChange={(event) => setManualLeadForm((current) => ({ ...current, telefone: event.target.value }))} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-semibold text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/10" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-300">Cidade</span>
                  <input value={manualLeadForm.cidade} onChange={(event) => setManualLeadForm((current) => ({ ...current, cidade: event.target.value }))} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-semibold text-white outline-none focus:border-cyan-400" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-300">Origem</span>
                  <select value={manualLeadForm.origem} onChange={(event) => setManualLeadForm((current) => ({ ...current, origem: event.target.value }))} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-semibold text-white outline-none focus:border-cyan-400">
                    {IMPORT_ORIGINS.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-xs font-semibold leading-5 text-slate-500">Leads manuais ficam salvos no CRM, mas não entram na conversão Orion enquanto a origem não for “Orion” ou o filtro da dashboard não estiver em “Geral”.</p>
              <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
                <button type="button" onClick={() => setShowManualLeadModal(false)} className="min-h-11 rounded-xl px-4 text-xs font-black text-slate-400 hover:text-white">Cancelar</button>
                <button disabled={creatingManualLead} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-500 px-5 text-xs font-black text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">
                  {creatingManualLead ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  Salvar lead
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showImportModal ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="traffic-import-title">
          <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0b1324] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Importação do gestor</p>
                <h2 id="traffic-import-title" className="mt-1 text-xl font-black text-white">Importar planilha</h2>
                <p className="mt-1 text-xs font-semibold text-slate-400">{selectedGroup?.nome}</p>
              </div>
              <button type="button" onClick={() => setShowImportModal(false)} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Fechar importação">
                <X size={18} />
              </button>
            </header>
            <form onSubmit={importSheet} className="space-y-4 p-5">
              {importMessage ? <div role="status" className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm font-bold text-slate-200">{importMessage}</div> : null}
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-slate-300">Link do Google Sheets *</span>
                <input type="url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-semibold text-white outline-none placeholder:text-slate-600 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10" autoFocus />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-slate-300">Origem dos leads</span>
                <select value={sheetOrigin} onChange={(event) => setSheetOrigin(event.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-sm font-semibold text-white outline-none focus:border-emerald-400">
                  {IMPORT_ORIGINS.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
                </select>
              </label>
              <p className="text-xs font-semibold leading-5 text-slate-500">A planilha precisa estar acessível pelo link. Duplicados serão ignorados e os leads existentes não serão apagados.</p>
              <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
                <button type="button" onClick={() => setShowImportModal(false)} className="min-h-11 rounded-xl px-4 text-xs font-black text-slate-400 hover:text-white">Cancelar</button>
                <button disabled={importingSheet} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-400 px-5 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50">
                  {importingSheet ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                  Importar leads
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </InternalLayout>
  );
}

function SheetHead({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`border border-blue-300/70 px-2 py-0.5 text-left text-[14px] font-black leading-5 !text-white ${className}`}>{children}</th>;
}

function SheetCell({ children, strong = false, className = '' }: { children: ReactNode; strong?: boolean; className?: string }) {
  return <td className={`max-w-[220px] truncate border border-slate-700 px-2 py-0.5 leading-5 !text-slate-100 ${strong ? 'font-bold' : 'font-semibold'} ${className}`}>{children}</td>;
}
