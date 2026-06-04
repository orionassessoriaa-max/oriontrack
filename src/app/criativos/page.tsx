import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Loader2, MessageSquare, Palette, XCircle, Plus, X, Calendar, ClipboardList } from 'lucide-react';

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
};

const initialForm = {
  titulo: '',
  descricao: '',
  tipo_criativo: 'novo_criativo' as 'novo_criativo' | 'otimizacao',
  meta_account_id: '',
  data_entrega: '',
};

function statusLabel(status: CreativeAsset['status']) {
  if (status === 'aprovado') return 'Aprovado';
  if (status === 'revisao') return 'Em revisao';
  if (status === 'rodando') return 'Rodando';
  return 'Aguardando aprovacao';
}

function demandStatusLabel(status: string) {
  if (status === 'pendente') return 'Aguardando criação';
  if (status === 'atrasado') return 'Atrasado';
  if (status === 'feito') return 'Concluído';
  if (status === 'entregue') return 'Entregue para aprovação';
  if (status === 'aprovado') return 'Aprovado';
  if (status === 'revisao') return 'Em revisão';
  return 'Pendente';
}

function demandStatusClass(status: string) {
  if (status === 'aprovado' || status === 'feito') return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
  if (status === 'entregue') return 'bg-blue-500/10 border border-blue-500/20 text-blue-400';
  if (status === 'atrasado') return 'bg-red-500/10 border border-red-500/20 text-red-400';
  if (status === 'revisao') return 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400';
  return 'bg-slate-500/10 border border-slate-500/20 text-slate-400';
}

export default function BrokerCreativesPage() {
  const { profile } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'assets' | 'demands'>('assets');
  const [assets, setAssets] = useState<CreativeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  // Demands state
  const [demands, setDemands] = useState<Demand[]>([]);
  const [demandsLoading, setDemandsLoading] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [corretorData, setCorretorData] = useState<any>(null);
  const [form, setForm] = useState(initialForm);
  const [savingDemand, setSavingDemand] = useState(false);

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

  const fetchDemands = async () => {
    if (!profile?.corretor_id) return;

    setDemandsLoading(true);
    const { data } = await supabase
      .from('criativo_demandas')
      .select('*')
      .eq('corretor_id', profile.corretor_id)
      .order('created_at', { ascending: false });

    setDemands((data || []) as Demand[]);
    setDemandsLoading(false);
  };

  const fetchCorretorInfo = async () => {
    if (!profile?.corretor_id) return;
    const { data } = await supabase
      .from('corretores')
      .select('*')
      .eq('id', profile.corretor_id)
      .maybeSingle();

    if (data) {
      setCorretorData(data);
      setForm((prev) => ({
        ...prev,
        meta_account_id: data.meta_ad_account_name || data.meta_ad_account_id || '',
      }));
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchAssets();
    fetchDemands();
    fetchCorretorInfo();
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
    await fetchDemands();
  };

  const handleCreateDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.id || !profile?.corretor_id) return;

    setSavingDemand(true);
    const { error } = await supabase.from('criativo_demandas').insert([{
      corretor_id: profile.corretor_id,
      titulo: form.titulo,
      descricao: form.descricao || null,
      tipo_criativo: form.tipo_criativo,
      meta_account_id: form.meta_account_id || null,
      data_entrega: form.data_entrega || null,
      solicitante_profile_id: profile.id,
      status: 'pendente',
    }]);

    setSavingDemand(false);
    if (error) {
      alert('Erro ao solicitar criativo: ' + error.message);
      return;
    }

    setForm({
      titulo: '',
      descricao: '',
      tipo_criativo: 'novo_criativo',
      meta_account_id: corretorData?.meta_ad_account_name || corretorData?.meta_ad_account_id || '',
      data_entrega: '',
    });
    setShowRequestModal(false);
    await fetchDemands();
    setActiveTab('demands');
  };

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-600">Corretor</p>
          <h1 className="text-3xl font-black text-slate-950">Criativos & Artes</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold text-slate-500">
            Aprove artes enviadas pela equipe ou solicite novos criativos e otimizações.
          </p>
        </div>
        <button
          onClick={() => setShowRequestModal(true)}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold px-5 py-3.5 text-xs uppercase tracking-widest transition-all rounded-xl shadow-md shrink-0"
        >
          <Plus size={16} /> Solicitar Novo Criativo
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('assets')}
          className={`px-6 py-3 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${
            activeTab === 'assets'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          Criativos para aprovar ({assets.length})
        </button>
        <button
          onClick={() => setActiveTab('demands')}
          className={`px-6 py-3 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${
            activeTab === 'demands'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          Minhas solicitações ({demands.length})
        </button>
      </div>

      {activeTab === 'assets' ? (
        loading ? (
          <div className="flex h-64 items-center justify-center bg-white">
            <Loader2 className="animate-spin text-blue-600" size={34} />
          </div>
        ) : assets.length === 0 ? (
          <div className="border border-dashed border-slate-200 bg-white p-12 text-center rounded-2xl">
            <Palette className="mx-auto text-slate-300" size={42} />
            <p className="mt-4 text-sm font-black uppercase tracking-widest text-slate-400">Nenhum criativo enviado ainda</p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {assets.map((asset) => (
              <div key={asset.id} className="border border-slate-200 bg-white p-5 shadow-sm rounded-2xl">
                <div className="flex gap-4">
                  <div className="force-white h-32 w-32 shrink-0 overflow-hidden border border-slate-200 rounded-xl">
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
                      <span className="whitespace-nowrap bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-700 rounded-full">
                        {statusLabel(asset.status)}
                      </span>
                    </div>

                    {asset.comentario_corretor && (
                      <p className="mt-3 border-l-4 border-blue-400 bg-blue-50/50 p-3 text-xs font-bold text-blue-900 rounded-r-lg">
                        {asset.comentario_corretor}
                      </p>
                    )}

                    {reviewId === asset.id ? (
                      <div className="mt-4 space-y-3">
                        <textarea
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          placeholder="O que precisa revisar?"
                          className="min-h-24 w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500 rounded-xl"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => updateCreative(asset, 'revisao', comment)} className="flex items-center gap-2 bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-blue-700 rounded-xl">
                            <MessageSquare size={15} /> Enviar revisao
                          </button>
                          <button onClick={() => setReviewId(null)} className="px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500 rounded-xl">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 flex flex-wrap gap-2">
                        <button onClick={() => updateCreative(asset, 'aprovado')} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white rounded-xl">
                          <CheckCircle2 size={15} /> Aprovar
                        </button>
                        <button onClick={() => { setReviewId(asset.id); setComment(asset.comentario_corretor || ''); }} className="flex items-center gap-2 border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 rounded-xl">
                          <XCircle size={15} /> Revisar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        demandsLoading ? (
          <div className="flex h-64 items-center justify-center bg-white">
            <Loader2 className="animate-spin text-blue-600" size={34} />
          </div>
        ) : demands.length === 0 ? (
          <div className="border border-dashed border-slate-200 bg-white p-12 text-center rounded-2xl">
            <ClipboardList className="mx-auto text-slate-300" size={42} />
            <p className="mt-4 text-sm font-black uppercase tracking-widest text-slate-400">Nenhuma solicitação feita ainda</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {demands.map((demand) => (
              <div key={demand.id} className="border border-slate-200 bg-white p-5 rounded-2xl shadow-sm flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${demandStatusClass(demand.status)}`}>
                      {demandStatusLabel(demand.status)}
                    </span>
                    <span className="bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-slate-200/50">
                      {demand.tipo_criativo === 'otimizacao' ? 'Otimização' : 'Novo criativo'}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-black text-slate-950">{demand.titulo}</h3>
                  <p className="mt-1 text-xs font-bold text-slate-500 whitespace-pre-wrap">{demand.descricao || 'Sem briefing detalhado'}</p>
                </div>
                <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                  <span>Conta: {demand.meta_account_id || 'Não informada'}</span>
                  <span className="flex items-center gap-1">
                    <Calendar size={13} /> {demand.data_entrega ? new Date(demand.data_entrega).toLocaleDateString('pt-BR') : 'Sem prazo'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Modal: Solicitar Novo Criativo */}
      {mounted && showRequestModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-[#090e1a]/95 border border-white/10 w-full max-w-lg rounded-3xl p-6 shadow-2xl relative">
            <button
              onClick={() => setShowRequestModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
            <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
              <Palette className="text-blue-500" size={20} /> Solicitar Novo Criativo
            </h3>
            <p className="text-xs font-semibold text-slate-500 mb-6">Briefing de artes, vídeos ou otimização de campanhas rodando.</p>
            
            <form onSubmit={handleCreateDemand} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Título da Demanda *</label>
                <input
                  required
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ex: Campanha Bradesco Saúde PME"
                  className="w-full border border-white/10 bg-slate-900/50 p-3.5 text-sm font-bold text-white rounded-xl outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Tipo de Solicitação</label>
                  <select
                    value={form.tipo_criativo}
                    onChange={(e) => setForm({ ...form, tipo_criativo: e.target.value as 'novo_criativo' | 'otimizacao' })}
                    className="w-full border border-white/10 bg-slate-900/50 p-3.5 text-sm font-bold text-white rounded-xl outline-none focus:border-blue-500"
                  >
                    <option value="novo_criativo">Novo criativo</option>
                    <option value="otimizacao">Otimização</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Prazo Desejado</label>
                  <input
                    type="date"
                    value={form.data_entrega}
                    onChange={(e) => setForm({ ...form, data_entrega: e.target.value })}
                    className="w-full border border-white/10 bg-slate-900/50 p-3.5 text-sm font-bold text-white rounded-xl outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Conta de Anúncio / Campanha</label>
                <input
                  value={form.meta_account_id}
                  onChange={(e) => setForm({ ...form, meta_account_id: e.target.value })}
                  placeholder="Selecione ou digite o nome/ID da conta no Meta"
                  className="w-full border border-white/10 bg-slate-900/50 p-3.5 text-sm font-bold text-white rounded-xl outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Descrição / Briefing *</label>
                <textarea
                  required
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                  placeholder="Explique o que precisa: formato (feed/stories), produto, cores, referências, textos que devem conter, etc."
                  className="min-h-28 w-full border border-white/10 bg-slate-900/50 p-3.5 text-sm font-bold text-white rounded-xl outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="flex-1 py-3.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingDemand}
                  className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/55 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {savingDemand ? <Loader2 className="animate-spin" size={16} /> : 'Enviar Solicitação'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </InternalLayout>
  );
}

