'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import {
  AlertCircle,
  Download,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type TrafficLead = Lead & {
  corretores?: {
    nome: string;
  } | null;
};

export default function TrafficLeadsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<TrafficLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  async function fetchLeads() {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);

    try {
      const { data: corretores, error: corretoresError } = await supabase
        .from('corretores')
        .select('id')
        .eq('gestor_trafego_id', profile.id);

      if (corretoresError) throw corretoresError;

      const corretorIds = (corretores || []).map((corretor) => corretor.id);

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
        setError('Acesso negado: você não tem permissão para visualizar estes leads.');
      } else {
        setError('Erro ao carregar leads vinculados à sua gestão.');
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

    return (
      (lead.nome?.toLowerCase() || '').includes(term) ||
      (lead.telefone || '').includes(searchTerm) ||
      (lead.cidade?.toLowerCase() || '').includes(term) ||
      (lead.corretores?.nome?.toLowerCase() || '').includes(term)
    );
  });

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Leads dos Corretores</h1>
          <p className="text-gray-500 font-medium">Acompanhe os leads dos parceiros vinculados à sua gestão.</p>
        </div>
        <button className="bg-white text-gray-700 px-6 py-3 rounded-xl font-bold border border-gray-100 shadow-sm flex items-center gap-2 hover:bg-gray-50 transition-all">
          <Download size={18} /> Exportar
        </button>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input
              type="text"
              placeholder="Buscar por lead, telefone, cidade ou corretor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border-none pl-12 pr-4 py-4 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
            />
          </div>
          <button
            onClick={fetchLeads}
            className="bg-slate-50 text-slate-500 px-5 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-all"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        <div className="overflow-x-auto">
          {error ? (
            <div className="py-24 text-center">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <ShieldAlert size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Acesso restrito</h3>
              <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
              <button
                onClick={fetchLeads}
                className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
              >
                <RefreshCw size={14} /> Tentar novamente
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Data</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Corretor</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Lead</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Telefone</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cidade</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Investimento</th>
                  <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center">
                      <Loader2 className="animate-spin text-blue-600 mx-auto" size={40} />
                    </td>
                  </tr>
                ) : filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-6 py-5 text-[13px] font-bold text-slate-500">
                      {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-600 font-bold">{lead.corretores?.nome || '-'}</td>
                    <td className="px-6 py-5">
                      <p className="font-bold text-gray-900 text-sm">{lead.nome}</p>
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-600 font-medium">{lead.telefone}</td>
                    <td className="px-6 py-5 text-sm text-slate-500 font-medium">{lead.cidade || '-'}</td>
                    <td className="px-6 py-5 text-sm text-slate-600 font-bold">{lead.investimento || '-'}</td>
                    <td className="px-6 py-5 text-center">
                      <span className="inline-block px-3 py-1.5 bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest rounded-full">
                        {lead.status}
                      </span>
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
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Nenhum lead encontrado</p>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
