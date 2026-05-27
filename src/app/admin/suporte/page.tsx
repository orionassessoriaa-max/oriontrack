'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { SolicitacaoSuporte, Corretor } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useDialog } from '@/components/providers/DialogProvider';

type AdminSupportRequest = SolicitacaoSuporte & { corretores?: Corretor | null };

const SUPPORT_LABELS: Record<string, string> = {
  lead: 'Lead',
  sistema: 'Sistema',
  financeiro: 'Financeiro',
  outro: 'Outro',
  alinhamento_leads: 'Alinhamento de Leads',
  time_operacional: 'Time Operacional',
  treinamento_comercial: 'Treinamento Comercial',
  alinhamento: 'Alinhamento',
  operacional: 'Operacional',
  treinamento: 'Treinamento'
};

export default function AdminSuportePage() {
  const { confirmDialog } = useDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<AdminSupportRequest[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('solicitacoes_suporte')
        .select('*, corretores(*)')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setRequests((data as AdminSupportRequest[]) || []);
    } catch (err) {
      console.error('Error fetching admin support:', err);
      setError('Erro ao carregar solicitacoes de suporte.');
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id);
    try {
      const { error: updateError } = await supabase
        .from('solicitacoes_suporte')
        .update({ status: newStatus })
        .eq('id', id);

      if (updateError) throw updateError;

      setRequests(prev => prev.map(r => r.id === id ? { ...r, status: newStatus as AdminSupportRequest['status'] } : r));
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Erro ao atualizar status.');
    } finally {
      setUpdatingId(null);
    }
  };

  const removeRequest = async (request: AdminSupportRequest) => {
    const confirmed = await confirmDialog(`Remover o chamado de ${getSolicitante(request)}? Essa ação não pode ser desfeita.`, {
      title: 'Remover chamado',
      confirmLabel: 'Remover chamado',
      variant: 'danger',
    });
    if (!confirmed) return;

    setRemovingId(request.id);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada. Entre novamente.');

      const response = await fetch(`/api/support/requests?id=${encodeURIComponent(request.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(payload.error || 'Erro ao remover chamado.');
      setRequests((prev) => prev.filter((item) => item.id !== request.id));
    } catch (err: any) {
      alert(err.message || 'Erro ao remover chamado.');
    } finally {
      setRemovingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'nova':
      case 'pending':
        return <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-blue-600">Nova</span>;
      case 'em andamento':
        return <span className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-orange-600">Em analise</span>;
      case 'resolvida':
      case 'completed':
        return <span className="rounded-full border border-green-100 bg-green-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-green-600">Resolvida</span>;
      default:
        return <span className="rounded-full border border-gray-100 bg-gray-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">{status}</span>;
    }
  };

  const getSolicitante = (req: AdminSupportRequest) => {
    if (req.solicitante_nome) return req.solicitante_nome;
    if (req.corretores?.nome) return req.corretores.nome;
    return 'Solicitante nao identificado';
  };

  const getSolicitanteTipo = (req: AdminSupportRequest) => {
    if (req.solicitante_tipo === 'gestor_trafego') return 'Gestor de trafego';
    if (req.solicitante_tipo === 'admin') return 'Admin';
    return 'Corretor';
  };

  return (
    <InternalLayout>
      <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Solicitacoes de suporte</h1>
          <p className="text-lg font-medium text-gray-500">Chamados abertos por corretores e gestores para o admin acompanhar.</p>
        </div>
        <button
          onClick={fetchRequests}
          className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-white px-6 py-4 font-black text-gray-700 shadow-sm transition-all hover:bg-gray-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="overflow-hidden rounded-[3rem] border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="animate-spin text-blue-600" size={40} />
            </div>
          ) : error ? (
            <div className="py-24 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertCircle size={32} />
              </div>
              <p className="mb-6 font-bold text-red-500">{error}</p>
              <button onClick={fetchRequests} className="text-xs font-black uppercase tracking-widest text-blue-600 hover:underline">Tentar novamente</button>
            </div>
          ) : requests.length === 0 ? (
            <div className="py-24 text-center font-medium italic text-gray-400">
              Nenhuma solicitacao encontrada no momento.
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="whitespace-nowrap px-8 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Data / Solicitante</th>
                  <th className="whitespace-nowrap px-8 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Categoria</th>
                  <th className="whitespace-nowrap px-8 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Mensagem</th>
                  <th className="whitespace-nowrap px-8 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                  <th className="whitespace-nowrap px-8 py-6 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map((req) => (
                  <tr key={req.id} className="group transition-colors hover:bg-slate-50/30">
                    <td className="px-8 py-6">
                      <p className="mb-1 text-[11px] font-black text-slate-400">
                        {format(new Date(req.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                      </p>
                      <p className="font-bold text-gray-900 transition-colors group-hover:text-blue-600">{getSolicitante(req)}</p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{getSolicitanteTipo(req)}</p>
                    </td>
                    <td className="px-8 py-6">
                      <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-black text-gray-700">
                        {SUPPORT_LABELS[req.categoria || req.tipo] || req.tipo}
                      </span>
                    </td>
                    <td className="max-w-md px-8 py-6">
                      <p className="line-clamp-3 text-sm font-medium text-gray-500" title={req.mensagem}>{req.mensagem || '-'}</p>
                    </td>
                    <td className="px-8 py-6">
                      {getStatusBadge(req.status)}
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <select
                          className="cursor-pointer rounded-xl border-none bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all hover:bg-slate-200 focus:ring-2 focus:ring-blue-500/20"
                          value={req.status}
                          disabled={updatingId === req.id}
                          onChange={(e) => updateStatus(req.id, e.target.value)}
                        >
                          <option value="nova">Nova</option>
                          <option value="em andamento">Em analise</option>
                          <option value="resolvida">Resolvida</option>
                        </select>
                        {updatingId === req.id && <Loader2 className="animate-spin text-blue-600" size={16} />}
                        <button
                          type="button"
                          onClick={() => removeRequest(req)}
                          disabled={removingId === req.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 transition-all hover:-translate-y-0.5 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Remover chamado"
                        >
                          {removingId === req.id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {error?.includes('carregar') && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          <ShieldAlert size={18} />
          Se esta tela falhar por coluna inexistente, aplique a migration de suporte no Supabase.
        </div>
      )}
    </InternalLayout>
  );
}
