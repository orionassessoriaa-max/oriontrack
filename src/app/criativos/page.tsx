'use client';

import { useCallback, useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import CreativeLibrary from '@/components/creatives/CreativeLibrary';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Loader2, MessageSquare, Palette, XCircle, Download, Radio, ImageIcon, RefreshCw, Maximize2 } from 'lucide-react';

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

type ActiveMetaCreative = {
  id: string;
  ad_name: string;
  creative_name: string | null;
  title: string | null;
  body: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  status: 'ACTIVE';
  source?: 'meta' | 'crm';
};

function bestMetaImage(creative: ActiveMetaCreative) {
  if (creative.image_url) return creative.image_url;
  return String(creative.thumbnail_url || '')
    .replace(/\/p\d+x\d+\//g, '/p1080x1080/')
    .replace(/s\d+x\d+/, 's1080x1080')
    .replace(/\/\d+x\d+\//g, '/1080x1080/');
}

function normalizeCreativeName(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function activeCreativeImage(creative: ActiveMetaCreative, assets: CreativeAsset[]) {
  const metaImage = bestMetaImage(creative);
  if (metaImage) return metaImage;
  const names = [creative.ad_name, creative.creative_name, creative.title]
    .map(normalizeCreativeName)
    .filter(Boolean);
  return assets.find((asset) => {
    const assetName = normalizeCreativeName(asset.titulo);
    return asset.arquivo_url && names.some((name) => name.includes(assetName) || assetName.includes(name));
  })?.arquivo_url || '';
}

function statusLabel(status: CreativeAsset['status']) {
  if (status === 'aprovado') return 'Aprovado';
  if (status === 'revisao') return 'Em revisao';
  if (status === 'rodando') return 'Rodando';
  return 'Aguardando aprovacao';
}

export default function BrokerCreativesPage() {
  const { profile, actualProfile } = useAuth();
  const [assets, setAssets] = useState<CreativeAsset[]>([]);
  const [activeCreatives, setActiveCreatives] = useState<ActiveMetaCreative[]>([]);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [accountConnected, setAccountConnected] = useState<boolean | null>(null);
  const [concessionariaName, setConcessionariaName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  const fetchAssets = useCallback(async (silent = false) => {
    if (!profile) {
      setLoading(false);
      return;
    }

    if (silent) setRefreshing(true);
    else setLoading(true);
    setActiveError(null);
    try {
      const sessionResult = await supabase.auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) {
        setActiveError('Sessão expirada. Entre novamente para consultar a Meta.');
        setActiveCreatives([]);
        setAccountConnected(null);
        return;
      }

      const params = new URLSearchParams();
      if (actualProfile?.tipo_usuario === 'admin' && profile.corretor_id) {
        params.set('corretor_id', profile.corretor_id);
      }
      const [activeResponse, approvalResponse] = await Promise.all([
        fetch(`/api/criativos/ativos-meta?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(`/api/criativos/approval?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ]);
      const [activePayload, approvalPayload] = await Promise.all([
        activeResponse.json().catch(() => ({})),
        approvalResponse.json().catch(() => ({})),
      ]);
      if (!approvalResponse.ok) {
        setActiveError(approvalPayload.error || 'Não foi possível carregar os materiais para aprovação.');
        setAssets([]);
      } else {
        setAssets((approvalPayload.assets || []) as CreativeAsset[]);
      }
      if (!activeResponse.ok) {
        setActiveError(activePayload.error || 'Não foi possível consultar os criativos ativos.');
        setActiveCreatives([]);
        setAccountConnected(null);
        return;
      }

      setConcessionariaName(activePayload.concessionaria || approvalPayload.concessionaria || null);
      setAccountConnected(activePayload.account_connected !== false);
      setActiveCreatives((activePayload.creatives || []) as ActiveMetaCreative[]);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, [actualProfile?.tipo_usuario, profile?.corretor_id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchAssets(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchAssets]);

  const updateCreative = async (asset: CreativeAsset, status: CreativeAsset['status'], comentario?: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const response = await fetch('/api/criativos/approval', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        asset_id: asset.id,
        corretor_id: actualProfile?.tipo_usuario === 'admin' ? profile?.corretor_id : null,
        status,
        comentario: comentario || '',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(payload.error || 'Erro ao atualizar criativo.');
      return;
    }

    // Trigger designer notification on status change (approval or revision request)
    if (status === 'aprovado' || status === 'revisao') {
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

  if (profile?.tipo_usuario === 'gestor_trafego') {
    const gestorId = actualProfile?.tipo_usuario === 'admin' ? profile.id : null;
    return (
      <InternalLayout>
        <CreativeLibrary managerName={profile.nome} gestorId={gestorId} />
      </InternalLayout>
    );
  }

  const crmActiveCreatives: ActiveMetaCreative[] = assets
    .filter((asset) => asset.status === 'rodando')
    .map((asset) => ({
      id: `crm-${asset.id}`,
      ad_name: asset.titulo,
      creative_name: asset.titulo,
      title: asset.descricao,
      body: null,
      image_url: asset.arquivo_url,
      thumbnail_url: null,
      status: 'ACTIVE',
      source: 'crm',
    }));
  const visibleActiveCreatives = activeCreatives.length > 0 ? activeCreatives : crmActiveCreatives;
  const usingCrmFallback = activeCreatives.length === 0 && crmActiveCreatives.length > 0;

  return (
    <InternalLayout>
      <div className="mb-8 overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.16),transparent_42%),linear-gradient(135deg,#071521,#0b172b_58%,#07111f)] p-6 shadow-2xl shadow-cyan-950/20 sm:p-8">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-400">Central do cliente</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Seus criativos</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-relaxed text-slate-300">
            Aqui ficam as artes/ofertas entregues pela equipe. Aprove para liberar como criativo rodando ou envie uma revisão com comentário.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-[28px] border border-slate-800 bg-slate-950/40">
          <Loader2 className="animate-spin text-cyan-400" size={34} />
        </div>
      ) : (
        <>
          <section className="mb-10 overflow-hidden rounded-[28px] border border-emerald-400/15 bg-[#07111f] p-5 shadow-xl shadow-slate-950/20 sm:p-7">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </span>
                  <Radio size={15} />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em]">Rodando agora</p>
                </div>
                <h2 className="mt-2 text-2xl font-black text-white">Criativos ativos na Meta</h2>
                <p className="mt-1 text-sm font-semibold text-slate-400">
                  {concessionariaName ? `Anúncios ativos de ${concessionariaName}.` : 'Anúncios ativos da sua concessionária.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {visibleActiveCreatives.length > 0 && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-300">
                    {visibleActiveCreatives.length} ativo{visibleActiveCreatives.length === 1 ? '' : 's'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void fetchAssets(true)}
                  disabled={refreshing}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-xs font-black text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-300 disabled:cursor-wait disabled:opacity-60"
                >
                  <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                  Atualizar
                </button>
              </div>
            </div>

            {activeError && visibleActiveCreatives.length === 0 ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5 text-sm font-bold text-amber-200">
                {activeError}
              </div>
            ) : accountConnected === false && visibleActiveCreatives.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-amber-400/25 bg-amber-400/5 p-9 text-center">
                <ImageIcon className="mx-auto text-amber-300" size={38} />
                <p className="mt-3 text-base font-black text-white">Conta Meta ainda não vinculada</p>
                <p className="mx-auto mt-2 max-w-lg text-sm font-semibold text-slate-400">
                  Assim que a conta de anúncios for vinculada à sua concessionária, os criativos ativos aparecerão aqui automaticamente.
                </p>
              </div>
            ) : visibleActiveCreatives.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/50 p-10 text-center">
                <ImageIcon className="mx-auto text-slate-600" size={38} />
                <p className="mt-3 text-sm font-black text-slate-500">Nenhum criativo ativo encontrado na Meta.</p>
              </div>
            ) : (
              <>
                {usingCrmFallback && (
                  <div className="mb-5 rounded-2xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-xs font-semibold text-cyan-100">
                    Exibindo o criativo marcado como rodando no CRM enquanto a consulta da Meta não está disponível.
                  </div>
                )}
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleActiveCreatives.map((creative) => {
                  const imageUrl = activeCreativeImage(creative, assets);
                  return (
                    <article key={creative.id} className="group overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-lg transition duration-200 hover:-translate-y-1 hover:border-emerald-400/30 hover:shadow-emerald-950/30">
                      <button
                        type="button"
                        disabled={!imageUrl}
                        onClick={() => imageUrl && setExpandedAssetUrl(imageUrl)}
                        className="relative block aspect-[4/5] w-full overflow-hidden bg-slate-950 text-left disabled:cursor-default"
                        aria-label={imageUrl ? `Ampliar criativo ${creative.ad_name}` : 'Imagem indisponível'}
                      >
                        {imageUrl ? (
                          <img src={imageUrl} alt={creative.ad_name} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.025]" />
                        ) : (
                          <span className="flex h-full items-center justify-center text-xs font-black uppercase tracking-widest text-slate-300">
                            Imagem indisponível
                          </span>
                        )}
                        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-emerald-500/95 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white shadow-lg backdrop-blur">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                          {creative.source === 'crm' ? 'Rodando no CRM' : 'Rodando na Meta'}
                        </span>
                        {imageUrl && (
                          <span className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-slate-950/75 text-white opacity-0 shadow-lg backdrop-blur transition group-hover:opacity-100">
                            <Maximize2 size={17} />
                          </span>
                        )}
                      </button>
                      <div className="p-5">
                        <p className="truncate text-base font-black text-white">{creative.ad_name}</p>
                        <p className="mt-2 line-clamp-3 text-xs font-semibold leading-relaxed text-slate-400">
                          {creative.title || creative.body || creative.creative_name || 'Criativo ativo na conta Meta'}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
              </>
            )}
          </section>

          <section>
            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">Equipe criativa</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">Materiais para aprovação</h2>
            </div>

            {assets.length === 0 ? (
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
          </section>
        </>
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
