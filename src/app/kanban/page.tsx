'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { LeadCard, LeadModal } from '@/components/features/LeadDetails';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadStatus, TipoCampanha } from '@/types';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, Sparkles, Target } from 'lucide-react';
import { getLeadQualification } from '@/lib/leadQualification';
import { getLeadStatusStyle, normalizeLeadStatus } from '@/lib/leadStatus';

const columns: { id: LeadStatus; label: string; desc: string }[] = [
  { id: 'Aguardando atendimento', label: 'Oportunidade', desc: 'Entrou e precisa de primeiro contato' },
  { id: 'Contato feito', label: 'Contato', desc: 'Primeira abordagem realizada' },
  { id: 'Cotação enviada', label: 'Cotação', desc: 'Proposta enviada ao lead' },
  { id: 'Em negociação', label: 'Negociação', desc: 'Acompanhamento ativo' },
  { id: 'Não tive retorno', label: 'Sem retorno', desc: 'Precisa de nova tentativa' },
  { id: 'Venda realizada', label: 'Venda', desc: 'Conversão concluída' },
  { id: 'Sem interesse', label: 'Sem interesse', desc: 'Descartado comercialmente' },
];

export default function KanbanPage() {
  const { profile } = useAuth();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tipoCampanha, setTipoCampanha] = useState<TipoCampanha | null>('ambos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);

  async function fetchLeads() {
    setLoading(true);
    setError(null);
    try {
      let query = supabase.from('leads').select('*');

      if (profile?.tipo_usuario !== 'admin') {
        query = query.eq('corretor_id', profile?.corretor_id);
        if (profile?.corretor_id) {
          const { data: corretor } = await supabase
            .from('corretores')
            .select('tipo_campanha')
            .eq('id', profile.corretor_id)
            .maybeSingle();

          setTipoCampanha((corretor?.tipo_campanha as TipoCampanha | null) || 'ambos');
        }
      }

      const { data, error: supabaseError } = await query.order('data_entrada', { ascending: false });

      if (supabaseError) {
        console.error('Kanban fetch error:', supabaseError);
        if (supabaseError.code === '42501' || supabaseError.message?.toLowerCase().includes('row-level security')) {
          setError('Acesso Negado (RLS): voce nao tem permissao para gerenciar este funil.');
        } else {
          setError('Erro ao carregar funil: ' + supabaseError.message);
        }
        return;
      }

      setLeads((data || []).map((lead) => ({ ...lead, status: normalizeLeadStatus(lead.status) })));
    } catch (err) {
      console.error('Catch error:', err);
      setError('Erro inesperado ao carregar leads.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile) void Promise.resolve().then(fetchLeads);
  }, [profile]);

  const getLeadsByStatus = (status: LeadStatus) => {
    return leads.filter((lead) => normalizeLeadStatus(lead.status) === status);
  };

  const updateLeadStatus = async (leadId: string, status: LeadStatus) => {
    const previousLeads = leads;
    setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, status } : lead));

    const { error: updateError } = await supabase
      .from('leads')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateError) {
      setLeads(previousLeads);
      alert('Erro ao mover lead: ' + updateError.message);
    }
  };

  const handleDrop = (status: LeadStatus) => {
    if (!draggedLeadId) return;
    const lead = leads.find(item => item.id === draggedLeadId);
    setDraggedLeadId(null);
    if (!lead || normalizeLeadStatus(lead.status) === status) return;
    updateLeadStatus(lead.id, status);
  };

  const fitStats = leads.reduce(
    (acc, lead) => {
      const qualification = getLeadQualification(lead, tipoCampanha);
      if (qualification.tone === 'good') acc.good += 1;
      if (qualification.tone === 'warning') acc.warning += 1;
      return acc;
    },
    { good: 0, warning: 0 }
  );

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-600">
              Campanha {tipoCampanha || 'ambos'}
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Pipeline Comercial</h1>
          <p className="font-medium text-gray-500">Priorize oportunidades, veja o fit do lead e organize o atendimento.</p>
        </div>
        <button
          onClick={fetchLeads}
          className="w-fit rounded-xl border border-gray-100 bg-white p-3 shadow-sm transition-colors hover:bg-gray-50"
        >
          {loading ? <Loader2 className="animate-spin text-blue-600" size={20} /> : <RefreshCw size={20} className="text-gray-400" />}
        </button>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <Target size={14} className="text-blue-600" /> Oportunidades abertas
          </div>
          <p className="text-3xl font-black text-gray-900">{getLeadsByStatus('Aguardando atendimento').length}</p>
        </div>
        <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">
            <CheckCircle2 size={14} /> Dentro do perfil
          </div>
          <p className="text-3xl font-black text-emerald-900">{fitStats.good}</p>
        </div>
        <div className="rounded-[2rem] border border-amber-100 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
            <AlertTriangle size={14} /> Atenção ICP
          </div>
          <p className="text-3xl font-black text-amber-900">{fitStats.warning}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="animate-spin text-blue-600" size={48} />
        </div>
      ) : error ? (
        <div className="rounded-[2.5rem] border border-gray-100 bg-white p-20 text-center shadow-sm">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <ShieldAlert size={32} />
          </div>
          <h3 className="mb-2 text-xl font-bold text-gray-900">Restrição de Acesso</h3>
          <p className="mx-auto mb-6 max-w-md font-medium text-red-500">{error}</p>
          <button
            onClick={fetchLeads}
            className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 hover:underline"
          >
            <RefreshCw size={14} /> Tentar novamente
          </button>
        </div>
      ) : (
        <div className="flex min-h-[calc(100vh-310px)] snap-x gap-5 overflow-x-auto pb-8">
          {columns.map((column) => {
            const columnLeads = getLeadsByStatus(column.id);
            const statusStyle = getLeadStatusStyle(column.id);

            return (
              <div key={column.id} className="min-w-[300px] flex-1 snap-start">
                <div className="sticky top-0 z-20 mb-3 rounded-[1.5rem] border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${statusStyle.dot}`} />
                        <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">{column.label}</h3>
                      </div>
                      <p className="mt-1 text-xs font-medium text-gray-400">{column.desc}</p>
                    </div>
                    <span className="rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600">
                      {columnLeads.length}
                    </span>
                  </div>
                </div>

                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(column.id)}
                  className={`min-h-[180px] space-y-3 rounded-[2rem] border p-3 transition-colors ${
                    draggedLeadId ? 'border-blue-200 bg-blue-50/70' : statusStyle.column
                  }`}
                >
                  {columnLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      tipoCampanha={tipoCampanha}
                      onClick={(l) => setSelectedLead(l)}
                      draggable
                      onDragStart={() => setDraggedLeadId(lead.id)}
                      onDragEnd={() => setDraggedLeadId(null)}
                    />
                  ))}
                  {columnLeads.length === 0 && (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white/60 py-12 text-center">
                      <Sparkles size={20} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sem leads aqui</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LeadModal
        lead={selectedLead}
        tipoCampanha={tipoCampanha}
        onClose={() => setSelectedLead(null)}
      />
    </InternalLayout>
  );
}
