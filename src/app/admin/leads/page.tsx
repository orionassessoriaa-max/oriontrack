'use client';

import { useState, useEffect, useMemo } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Search, 
  Filter, 
  Download, 
  Loader2,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  Plus,
  Edit2,
  Eye,
  Calendar,
  X,
  Upload,
  Trash2
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';
import PhoneAction from '@/components/ui/PhoneAction';

type BrokerOption = {
  id: string;
  nome: string;
  nome_empresa?: string | null;
};

type LeadWithBroker = Lead & {
  corretores: {
    nome: string;
    nome_empresa?: string | null;
  } | null;
};

type ConcessionariaOption = {
  key: string;
  nome: string;
  brokerIds: string[];
  primaryId: string;
  brokers: string[];
};

function getConcessionariaName(corretor?: Pick<BrokerOption, 'nome' | 'nome_empresa'> | null) {
  return String(corretor?.nome_empresa || corretor?.nome || 'Sem concessionaria').trim();
}

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<LeadWithBroker[]>([]);
  const [corretores, setCorretores] = useState<BrokerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterConcessionaria, setFilterConcessionaria] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCidade, setFilterCidade] = useState('');
  const [filterDataInicio, setFilterDataInicio] = useState('');
  const [filterDataFim, setFilterDataFim] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetCorretorId, setSheetCorretorId] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(5);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteScopeCount, setDeleteScopeCount] = useState<number | null>(null);
  const [loadingDeleteScopeCount, setLoadingDeleteScopeCount] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!showDeleteAll) return;

    setDeleteCountdown(5);
    const interval = window.setInterval(() => {
      setDeleteCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [showDeleteAll]);

  useEffect(() => {
    if (!showDeleteAll) return;
    void fetchDeleteScopeCount();
  }, [showDeleteAll, filterConcessionaria]);

  const concessionarias = useMemo<ConcessionariaOption[]>(() => {
    const groups = new Map<string, ConcessionariaOption>();

    corretores.forEach((corretor) => {
      const nome = getConcessionariaName(corretor);
      const key = nome.toLowerCase();
      const existing = groups.get(key);

      if (existing) {
        existing.brokerIds.push(corretor.id);
        existing.brokers.push(corretor.nome);
        return;
      }

      groups.set(key, {
        key,
        nome,
        brokerIds: [corretor.id],
        primaryId: corretor.id,
        brokers: [corretor.nome],
      });
    });

    return Array.from(groups.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [corretores]);

  const selectedConcessionaria = concessionarias.find((item) => item.key === filterConcessionaria) || null;

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadsRes, corretoresRes] = await Promise.all([
        supabase
          .from('leads')
          .select('*, corretores(nome, nome_empresa)')
          .order('data_entrada', { ascending: false, nullsFirst: false }),
        supabase
          .from('corretores')
          .select('id, nome, nome_empresa')
          .order('nome')
      ]);
      
      if (leadsRes.error) {
        console.error('RLS/DB Error:', leadsRes.error);
        if (leadsRes.error.code === '42501' || leadsRes.error.message?.toLowerCase().includes('row-level security')) {
          setError("Acesso Negado (RLS): Você não tem permissão para visualizar todos os leads.");
        } else {
          setError("Erro ao buscar leads: " + leadsRes.error.message);
        }
        return;
      }

      setLeads(leadsRes.data as any || []);
      setCorretores(corretoresRes.data || []);
    } catch (err: any) {
      console.error('Catch Error:', err);
      setError("Erro inesperado ao carregar leads.");
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterConcessionaria('');
    setFilterStatus('');
    setFilterCidade('');
    setFilterDataInicio('');
    setFilterDataFim('');
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
      'CNPJ',
      'Plano Ativo',
      'Plano Atual',
      'Custo Plano Atual',
      'Investimento',
      'Cidade',
      'Status',
      'Página/Operadora',
      'Concessionaria',
      'Origem (UTM Source)',
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
      lead.tem_plano_ativo || '',
      lead.plano_atual || '',
      lead.custo_plano_atual || '',
      lead.investimento || '',
      lead.cidade || '',
      lead.status || '',
      lead.operadora || '',
      getConcessionariaName(lead.corretores),
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


  const fetchDeleteScopeCount = async () => {
    setLoadingDeleteScopeCount(true);
    setDeleteScopeCount(null);

    let query = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true });

    if (selectedConcessionaria) query = query.in('corretor_id', selectedConcessionaria.brokerIds);

    const { count, error: countError } = await query;

    if (countError) {
      setDeleteMessage(`Nao consegui conferir o total real de leads: ${countError.message}`);
    } else {
      setDeleteScopeCount(count || 0);
    }

    setLoadingDeleteScopeCount(false);
  };

  const importSheet = async () => {
    if (!sheetUrl.trim() || !sheetCorretorId) {
      setImportMessage('Selecione a concessionaria e cole o link da planilha.');
      return;
    }

    setImporting(true);
    setImportMessage(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setImporting(false);
      setImportMessage('Sessao expirada. Entre novamente.');
      return;
    }

    const response = await fetch('/api/admin/leads/import-sheets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        corretor_id: sheetCorretorId,
        sheet_url: sheetUrl
      })
    });
    const payload = await response.json();

    setImporting(false);
    if (!response.ok) {
      setImportMessage(payload.error || 'Erro ao importar planilha.');
      return;
    }

    const skippedText = payload.skipped ? ` ${payload.skipped} linha(s) ignorada(s) por falta de nome ou telefone.` : '';
    setImportMessage(`${payload.imported} lead(s) importado(s) para ${payload.corretor}.${skippedText}`);
    setSheetUrl('');
    await fetchData();
  };

  const deleteAllLeads = async () => {
    setDeletingAll(true);
    setDeleteMessage(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setDeletingAll(false);
      setDeleteMessage('Sessao expirada. Entre novamente.');
      return;
    }

    const response = await fetch('/api/admin/leads', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        confirm: 'DELETE_ALL_LEADS',
        corretor_ids: selectedConcessionaria?.brokerIds || null,
        concessionaria: selectedConcessionaria?.nome || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    setDeletingAll(false);
    if (!response.ok) {
      setDeleteMessage(payload.error || 'Erro ao remover todos os leads.');
      return;
    }

    setDeleteMessage(`${payload.deleted || 0} lead(s) removidos com sucesso${payload.concessionaria ? ` de ${payload.concessionaria}` : ''}.`);
    setShowDeleteAll(false);
    await fetchData();
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = 
      (lead.nome?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (lead.telefone || '').includes(searchTerm);
    
    const matchesConcessionaria = !selectedConcessionaria
      || selectedConcessionaria.brokerIds.includes(String(lead.corretor_id || ''))
      || getConcessionariaName(lead.corretores).toLowerCase() === selectedConcessionaria.key;
    const matchesStatus = !filterStatus || lead.status === filterStatus;
    const matchesCidade = !filterCidade || (lead.cidade?.toLowerCase() || '').includes(filterCidade.toLowerCase());
    
    let matchesDate = true;
    if (filterDataInicio && lead.data_entrada) {
      matchesDate = matchesDate && new Date(lead.data_entrada) >= new Date(filterDataInicio);
    }
    if (filterDataFim && lead.data_entrada) {
      // Add end of day to filterDataFim
      const endDate = new Date(filterDataFim);
      endDate.setHours(23, 59, 59, 999);
      matchesDate = matchesDate && new Date(lead.data_entrada) <= endDate;
    }

    return matchesSearch && matchesConcessionaria && matchesStatus && matchesCidade && matchesDate;
  });

  const loadedDeleteScopeLeadsCount = selectedConcessionaria
    ? leads.filter((lead) => selectedConcessionaria.brokerIds.includes(String(lead.corretor_id || ''))).length
    : leads.length;
  const deleteScopeLeadsCount = deleteScopeCount ?? loadedDeleteScopeLeadsCount;
  const deleteButtonLabel = selectedConcessionaria ? `Remover leads de ${selectedConcessionaria.nome}` : 'Remover todos';

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Todos os Leads</h1>
          <p className="text-gray-500 font-medium">Audite, filtre e gerencie os leads por concessionaria.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              setDeleteMessage(null);
              setDeleteScopeCount(null);
              setShowDeleteAll(true);
            }}
            className="bg-red-50 text-red-700 px-6 py-4 rounded-2xl font-black border border-red-100 shadow-sm flex items-center gap-2 hover:bg-red-100 transition-all"
          >
            <Trash2 size={18} /> {deleteButtonLabel}
          </button>
          <button
            onClick={() => setShowImportBox((current) => !current)}
            className="bg-emerald-600 text-white px-6 py-4 rounded-2xl font-black shadow-sm flex items-center gap-2 hover:bg-emerald-700 transition-all"
          >
            <Upload size={18} /> Importar Planilha
          </button>
          <button
            onClick={exportToCsv}
            className="bg-white text-gray-700 px-6 py-4 rounded-2xl font-black border border-gray-100 shadow-sm flex items-center gap-2 hover:bg-gray-50 transition-all"
          >
            <Download size={18} /> Exportar
          </button>
          <Link 
            href="/admin/leads/novo"
            className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
          >
            <Plus size={20} /> Novo Lead
          </Link>
        </div>
      </div>

      {deleteMessage && (
        <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-black text-red-700">
          {deleteMessage}
        </div>
      )}

      {showDeleteAll && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="border-b border-red-100 bg-red-50 p-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Acao irreversivel</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                {selectedConcessionaria ? `Remover leads de ${selectedConcessionaria.nome}?` : 'Remover todos os leads?'}
              </h2>
              <p className="mt-2 text-sm font-bold leading-6 text-red-700">
                {selectedConcessionaria
                  ? `Isso apaga apenas os leads vinculados a concessionaria ${selectedConcessionaria.nome}.`
                  : 'Isso apaga todos os leads de todas as concessionarias. Use apenas antes de uma nova importacao geral.'}
              </p>
            </div>
            <div className="p-6">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                  {selectedConcessionaria ? 'Leads desta concessionaria' : 'Leads no banco'}
                </p>
                <p className="mt-1 text-3xl font-black text-slate-950">
                  {loadingDeleteScopeCount ? <Loader2 className="animate-spin text-red-600" size={30} /> : deleteScopeLeadsCount}
                </p>
                <p className="mt-2 text-[11px] font-bold text-slate-400">
                  Contagem real consultada direto no banco antes de apagar.
                </p>
              </div>
              {deleteCountdown > 0 ? (
                <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-black text-amber-800">
                  O botao de confirmacao aparece em {deleteCountdown} segundo(s).
                </div>
              ) : (
                <button
                  onClick={deleteAllLeads}
                  disabled={deletingAll}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-4 text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-red-600/20 transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {deletingAll ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                  {selectedConcessionaria ? `Confirmar e apagar leads de ${selectedConcessionaria.nome}` : 'Confirmar e apagar todos os leads'}
                </button>
              )}
              <button
                onClick={() => setShowDeleteAll(false)}
                disabled={deletingAll}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportBox && (
        <div className="mb-8 rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5">
          <h2 className="mb-2 text-lg font-black text-emerald-950">Importar leads por planilha</h2>
          <p className="mb-4 text-sm font-bold text-emerald-800">Selecione a concessionaria, cole o link do Google Sheets e importe os leads. A planilha precisa estar compartilhada para visualizacao por link.</p>
          {importMessage && <div className="mb-4 rounded-2xl bg-white p-4 text-sm font-black text-emerald-800">{importMessage}</div>}
          <div className="grid gap-3 md:grid-cols-[260px_1fr_auto]">
            <select
              value={sheetCorretorId}
              onChange={(event) => setSheetCorretorId(event.target.value)}
              className="rounded-2xl border-none bg-white px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">Selecione a concessionaria</option>
              {concessionarias.map((concessionaria) => (
                <option key={concessionaria.key} value={concessionaria.primaryId}>
                  {concessionaria.nome}{concessionaria.brokers.length > 1 ? ` (${concessionaria.brokers.length} corretores)` : ''}
                </option>
              ))}
            </select>
            <input
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="flex-1 rounded-2xl border-none bg-white px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
            />
            <button
              onClick={importSheet}
              disabled={importing}
              className="rounded-2xl bg-emerald-600 px-6 py-4 text-sm font-black text-white hover:bg-emerald-700"
            >
              {importing ? <Loader2 className="animate-spin" size={18} /> : 'Importar agora'}
            </button>
          </div>
        </div>
      )}

      <div className="orion-admin-leads-filters bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden mb-10">
        <div className="orion-admin-leads-filters-inner p-8 border-b border-gray-50 bg-slate-50/30">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            <div className="space-y-2 group">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Buscar</label>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={16} />
                <input 
                  type="text" 
                  placeholder="Nome ou telefone..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white border-none pl-10 pr-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-medium shadow-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Concessionaria</label>
              <select 
                value={filterConcessionaria}
                onChange={(e) => setFilterConcessionaria(e.target.value)}
                className="w-full bg-white border-none px-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-bold shadow-sm appearance-none"
              >
                <option value="">Todas Concessionarias</option>
                {concessionarias.map(c => <option key={c.key} value={c.key}>{c.nome}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Status</label>
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full bg-white border-none px-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-bold shadow-sm appearance-none"
              >
                <option value="">Todos Status</option>
                <option value="Aguardando atendimento">Oportunidade (Aguardando)</option>
                <option value="Inicio">Início (Primeiro Contato)</option>
                <option value="Contato feito">Contato Feito (Em Atendimento)</option>
                <option value="Cotação enviada">Cotação enviada</option>
                <option value="Em negociação">Em negociação</option>
                <option value="Venda realizada">Venda realizada</option>
                <option value="Não tive retorno">Não tive retorno</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Cidade</label>
              <input 
                type="text" 
                placeholder="Filtrar cidade..." 
                value={filterCidade}
                onChange={(e) => setFilterCidade(e.target.value)}
                className="w-full bg-white border-none px-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-medium shadow-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Data Início</label>
              <input 
                type="date" 
                value={filterDataInicio}
                onChange={(e) => setFilterDataInicio(e.target.value)}
                className="w-full bg-white border-none px-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-medium shadow-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Data Fim</label>
              <input 
                type="date" 
                value={filterDataFim}
                onChange={(e) => setFilterDataFim(e.target.value)}
                className="w-full bg-white border-none px-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-medium shadow-sm"
              />
            </div>

            <div className="flex items-end">
              <button 
                onClick={clearFilters}
                className="orion-clear-filters-button w-full bg-slate-200 text-slate-700 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-300 transition-all flex items-center justify-center gap-2"
              >
                <X size={14} /> Limpar Filtros
              </button>
            </div>
          </div>
        </div>

        <div className="scrollbar-visible max-h-[calc(100vh-330px)] overflow-auto">
          {error ? (
            <div className="py-24 text-center">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <ShieldAlert size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Ops! Algo deu errado.</h3>
              <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
              <button 
                onClick={fetchData}
                className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
              >
                <RefreshCw size={14} /> Tentar novamente
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[1900px]">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Data</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Nome</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Telefone</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Idades</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">CNPJ</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Plano Ativo</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Plano Atual</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Investimento</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cidade</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Página / Operadora</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Concessionaria</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">UTMs / Observacoes</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan={14} className="py-20 text-center">
                      <Loader2 className="animate-spin text-blue-600 mx-auto" size={40} />
                    </td>
                  </tr>
                ) : filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-6 py-5 text-[13px] font-bold text-slate-500">
                      {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                    </td>
                    <td className="px-6 py-5">
                      <p className="font-bold text-gray-900 text-sm group-hover:text-blue-600 transition-colors">{lead.nome}</p>
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-600 font-medium">
                      <PhoneAction phone={lead.telefone} />
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-500 font-medium">{lead.idades || '-'}</td>
                    <td className="px-6 py-5 text-[11px] font-black uppercase tracking-widest text-slate-400">
                      {lead.possui_cnpj}
                    </td>
                    <td className="px-6 py-5 text-[11px] font-black uppercase tracking-widest text-slate-400">
                      {lead.tem_plano_ativo}
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-500 font-medium">{lead.plano_atual || '-'}</td>
                    <td className="px-6 py-5 text-sm text-slate-600 font-bold">{lead.investimento || '-'}</td>
                    <td className="px-6 py-5 text-sm text-slate-500 font-medium">{lead.cidade || '-'}</td>
                    <td className="px-6 py-5 text-center">
                      <span className="inline-block px-3 py-1.5 bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest rounded-full">
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-500">{lead.operadora || '-'}</td>
                    <td className="px-6 py-5">
                      <div className="space-y-1">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-600">
                          {getConcessionariaName(lead.corretores)}
                        </p>
                        {lead.corretores?.nome && lead.corretores.nome !== getConcessionariaName(lead.corretores) && (
                          <p className="text-[10px] font-bold text-slate-400">Corretor: {lead.corretores.nome}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-xs font-bold leading-relaxed text-slate-500">
                      <div className="max-w-[360px] whitespace-normal">{lead.observacoes || '-'}</div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button className="p-2 text-slate-300 hover:text-blue-600 transition-colors">
                          <Eye size={18} />
                        </button>
                        <button className="p-2 text-slate-300 hover:text-blue-600 transition-colors">
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && filteredLeads.length === 0 && (
          <div className="py-24 text-center">
            <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Nenhum lead encontrado com estes filtros</p>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
