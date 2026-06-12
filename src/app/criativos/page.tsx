'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Loader2, MessageSquare, Palette, XCircle, Download } from 'lucide-react';

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
  const [expandedAssetUrl, setExpandedAssetUrl] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedAssetUrl(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

    // Trigger designer notification on status change (approval or revision request)
    if (status === 'aprovado' || status === 'revisao') {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        await fetch('/api/criativos/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            assetId: asset.id,
            status,
            comentario: comentario || '',
          }),
        }).catch((err) => console.error('Error triggering creative notification:', err));
      }
    }

    setReviewId(null);
    setComment('');
    await fetchAssets();
  };

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-600">Corretor</p>
          <h1 className="text-3xl font-black text-slate-950">Criativos para aprovar</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold text-slate-500">
            Aqui ficam as artes/ofertas entregues pela equipe. Aprove para liberar como criativo rodando ou envie uma revisão com comentário.
          </p>
        </div>
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
                <div 
                  className={`force-white h-32 w-32 shrink-0 overflow-hidden border border-slate-200 ${asset.arquivo_url ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
                  onClick={() => asset.arquivo_url && setExpandedAssetUrl(asset.arquivo_url)}
                  title={asset.arquivo_url ? 'Clique para expandir' : undefined}
                >
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
                    <p className="mt-3 border-l-4 border-blue-400 bg-blue-50 p-3 text-xs font-bold text-blue-900">
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
                        <button onClick={() => updateCreative(asset, 'revisao', comment)} className="flex items-center gap-2 bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-blue-700">
                          <MessageSquare size={15} /> Enviar revisao
                        </button>
                        <button onClick={() => setReviewId(null)} className="px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button onClick={() => updateCreative(asset, 'aprovado')} className="flex items-center gap-2 bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-700 transition-colors">
                        <CheckCircle2 size={15} /> Aprovar
                      </button>
                      <button onClick={() => { setReviewId(asset.id); setComment(asset.comentario_corretor || ''); }} className="flex items-center gap-2 border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                        <XCircle size={15} /> Revisar
                      </button>
                      {asset.arquivo_url && (
                        <a
                          href={asset.arquivo_url}
                          download={asset.titulo}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Download size={15} /> Baixar
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {expandedAssetUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4" onClick={() => setExpandedAssetUrl(null)}>
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <img src={expandedAssetUrl} className="mx-auto max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl" alt="Criativo em tamanho real" />
            <button 
              onClick={() => setExpandedAssetUrl(null)}
              className="absolute -top-10 right-0 text-xs font-black uppercase tracking-widest text-white hover:text-slate-300 flex items-center gap-1.5"
            >
              Fechar ✕
            </button>
          </div>
        </div>
      )}
    </InternalLayout>
  );
}
