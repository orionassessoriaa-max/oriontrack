'use client';

import { useState, useEffect } from 'react';
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
  Upload
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<(Lead & { corretores: { nome: string } })[]>([]);
  const [corretores, setCorretores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCorretor, setFilterCorretor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCidade, setFilterCidade] = useState('');
  const [filterDataInicio, setFilterDataInicio] = useState('');
  const [filterDataFim, setFilterDataFim] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetCorretorId, setSheetCorretorId] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadsRes, corretoresRes] = await Promise.all([
        supabase
          .from('leads')
          .select('*, corretores(nome)')
          .order('data_entrada', { ascending: false }),
        supabase
          .from('corretores')
          .select('id, nome')
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
    setFilterCorretor('');
    setFilterStatus('');
    setFilterCidade('');
    setFilterDataInicio('');
    setFilterDataFim('');
  };

  const importSheet = async () => {
    if (!sheetUrl.trim() || !sheetCorretorId) {
      setImportMessage('Selecione o corretor e cole o link da planilha.');
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

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = 
      (lead.nome?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (lead.telefone || '').includes(searchTerm);
    
    const matchesCorretor = !filterCorretor || lead.corretor_id === filterCorretor;
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

    return matchesSearch && matchesCorretor && matchesStatus && matchesCidade && matchesDate;
  });

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Todos os Leads</h1>
          <p className="text-gray-500 font-medium">Audite, filtre e gerencie os leads dos corretores.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowImportBox((current) => !current)}
            className="bg-emerald-600 text-white px-6 py-4 rounded-2xl font-black shadow-sm flex items-center gap-2 hover:bg-emerald-700 transition-all"
          >
            <Upload size={18} /> Importar Planilha
          </button>
          <button className="bg-white text-gray-700 px-6 py-4 rounded-2xl font-black border border-gray-100 shadow-sm flex items-center gap-2 hover:bg-gray-50 transition-all">
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

      {showImportBox && (
        <div className="mb-8 rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5">
          <h2 className="mb-2 text-lg font-black text-emerald-950">Importar leads por planilha</h2>
          <p className="mb-4 text-sm font-bold text-emerald-800">Selecione o corretor, cole o link do Google Sheets e importe os leads. A planilha precisa estar compartilhada para visualizacao por link.</p>
          {importMessage && <div className="mb-4 rounded-2xl bg-white p-4 text-sm font-black text-emerald-800">{importMessage}</div>}
          <div className="grid gap-3 md:grid-cols-[260px_1fr_auto]">
            <select
              value={sheetCorretorId}
              onChange={(event) => setSheetCorretorId(event.target.value)}
              className="rounded-2xl border-none bg-white px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">Selecione o corretor</option>
              {corretores.map((corretor) => (
                <option key={corretor.id} value={corretor.id}>{corretor.nome}</option>
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

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden mb-10">
        <div className="p-8 border-b border-gray-50 bg-slate-50/30">
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
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Corretor</label>
              <select 
                value={filterCorretor}
                onChange={(e) => setFilterCorretor(e.target.value)}
                className="w-full bg-white border-none px-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all font-bold shadow-sm appearance-none"
              >
                <option value="">Todos Corretores</option>
                {corretores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
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
                <option value="Aguardando atendimento">Aguardando</option>
                <option value="Contato feito">Contato feito</option>
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
                className="w-full bg-slate-200 text-slate-600 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-300 transition-all flex items-center justify-center gap-2"
              >
                <X size={14} /> Limpar Filtros
              </button>
            </div>
          </div>
        </div>

        <div className="scrollbar-visible overflow-x-scroll">
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
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Aba da planilha</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">UTMs / Observacoes</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Corretor</th>
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
                    <td className="px-6 py-5 text-sm text-slate-600 font-medium">{lead.telefone}</td>
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
                    <td className="px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-500">{lead.operadora || '-'}</td>
                    <td className="px-6 py-5 text-xs font-bold leading-relaxed text-slate-500">
                      <div className="max-w-[360px] whitespace-normal">{lead.observacoes || '-'}</div>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <span className="inline-block px-3 py-1.5 bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest rounded-full">
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-xs font-bold text-slate-400">{lead.corretores?.nome}</span>
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
