'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { AlertCircle, Download, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import PhoneAction from '@/components/ui/PhoneAction';

type TrafficLead = Lead & {
  corretores?: {
    nome: string;
  } | null;
};

type CorretorOption = {
  id: string;
  nome: string;
};

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

  async function fetchLeads() {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);

    try {
      const { data: corretoresData, error: corretoresError } = await supabase
        .from('corretores')
        .select('id, nome')
        .eq('gestor_trafego_id', profile.id)
        .order('nome', { ascending: true });

      if (corretoresError) throw corretoresError;

      const corretorList = (corretoresData || []) as CorretorOption[];
      const corretorIds = corretorList.map((corretor) => corretor.id);
      setCorretores(corretorList);

      if (corretorIds.length === 0) {
        setLeads([]);
        return;
      }

      const { data, error: leadsError } = await supabase
        .from('leads')
        .select('*, corretores(nome)')
        .in('corretor_id', corretorIds)
        .order('data_entrada', { ascending: false });

      if (leadsError) throw leadsError;

      setLeads((data as TrafficLead[]) || []);
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

  const filteredLeads = leads.filter((lead) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = (
      (lead.nome?.toLowerCase() || '').includes(term) ||
      (lead.telefone || '').includes(searchTerm) ||
      (lead.cidade?.toLowerCase() || '').includes(term) ||
      (lead.corretores?.nome?.toLowerCase() || '').includes(term) ||
      (lead.operadora?.toLowerCase() || '').includes(term) ||
      (lead.observacoes?.toLowerCase() || '').includes(term)
    );
    const matchesCorretor = selectedCorretorId === 'todos' || lead.corretor_id === selectedCorretorId;
    return matchesSearch && matchesCorretor;
  });

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

      <div className="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        <div className="grid gap-4 border-b border-gray-50 p-8 xl:grid-cols-[280px_1fr_auto]">
          <select
            value={selectedCorretorId}
            onChange={(event) => setSelectedCorretorId(event.target.value)}
            className="rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-black transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="todos">Todos os corretores</option>
            {corretores.map((corretor) => (
              <option key={corretor.id} value={corretor.id}>{corretor.nome}</option>
            ))}
          </select>
          <div className="group relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-500" size={18} />
            <input
              type="text"
              placeholder="Buscar por lead, telefone, cidade, corretor, aba ou UTM..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border-none bg-slate-50 py-4 pl-12 pr-4 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <button
            onClick={fetchLeads}
            className="flex items-center justify-center gap-2 rounded-2xl bg-slate-50 px-5 py-4 font-black text-slate-500 transition-all hover:bg-slate-100"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

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
            <table className="w-full min-w-[1850px] border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Data</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Corretor</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Lead</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Telefone</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Idades</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">CNPJ</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Plano ativo</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Cidade</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Investimento</th>
                  <th className="px-6 py-5 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Página / Operadora</th>
                  <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">UTMs / Observacoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan={12} className="py-20 text-center">
                      <Loader2 className="mx-auto animate-spin text-blue-600" size={40} />
                    </td>
                  </tr>
                ) : filteredLeads.map((lead) => (
                  <tr key={lead.id} className="transition-colors hover:bg-blue-50/30">
                    <td className="px-6 py-5 text-[13px] font-bold text-slate-500">
                      {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                    </td>
                    <td className="px-6 py-5 text-sm font-bold text-slate-600">{lead.corretores?.nome || '-'}</td>
                    <td className="px-6 py-5"><p className="text-sm font-bold text-gray-900">{lead.nome}</p></td>
                    <td className="px-6 py-5 text-sm font-medium text-slate-600">
                      <PhoneAction phone={lead.telefone} />
                    </td>
                    <td className="px-6 py-5 text-sm font-bold text-slate-500">{lead.idades || '-'}</td>
                    <td className="px-6 py-5 text-[11px] font-black uppercase tracking-widest text-slate-500">{lead.possui_cnpj || '-'}</td>
                    <td className="px-6 py-5 text-[11px] font-black uppercase tracking-widest text-slate-500">{lead.tem_plano_ativo || '-'}</td>
                    <td className="px-6 py-5 text-sm font-medium text-slate-500">{lead.cidade || '-'}</td>
                    <td className="px-6 py-5 text-sm font-bold text-slate-600">{lead.investimento || '-'}</td>
                    <td className="px-6 py-5 text-center">
                      <span className="inline-block rounded-full bg-blue-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-blue-600">
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-600">{sheetTabLabel(lead.operadora)}</td>
                    <td className="px-6 py-5 text-xs font-bold leading-relaxed text-slate-500">
                      <div className="max-w-[380px] whitespace-normal">{lead.observacoes || '-'}</div>
                    </td>
                  </tr>
                ))}
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
