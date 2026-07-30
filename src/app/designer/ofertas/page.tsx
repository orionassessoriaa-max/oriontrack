'use client';

import { useCallback, useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useCorretoresOptions } from '@/hooks/useCorretoresOptions';
import { supabase } from '@/lib/supabase/client';
import { Check, Loader2, Send, Upload } from 'lucide-react';

type Asset = {
  id: string;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  status: string;
  created_at: string;
  corretores?: { nome: string | null } | null;
};

export default function DesignerOffersPage() {
  const { corretores } = useCorretoresOptions();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [corretorId, setCorretorId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from('criativo_assets')
      .select('*, corretores:corretor_id(nome)')
      .order('created_at', { ascending: false });

    setAssets((data || []) as Asset[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchAssets(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchAssets]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;

    setUploading(true);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const body = new FormData();
    body.set('file', file);
    body.set('corretor_id', corretorId);
    body.set('titulo', titulo);
    body.set('descricao', descricao);

    const response = await fetch('/api/criativos/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });

    const payload = await response.json();
    setUploading(false);
    if (!response.ok) {
      alert(payload.error || 'Erro ao subir criativo.');
      return;
    }

    setTitulo('');
    setDescricao('');
    setCorretorId('');
    setFile(null);
    await fetchAssets();
  };

  const sendForApproval = async (asset: Asset) => {
    setSendingId(asset.id);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const response = await fetch('/api/criativos/approval', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: asset.id }),
    });
    const payload = await response.json().catch(() => ({}));
    setSendingId(null);
    if (!response.ok) {
      alert(payload.error || 'Erro ao enviar para aprovação.');
      return;
    }
    await fetchAssets();
  };

  return (
    <InternalLayout>
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-widest text-blue-600">Designer</p>
        <h1 className="text-3xl font-black text-slate-950">Ofertas e criativos enviados</h1>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <form onSubmit={submit} className="border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-5 text-lg font-black text-slate-950">Subir criativo</h2>
          <div className="space-y-4">
            <select required value={corretorId} onChange={(event) => setCorretorId(event.target.value)} className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500">
              <option value="">Selecione o corretor</option>
              {corretores.map((corretor) => <option key={corretor.id} value={corretor.id}>{corretor.nome}</option>)}
            </select>
            <input required value={titulo} onChange={(event) => setTitulo(event.target.value)} placeholder="Titulo do criativo" className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500" />
            <textarea value={descricao} onChange={(event) => setDescricao(event.target.value)} placeholder="Observacoes" className="min-h-24 w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500" />
            <input required type="file" accept="image/*,video/*,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} className="w-full border border-slate-200 bg-white p-3 text-sm font-bold" />
            <button disabled={uploading} className="flex w-full items-center justify-center gap-2 bg-blue-600 p-4 text-sm font-black uppercase tracking-widest text-white disabled:opacity-50">
              {uploading ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />} Enviar
            </button>
          </div>
        </form>

        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-black text-slate-950">Historico</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {assets.map((asset) => (
              <div key={asset.id} className="flex items-center gap-4 p-4">
                <div className="h-16 w-16 overflow-hidden border border-slate-200 bg-slate-50">
                  {asset.arquivo_url ? <img src={asset.arquivo_url} alt={asset.titulo} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-slate-950">{asset.titulo}</p>
                  <p className="text-xs font-bold text-slate-500">{asset.corretores?.nome || 'Sem corretor'} • {asset.status}</p>
                </div>
                <div className="flex items-center gap-2">
                  {asset.arquivo_url && <a href={asset.arquivo_url} target="_blank" className="text-xs font-black uppercase tracking-widest text-blue-600">Abrir</a>}
                  {['rascunho', 'revisao'].includes(asset.status) ? (
                    <button
                      type="button"
                      onClick={() => void sendForApproval(asset)}
                      disabled={sendingId === asset.id}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-[10px] font-black uppercase tracking-wide text-white disabled:opacity-50"
                    >
                      {sendingId === asset.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                      Enviar para aprovação
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600">
                      <Check size={13} /> Enviado
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}
