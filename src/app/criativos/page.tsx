'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Loader2, MessageSquare, Palette, XCircle } from 'lucide-react';

type CreativeAsset = {
  id: string;
  demanda_id: string | null;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  status: 'em_aprovacao' | 'aprovado' | 'revisao' | 'rodando';
  comentario_corretor: string | null;
  created_at: string;
};

function statusLabel(status: CreativeAsset['status']) {
  if (status === 'aprovado') return 'Aprovado';
  if (status === 'revisao') return 'Em revisao';
  if (status === 'rodando') return 'Rodando';
  return 'Aguardando aprovacao';
}

export default function BrokerCreativesPage() {
  const { profile } = useAuth();
  const [assets, setAssets] = useState<CreativeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const fetchAssets = async () => {
    if (!profile?.corretor_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('criativo_assets')
      .select('*')
      .eq('corretor_id', profile.corretor_id)
      .order('created_at', { ascending: false });

    setAssets((data || []) as CreativeAsset[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAssets();
  }, [profile?.corretor_id]);

  const updateCreative = async (asset: CreativeAsset, status: CreativeAsset['status'], comentario?: string) => {
    const { error } = await supabase
      .from('criativo_assets')
      .update({
        status,
        comentario_corretor: comentario || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);

    if (error) {
      alert('Erro ao atualizar criativo: ' + error.message);
      return;
    }

    if (asset.demanda_id && (status === 'aprovado' || status === 'revisao')) {
      await supabase
        .from('criativo_demandas')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', asset.demanda_id);
    }

    setReviewId(null);
    setComment('');
    await fetchAssets();
  };

  return (
    <InternalLayout>
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-widest text-blue-600">Corretor</p>
        <h1 className="text-3xl font-black text-slate-950">Criativos para aprovar</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold text-slate-500">
          Aqui ficam as artes/ofertas entregues pela equipe. Aprove para liberar como criativo rodando ou envie uma revisao com comentario.
        </p>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center bg-white">
          <Loader2 className="animate-spin text-blue-600" size={34} />
        </div>
      ) : assets.length === 0 ? (
        <div className="border border-dashed border-slate-200 bg-white p-12 text-center">
          <Palette className="mx-auto text-slate-300" size={42} />
          <p className="mt-4 text-sm font-black uppercase tracking-widest text-slate-400">Nenhum criativo enviado ainda</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {assets.map((asset) => (
            <div key={asset.id} className="border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex gap-4">
                <div className="h-32 w-32 shrink-0 overflow-hidden border border-slate-200 bg-slate-50">
                  {asset.arquivo_url ? (
                    <img src={asset.arquivo_url} alt={asset.titulo} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs font-black text-slate-300">ARQUIVO</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-black text-slate-950">{asset.titulo}</h2>
                      <p className="mt-1 text-xs font-bold text-slate-500">{asset.descricao || 'Sem descricao'}</p>
                    </div>
                    <span className="whitespace-nowrap bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-700">
                      {statusLabel(asset.status)}
                    </span>
                  </div>

                  {asset.comentario_corretor && (
                    <p className="mt-3 border-l-4 border-amber-400 bg-amber-50 p-3 text-xs font-bold text-amber-900">
                      {asset.comentario_corretor}
                    </p>
                  )}

                  {reviewId === asset.id ? (
                    <div className="mt-4 space-y-3">
                      <textarea
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder="O que precisa revisar?"
                        className="min-h-24 w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => updateCreative(asset, 'revisao', comment)} className="flex items-center gap-2 bg-amber-500 px-4 py-3 text-xs font-black uppercase tracking-widest text-white">
                          <MessageSquare size={15} /> Enviar revisao
                        </button>
                        <button onClick={() => setReviewId(null)} className="px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button onClick={() => updateCreative(asset, 'aprovado')} className="flex items-center gap-2 bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white">
                        <CheckCircle2 size={15} /> Aprovar
                      </button>
                      <button onClick={() => { setReviewId(asset.id); setComment(asset.comentario_corretor || ''); }} className="flex items-center gap-2 border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700">
                        <XCircle size={15} /> Revisar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </InternalLayout>
  );
}
