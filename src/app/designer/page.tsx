'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { useDialog } from '@/components/providers/DialogProvider';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, ChevronRight, Clock, Loader2, MessageSquare, Palette, Send, Trash2, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type DemandStatus = 'pendente' | 'atrasado' | 'feito' | 'entregue' | 'aprovado' | 'revisao';
type AssetStatus = 'rascunho' | 'em_aprovacao' | 'aprovado' | 'revisao' | 'rodando';
type FilterKey = 'pendentes' | 'atrasadas' | 'entregues' | 'aprovados' | 'revisao' | 'arquivos';

type Demand = {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo_criativo: 'novo_criativo' | 'otimizacao';
  corretor_id: string | null;
  meta_account_id: string | null;
  data_entrega: string | null;
  status: DemandStatus;
  created_at: string;
  corretores?: { nome: string | null; time_operacional?: unknown } | null;
};

type CreativeAsset = {
  id: string;
  demanda_id: string | null;
  corretor_id: string | null;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  status: AssetStatus;
  comentario_corretor: string | null;
  created_at: string;
  corretores?: { nome: string | null; time_operacional?: unknown } | null;
};

function visibleStatus(demand: Demand) {
  if (demand.status !== 'pendente') return demand.status;
  if (demand.data_entrega && new Date(`${demand.data_entrega}T23:59:59`) < new Date()) return 'atrasado';
  return 'pendente';
}

function statusClass(status: string) {
  if (status === 'aprovado' || status === 'entregue' || status === 'feito') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (status === 'revisao') return 'bg-blue-500/10 text-cyan-400 border-cyan-500/20';
  if (status === 'atrasado') return 'bg-red-500/10 text-red-400 border-red-500/20';
  return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
}

function isResponsibleForDesigner(item: Demand | CreativeAsset, profileId?: string | null) {
  if (!profileId) return true;
  const team = item.corretores?.time_operacional;
  if (!Array.isArray(team)) return true;
  return team.some((member) => {
    if (!member || typeof member !== 'object') return false;
    const data = member as { profile_id?: string; id?: string };
    return data.profile_id === profileId || data.id === profileId;
  });
}

export default function DesignerHomePage() {
  const { profile } = useAuth();
  const { confirmDialog } = useDialog();
  const [filter, setFilter] = useState<FilterKey>('pendentes');
  const [demands, setDemands] = useState<Demand[]>([]);
  const [assets, setAssets] = useState<CreativeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: demandRows }, { data: assetRows }] = await Promise.all([
      supabase
        .from('criativo_demandas')
        .select('*, corretores:corretor_id(nome, time_operacional)')
        .order('created_at', { ascending: false }),
      supabase
        .from('criativo_assets')
        .select('*, corretores:corretor_id(nome, time_operacional)')
        .order('created_at', { ascending: false }),
    ]);

    const shouldFilterByDesigner = profile?.tipo_usuario === 'designer';
    const visibleDemands = ((demandRows || []) as Demand[]).filter((item) =>
      shouldFilterByDesigner ? isResponsibleForDesigner(item, profile?.id) : true
    );
    const visibleAssets = ((assetRows || []) as CreativeAsset[]).filter((item) =>
      shouldFilterByDesigner ? isResponsibleForDesigner(item, profile?.id) : true
    );

    setDemands(visibleDemands);
    setAssets(visibleAssets);
    setLoading(false);
  }, [profile?.id, profile?.tipo_usuario]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const stats = useMemo(() => {
    return {
      pendentes: demands.filter((item) => visibleStatus(item) === 'pendente').length,
      atrasadas: demands.filter((item) => visibleStatus(item) === 'atrasado').length,
      entregues: demands.filter((item) => ['entregue', 'feito'].includes(item.status)).length,
      aprovados: assets.filter((item) => item.status === 'aprovado').length,
      revisao: assets.filter((item) => item.status === 'revisao').length,
      arquivos: assets.length,
    };
  }, [demands, assets]);

  const filteredDemands = demands.filter((item) => {
    const status = visibleStatus(item);
    if (filter === 'pendentes') return status === 'pendente';
    if (filter === 'atrasadas') return status === 'atrasado';
    if (filter === 'entregues') return ['entregue', 'feito'].includes(status);
    return false;
  });

  const filteredAssets = assets.filter((item) => {
    if (filter === 'aprovados') return item.status === 'aprovado';
    if (filter === 'revisao') return item.status === 'revisao';
    if (filter === 'arquivos') return true;
    return false;
  });

  const deleteDemand = async (demand: Demand) => {
    const confirmed = await confirmDialog(`Remover a demanda "${demand.titulo}" e ocultar criativos vinculados?`, {
      title: 'Remover demanda',
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeletingId(demand.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const response = await fetch(`/api/criativos/demandas?id=${demand.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    setDeletingId(null);

    if (!response.ok) {
      alert(payload.error || 'Erro ao remover demanda.');
      return;
    }

    await load();
  };

  const sendForApproval = async (asset: CreativeAsset) => {
    setSendingId(asset.id);
    const { data } = await supabase.auth.getSession();
    const response = await fetch('/api/criativos/approval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ asset_id: asset.id }),
    });
    const payload = await response.json().catch(() => ({}));
    setSendingId(null);
    if (!response.ok) {
      alert(payload.error || 'Erro ao enviar para aprovação.');
      return;
    }
    await load();
  };

  const showingAssets = ['aprovados', 'revisao', 'arquivos'].includes(filter);

  return (
    <InternalLayout>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <p className="text-xs font-black uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
            Designer
          </p>
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">Painel de Criativos</h1>
        <p className="mt-2 text-sm font-semibold text-slate-400">Gerencie demandas, entregue ofertas e acompanhe aprovações e revisões dos corretores.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Counter active={filter === 'pendentes'} onClick={() => setFilter('pendentes')} icon={Clock} label="Pendentes" value={stats.pendentes} tone="blue" />
        <Counter active={filter === 'atrasadas'} onClick={() => setFilter('atrasadas')} icon={Clock} label="Atrasadas" value={stats.atrasadas} tone="red" />
        <Counter active={filter === 'entregues'} onClick={() => setFilter('entregues')} icon={CheckCircle2} label="Entregues" value={stats.entregues} tone="emerald" />
        <Counter active={filter === 'aprovados'} onClick={() => setFilter('aprovados')} icon={CheckCircle2} label="Aprovados" value={stats.aprovados} tone="emerald" />
        <Counter active={filter === 'revisao'} onClick={() => setFilter('revisao')} icon={MessageSquare} label="Para revisar" value={stats.revisao} tone="blue" />
        <Counter active={filter === 'arquivos'} onClick={() => setFilter('arquivos')} icon={Palette} label="Arquivos" value={stats.arquivos} tone="slate" />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="border border-white/5 bg-[#090e1a]/85 p-6 rounded-2xl shadow-xl flex flex-col justify-between min-h-[160px]">
          <div>
            <div className="p-3 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl w-fit">
              <Palette size={24} />
            </div>
            <h2 className="mt-4 text-xl font-black text-white">Kanban de criativos</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Fluxo em reorganizacao para pendente, fazendo e entregue com aprovacao por concessionaria.</p>
          </div>
          <span className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
            Em desenvolvimento
          </span>
        </div>
        <Link href="/designer/ofertas" className="group border border-white/5 bg-[#090e1a]/85 p-6 rounded-2xl shadow-xl transition-all duration-300 hover:border-blue-500/30 hover:shadow-[0_0_30px_rgba(59,130,246,0.08)] flex flex-col justify-between min-h-[160px]">
          <div>
            <div className="p-3 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-xl w-fit group-hover:scale-105 transition-transform">
              <Upload size={24} />
            </div>
            <h2 className="mt-4 text-xl font-black text-white group-hover:text-cyan-400 transition-colors">Ofertas e arquivos</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Selecionar corretor, subir criativos avulsos e consultar histórico de entregas.</p>
          </div>
          <span className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-400 group-hover:text-white transition-colors">
            Subir Arquivos <ChevronRight size={12} />
          </span>
        </Link>
      </div>

      <section className="mt-8 border border-white/5 bg-[#090e1a]/80 backdrop-blur-md rounded-2xl shadow-2xl overflow-hidden mb-12">
        <div className="border-b border-white/5 p-5 bg-white/[0.01]">
          <h2 className="text-lg font-black text-white">
            {showingAssets ? filter === 'revisao' ? 'Criativos para revisar' : filter === 'aprovados' ? 'Criativos aprovados' : 'Arquivos enviados' : 'Demandas'}
          </h2>
          <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Clique nos quadros acima para alternar a lista.</p>
        </div>

        {loading ? (
          <div className="flex h-56 items-center justify-center">
            <Loader2 className="animate-spin text-cyan-400" size={34} />
          </div>
        ) : showingAssets ? (
          filteredAssets.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="divide-y divide-white/5">
              {filteredAssets.map((asset) => (
                <div key={asset.id} className="grid gap-4 p-5 md:grid-cols-[96px_1fr_auto] md:items-center">
                  <div className="h-24 w-24 overflow-hidden border border-white/5 bg-slate-900 rounded-xl flex items-center justify-center relative">
                    {asset.arquivo_url ? (
                      <img src={asset.arquivo_url} alt={asset.titulo} className="h-full w-full object-cover" />
                    ) : (
                      <Palette className="text-slate-700" size={28} />
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`border px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${statusClass(asset.status)}`}>
                        {asset.status.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{asset.corretores?.nome || 'Sem corretor'}</span>
                    </div>
                    <h3 className="mt-2.5 text-lg font-black text-white">{asset.titulo}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-400">{asset.descricao || 'Sem descrição'}</p>
                    {asset.comentario_corretor && (
                      <p className="mt-3 border-l-4 border-cyan-400 bg-cyan-950/20 p-3 rounded-r-xl text-xs font-semibold text-cyan-300">{asset.comentario_corretor}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {asset.arquivo_url && (
                      <a href={asset.arquivo_url} target="_blank" className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2.5 text-center text-xs font-black uppercase tracking-widest text-white rounded-xl transition-colors">
                        Abrir
                      </a>
                    )}
                    {['rascunho', 'revisao'].includes(asset.status) && (
                      <button
                        type="button"
                        onClick={() => void sendForApproval(asset)}
                        disabled={sendingId === asset.id}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-emerald-950 disabled:opacity-50"
                      >
                        {sendingId === asset.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                        Enviar para aprovação
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filteredDemands.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="divide-y divide-white/5">
            {filteredDemands.map((demand) => {
              const status = visibleStatus(demand);
              const canDelete = ['entregue', 'feito', 'aprovado', 'revisao'].includes(status);
              return (
                <div key={demand.id} className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`border px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${statusClass(status)}`}>{status}</span>
                      <span className="bg-white/5 border border-white/5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-400">{demand.tipo_criativo === 'otimizacao' ? 'Otimização' : 'Novo criativo'}</span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{demand.corretores?.nome || 'Sem corretor'}</span>
                    </div>
                    <h3 className="mt-2.5 text-lg font-black text-white">{demand.titulo}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-400">{demand.descricao || 'Sem briefing detalhado'}</p>
                    <p className="mt-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Prazo: <span className="text-slate-400">{demand.data_entrega || 'sem prazo'}</span> | Conta: <span className="text-slate-400">{demand.meta_account_id || 'sem conta'}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canDelete && (
                      <button
                        onClick={() => deleteDemand(demand)}
                        disabled={deletingId === demand.id}
                        className="flex items-center gap-2 border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-red-400 rounded-xl transition-all hover:bg-red-500/15"
                      >
                        {deletingId === demand.id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />} Remover
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </InternalLayout>
  );
}

function Counter({ icon: Icon, label, value, tone, active, onClick }: { icon: LucideIcon; label: string; value: number; tone: string; active: boolean; onClick: () => void }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/15 hover:border-blue-500/35 shadow-blue-500/5',
    red: 'bg-red-500/10 text-red-400 border-red-500/15 hover:border-red-500/35 shadow-red-500/5',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/15 hover:border-emerald-500/35 shadow-emerald-500/5',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/15 hover:border-slate-500/35 shadow-slate-500/5',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`border p-5 text-left rounded-2xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${tones[tone]} ${active ? 'ring-2 ring-cyan-500/50 ring-offset-2 ring-offset-[#020617]' : ''}`}
    >
      <Icon size={20} className="stroke-[2.5]" />
      <p className="mt-4 text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black text-white">{value}</p>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="p-16 text-center opacity-65">
      <Palette className="mx-auto text-slate-700 mb-4" size={38} />
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">Nenhum criativo ou demanda nesta etapa</p>
    </div>
  );
}
