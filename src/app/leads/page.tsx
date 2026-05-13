'use client';

import { useState, useEffect } from 'react';
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
  Save
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadStatus } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getLeadStatusStyle, LEAD_STATUSES, normalizeLeadStatus } from '@/lib/leadStatus';

function countLives(idades?: string | null) {
  if (!idades) return 0;
  return idades.split(/[,;/|]+/).map(item => item.trim()).filter(Boolean).length;
}

export default function BrokerLeadsPage() {
  const { profile } = useAuth();
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
  const [minLives, setMinLives] = useState('');
  const [operadoraFilter, setOperadoraFilter] = useState('todas');
  const [operadorasDisponiveis, setOperadorasDisponiveis] = useState<string[]>([]);
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [crmApiUrl, setCrmApiUrl] = useState('');

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
    const operadoras = data?.operadoras_info?.selecionadas;
    setOperadorasDisponiveis(Array.isArray(operadoras) ? operadoras : []);
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

  const filteredLeads = leads.filter(lead => {
    const searchMatch =
      (lead.nome?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (lead.telefone || '').includes(searchTerm) ||
      (lead.cidade?.toLowerCase() || '').includes(searchTerm.toLowerCase());

    const cnpjMatch = cnpjFilter === 'todos' || lead.possui_cnpj === cnpjFilter;
    const statusMatch = statusFilter === 'todos' || lead.status === statusFilter;
    const operadoraMatch = operadoraFilter === 'todas' || lead.operadora === operadoraFilter;
    const livesMatch = !minLives || countLives(lead.idades) >= Number(minLives);
    const leadDate = lead.data_entrada ? new Date(lead.data_entrada) : null;
    const fromMatch = !dateFrom || (leadDate && leadDate >= new Date(dateFrom));
    const toMatch = !dateTo || (leadDate && leadDate <= new Date(dateTo + 'T23:59:59'));

    return searchMatch && cnpjMatch && statusMatch && operadoraMatch && livesMatch && fromMatch && toMatch;
  });

  return (
    <InternalLayout>
      <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Meus Leads</h1>
          <p className="font-medium text-gray-500">Lista detalhada com filtros e status comercial.</p>
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
        </div>
      </div>

      <div className="mb-6 rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
        {operadorasDisponiveis.length > 0 && (
          <div className="mb-5 rounded-[1.5rem] border border-blue-100 bg-blue-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-xs font-black text-white">OP</span>
              <div>
                <p className="text-sm font-black text-blue-950">Filtro por operadora da sua campanha</p>
                <p className="text-xs font-bold text-blue-600">Aparecem apenas as operadoras marcadas no cadastro do corretor.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOperadoraFilter('todas')}
                className={`rounded-2xl px-4 py-3 text-xs font-black transition-all ${operadoraFilter === 'todas' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white text-blue-700 hover:bg-blue-100'}`}
              >
                Todas
              </button>
              {operadorasDisponiveis.map((operadora) => (
                <button
                  key={operadora}
                  type="button"
                  onClick={() => setOperadoraFilter(operadora)}
                  className={`rounded-2xl px-4 py-3 text-xs font-black transition-all ${operadoraFilter === operadora ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white text-blue-700 hover:bg-blue-100'}`}
                >
                  {operadora}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
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
            <option value="Sim">Com CNPJ</option>
            <option value="Não">Sem CNPJ</option>
            <option value="Não informado">Nao informado</option>
          </select>
          <input type="number" min="0" placeholder="Min. vidas" value={minLives} onChange={(e) => setMinLives(e.target.value)} className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
        </div>
        <div className="mt-4">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 md:w-72">
            <option value="todos">Todos os status</option>
            {LEAD_STATUSES.map(status => <option key={status} value={status}>{getLeadStatusStyle(status).label}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
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
            <table className="w-full min-w-[1250px] border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Data</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Nome</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Telefone</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Idades</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Possui CNPJ</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Tem plano ativo?</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Plano atual</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Investimento</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Cidade</th>
                  <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-20 text-center">
                      <Loader2 className="mx-auto animate-spin text-blue-600" size={40} />
                    </td>
                  </tr>
                ) : filteredLeads.map((lead) => {
                  const statusStyle = getLeadStatusStyle(lead.status);

                  return (
                  <tr key={lead.id} className="transition-colors hover:bg-blue-50/30">
                    <td className="px-5 py-5 text-[13px] font-bold text-slate-500">
                      {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}
                    </td>
                    <td className="px-5 py-5 text-sm font-bold text-gray-900">{lead.nome}</td>
                    <td className="px-5 py-5 text-sm font-medium text-slate-600">{lead.telefone}</td>
                    <td className="px-5 py-5 text-sm font-bold text-slate-600">{lead.idades || '-'}</td>
                    <td className="px-5 py-5">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                        lead.possui_cnpj === 'Sim' ? 'bg-emerald-50 text-emerald-700' :
                        lead.possui_cnpj === 'Não' ? 'bg-amber-50 text-amber-700' :
                        'bg-slate-50 text-slate-500'
                      }`}>
                        {lead.possui_cnpj || 'Nao informado'}
                      </span>
                    </td>
                    <td className="px-5 py-5">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                        lead.tem_plano_ativo === 'Sim' ? 'bg-blue-50 text-blue-700' :
                        lead.tem_plano_ativo === 'Não' ? 'bg-slate-100 text-slate-600' :
                        'bg-slate-50 text-slate-500'
                      }`}>
                        {lead.tem_plano_ativo || 'Nao informado'}
                      </span>
                    </td>
                    <td className="px-5 py-5 text-sm font-medium text-slate-500">{lead.plano_atual || '-'}</td>
                    <td className="px-5 py-5 text-sm font-bold text-slate-600">{lead.investimento || '-'}</td>
                    <td className="px-5 py-5 text-sm font-medium text-slate-500">{lead.cidade || '-'}</td>
                    <td className="px-5 py-5">
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
                  </tr>
                )})}
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
    </InternalLayout>
  );
}
