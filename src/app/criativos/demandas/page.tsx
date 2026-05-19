'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCorretoresOptions } from '@/hooks/useCorretoresOptions';
import { supabase } from '@/lib/supabase/client';
import { CalendarDays, ClipboardList, Loader2, Plus, Upload } from 'lucide-react';

type Demand = {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo_criativo: 'novo_criativo' | 'otimizacao';
  corretor_id: string | null;
  meta_account_id: string | null;
  data_entrega: string | null;
  status: 'pendente' | 'atrasado' | 'feito' | 'entregue' | 'aprovado' | 'revisao';
  created_at: string;
  corretores?: { nome: string | null; meta_ad_account_name?: string | null } | null;
};

const initialForm = {
  corretor_id: '',
  titulo: '',
  descricao: '',
  tipo_criativo: 'novo_criativo',
  meta_account_id: '',
  data_entrega: '',
};

function visibleStatus(demand: Demand) {
  if (demand.status !== 'pendente') return demand.status;
  if (demand.data_entrega && new Date(`${demand.data_entrega}T23:59:59`) < new Date()) return 'atrasado';
  return 'pendente';
}

function statusClass(status: string) {
  if (status === 'entregue' || status === 'aprovado' || status === 'feito') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'atrasado') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'revisao') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export default function CreativeDemandsPage() {
  const { profile } = useAuth();
  const { corretores } = useCorretoresOptions();
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const canUpload = ['admin', 'designer', 'account_manager'].includes(profile?.tipo_usuario || '');

  const selectedCorretor = useMemo(() => {
    return corretores.find((corretor) => corretor.id === form.corretor_id);
  }, [corretores, form.corretor_id]);

  const fetchDemands = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('criativo_demandas')
      .select('*, corretores:corretor_id(nome, meta_ad_account_name)')
      .order('created_at', { ascending: false });

    setDemands((data || []) as Demand[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchDemands();
  }, []);

  useEffect(() => {
    if (selectedCorretor?.meta_ad_account_id) {
      setForm((current) => ({ ...current, meta_account_id: selectedCorretor.meta_ad_account_id || '' }));
    }
  }, [selectedCorretor?.meta_ad_account_id]);

  const createDemand = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.id) return;

    setSaving(true);
    const { error } = await supabase.from('criativo_demandas').insert([{
      corretor_id: form.corretor_id || profile.corretor_id,
      titulo: form.titulo,
      descricao: form.descricao || null,
      tipo_criativo: form.tipo_criativo,
      meta_account_id: form.meta_account_id || null,
      data_entrega: form.data_entrega || null,
      solicitante_profile_id: profile.id,
      status: 'pendente',
    }]);

    setSaving(false);
    if (error) {
      alert('Erro ao criar demanda: ' + error.message);
      return;
    }

    setForm(initialForm);
    await fetchDemands();
  };

  const uploadCreative = async (event: React.FormEvent<HTMLFormElement>, demand: Demand) => {
    event.preventDefault();
    if (!demand.corretor_id) return;

    const data = new FormData(event.currentTarget);
    const file = data.get('file');
    if (!(file instanceof File) || !file.name) return;

    setUploadingId(demand.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const body = new FormData();
    body.set('file', file);
    body.set('demanda_id', demand.id);
    body.set('corretor_id', demand.corretor_id);
    body.set('titulo', String(data.get('titulo') || demand.titulo));
    body.set('descricao', String(data.get('descricao') || demand.descricao || ''));

    const response = await fetch('/api/criativos/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });

    const payload = await response.json();
    setUploadingId(null);
    if (!response.ok) {
      alert(payload.error || 'Erro ao subir criativo.');
      return;
    }

    event.currentTarget.reset();
    await fetchDemands();
  };

  return (
    <InternalLayout>
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-widest text-blue-600">Criacao</p>
        <h1 className="text-3xl font-black text-slate-950">Demandas criativas</h1>
        <p className="mt-2 text-sm font-bold text-slate-500">
          Solicite criativos, acompanhe prazos e entregue arquivos para aprovacao do corretor.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <form onSubmit={createDemand} className="border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <Plus className="text-blue-600" size={18} />
            <h2 className="text-lg font-black text-slate-950">Nova demanda</h2>
          </div>
          <div className="space-y-4">
            {profile?.tipo_usuario !== 'corretor' && (
              <select required value={form.corretor_id} onChange={(event) => setForm({ ...form, corretor_id: event.target.value })} className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500">
                <option value="">Selecione o corretor</option>
                {corretores.map((corretor) => <option key={corretor.id} value={corretor.id}>{corretor.nome}</option>)}
              </select>
            )}
            <select value={form.tipo_criativo} onChange={(event) => setForm({ ...form, tipo_criativo: event.target.value })} className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500">
              <option value="novo_criativo">Novo criativo</option>
              <option value="otimizacao">Otimizacao</option>
            </select>
            <input required value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} placeholder="Titulo da demanda" className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500" />
            <input value={form.meta_account_id} onChange={(event) => setForm({ ...form, meta_account_id: event.target.value })} placeholder="Conta Meta / campanha" className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500" />
            <input type="date" value={form.data_entrega} onChange={(event) => setForm({ ...form, data_entrega: event.target.value })} className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500" />
            <textarea value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} placeholder="Briefing, formato, observacoes..." className="min-h-28 w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500" />
            <button disabled={saving} className="flex w-full items-center justify-center gap-2 bg-blue-600 p-4 text-sm font-black uppercase tracking-widest text-white disabled:opacity-50">
              {saving ? <Loader2 className="animate-spin" size={18} /> : <ClipboardList size={18} />} Criar demanda
            </button>
          </div>
        </form>

        <div className="space-y-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center bg-white">
              <Loader2 className="animate-spin text-blue-600" size={34} />
            </div>
          ) : demands.length === 0 ? (
            <div className="border border-dashed border-slate-200 bg-white p-12 text-center text-sm font-black uppercase tracking-widest text-slate-400">
              Nenhuma demanda criada
            </div>
          ) : demands.map((demand) => {
            const status = visibleStatus(demand);
            return (
              <div key={demand.id} className="border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col justify-between gap-4 lg:flex-row">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusClass(status)}`}>{status}</span>
                      <span className="bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">{demand.tipo_criativo === 'otimizacao' ? 'Otimizacao' : 'Novo criativo'}</span>
                    </div>
                    <h2 className="mt-3 text-xl font-black text-slate-950">{demand.titulo}</h2>
                    <p className="mt-1 text-sm font-bold text-slate-500">{demand.descricao || 'Sem briefing detalhado'}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-black uppercase tracking-widest text-slate-500">
                      <span>{demand.corretores?.nome || 'Sem corretor'}</span>
                      <span>{demand.meta_account_id || demand.corretores?.meta_ad_account_name || 'Sem conta'}</span>
                      <span className="flex items-center gap-1"><CalendarDays size={13} /> {demand.data_entrega || 'Sem prazo'}</span>
                    </div>
                  </div>

                  {canUpload && demand.corretor_id && (
                    <form onSubmit={(event) => uploadCreative(event, demand)} className="min-w-full space-y-2 lg:min-w-[320px]">
                      <input name="titulo" placeholder="Titulo do arquivo" className="w-full border border-slate-200 bg-slate-50 p-2 text-xs font-bold outline-none focus:border-blue-500" />
                      <input name="descricao" placeholder="Descricao curta" className="w-full border border-slate-200 bg-slate-50 p-2 text-xs font-bold outline-none focus:border-blue-500" />
                      <input name="file" type="file" accept="image/*,video/*,.pdf" required className="w-full border border-slate-200 bg-white p-2 text-xs font-bold" />
                      <button disabled={uploadingId === demand.id} className="flex w-full items-center justify-center gap-2 bg-slate-950 p-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                        {uploadingId === demand.id ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />} Entregar criativo
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </InternalLayout>
  );
}
