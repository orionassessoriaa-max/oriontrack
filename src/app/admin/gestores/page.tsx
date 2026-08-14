'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Plus, 
  Search, 
  Edit2,
  Eye,
  Copy,
  Loader2,
  UserCog,
  ShieldAlert,
  RefreshCw,
  Filter,
  Users
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { getTeamMemberPhoto } from '@/lib/orionTeam';

type CreditSummary = {
  available: number;
  limit: number;
  used: number;
  reserved: number;
  usage_percent: number;
};

type GlobalCreditSummary = {
  budget_usd: number;
  spent_usd: number;
  available_usd: number;
  daily_limit_usd: number;
  usage_percent: number;
  cycle_end: string | null;
};

export default function AdminGestoresPage() {
  const { startViewingAsGestor } = useAuth();
  const [gestores, setGestores] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [credits, setCredits] = useState<Record<string, CreditSummary>>({});
  const [creditInputs, setCreditInputs] = useState<Record<string, string>>({});
  const [creditBusy, setCreditBusy] = useState<string | null>(null);
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
  const [globalCredits, setGlobalCredits] = useState<GlobalCreditSummary | null>(null);

  async function fetchGestores() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch('/api/admin/gestores', {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        }
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Erro ao carregar gestores.');
      }

      const data = await response.json();
      setGestores(data || []);
      const creditsResponse = await fetch('/api/criativos/credits', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        cache: 'no-store',
      });
      const creditsPayload = await creditsResponse.json().catch(() => ({}));
      if (creditsResponse.ok) {
        setCredits(Object.fromEntries((creditsPayload.accounts || []).map((account: CreditSummary & { gestor_id: string }) => [account.gestor_id, account])));
        setGlobalCredits(creditsPayload.global || null);
      }
    } catch (err: unknown) {
      console.error('Error fetching gestores:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar gestores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(fetchGestores);
  }, []);

  const filtered = gestores.filter(g => {
    const matchesSearch = 
      (g.nome?.toLowerCase() || '').includes(search.toLowerCase()) || 
      (g.email?.toLowerCase() || '').includes(search.toLowerCase());

    const normalizedStatus = g.status?.toLowerCase() || 'ativo';
    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'active' && (normalizedStatus === 'active' || normalizedStatus === 'ativo')) ||
      (statusFilter === 'inactive' && (normalizedStatus === 'inactive' || normalizedStatus === 'inativo'));

    return matchesSearch && matchesStatus;
  });

  async function copyId(id: string) {
    await navigator.clipboard.writeText(id);
    alert('ID copiado.');
  }

  async function adjustCredits(gestorId: string, operation: 'add' | 'remove' | 'transfer') {
    const quantity = Math.trunc(Number(creditInputs[gestorId]));
    if (!Number.isFinite(quantity) || quantity < 1) {
      setError('Informe uma quantidade valida de creditos.');
      return;
    }
    if (operation === 'transfer' && !transferTargets[gestorId]) {
      setError('Escolha o gestor que recebera os creditos.');
      return;
    }
    setCreditBusy(gestorId);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/criativos/credits', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gestor_id: gestorId, target_gestor_id: transferTargets[gestorId], quantidade: quantity, operation }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel ajustar os creditos.');
      setCreditInputs((current) => ({ ...current, [gestorId]: '' }));
      await fetchGestores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel ajustar os creditos.');
    } finally {
      setCreditBusy(null);
    }
  }

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Gestores de Tráfego</h1>
          <p className="text-gray-500 font-medium">Gerencie os acessos da equipe de tráfego e relatórios.</p>
        </div>
        <Link 
          href="/admin/usuarios?tipo=gestor_trafego"
          className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
        >
          <Plus size={20} />
          Novo Gestor
        </Link>
      </div>

      {globalCredits && (
        <section className="orion-panel mb-8 grid gap-4 p-6 md:grid-cols-4" aria-label="Orcamento global de criativos">
          <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Limite global</p><p className="mt-2 text-2xl font-black text-slate-900">US$ {globalCredits.budget_usd.toFixed(2)}</p></div>
          <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gasto estimado</p><p className="mt-2 text-2xl font-black text-cyan-700">US$ {globalCredits.spent_usd.toFixed(2)}</p></div>
          <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Saldo estimado</p><p className="mt-2 text-2xl font-black text-emerald-700">US$ {globalCredits.available_usd.toFixed(2)}</p></div>
          <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Limite diario</p><p className="mt-2 text-2xl font-black text-slate-900">US$ {globalCredits.daily_limit_usd.toFixed(2)}</p><p className="mt-1 text-xs font-bold text-slate-500">{globalCredits.usage_percent}% do ciclo usado</p></div>
        </section>
      )}

      <div className="orion-panel mb-8 space-y-6 p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-8 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              type="text"
              placeholder="Buscar por nome ou email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="orion-control w-full py-4 pl-12 pr-4 font-medium"
            />
          </div>
          <div className="md:col-span-4 relative">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="orion-control w-full appearance-none py-4 pl-12 pr-4 font-bold"
            >
              <option value="all">Todos Status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </div>
        </div>
      </div>

      <div className="orion-table-shell mb-12">
        {loading ? (
          <div className="p-24 flex justify-center">
            <Loader2 className="animate-spin text-blue-600" size={40} />
          </div>
        ) : error ? (
          <div className="p-24 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ShieldAlert size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Ops! Algo deu errado</h3>
            <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
            <button onClick={fetchGestores} className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline">
              <RefreshCw size={14} /> Tentar novamente
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-24 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-slate-300">
              <UserCog size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Nenhum gestor encontrado</h3>
            <p className="text-gray-500 font-medium">Cadastre um novo gestor para começar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Gestor / Time</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cadastro</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Orion Cred</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((g) => (
                  <tr key={g.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => startViewingAsGestor(g.id)}
                          className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-black text-white shadow-sm transition-all hover:scale-105 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-500/20 cursor-pointer"
                          title="Entrar como gestor"
                        >
                          {g.foto_url || getTeamMemberPhoto(g.nome) ? (
                            <img src={g.foto_url || getTeamMemberPhoto(g.nome) || ''} alt={g.nome} className="h-full w-full object-cover object-top" />
                          ) : g.nome?.[0].toUpperCase()}
                        </button>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => startViewingAsGestor(g.id)}
                            className="block text-left font-bold text-gray-900 transition-colors hover:text-blue-600 cursor-pointer"
                            title="Entrar como gestor"
                          >
                            {g.nome}
                          </button>
                          <p className="text-[10px] font-bold uppercase tracking-tighter text-gray-400">{g.email}</p>
                          <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 w-fit">
                            ID n8n: <span className="normal-case tracking-normal text-slate-700">{g.id}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs font-bold text-slate-500">
                        {g.created_at ? new Date(g.created_at).toLocaleDateString('pt-BR') : '-'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-center">
                      <span className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                        (g.status?.toLowerCase() === 'active' || g.status?.toLowerCase() === 'ativo')
                          ? "bg-green-50 text-green-600 border-green-100" 
                          : "bg-red-50 text-red-600 border-red-100"
                      }`}>
                        {(g.status?.toLowerCase() === 'active' || g.status?.toLowerCase() === 'ativo') ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="min-w-[260px]">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-slate-600">
                          <span>{credits[g.id]?.available ?? 0} disponíveis</span>
                          <span>{credits[g.id]?.used ?? 0}/{credits[g.id]?.limit ?? 0} usados</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                          <input
                            type="number"
                            min="1"
                            max="500"
                            value={creditInputs[g.id] || ''}
                            onChange={(event) => setCreditInputs((current) => ({ ...current, [g.id]: event.target.value }))}
                            placeholder="Créditos"
                            className="orion-control min-w-0 flex-1 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            disabled={creditBusy === g.id}
                            onClick={() => adjustCredits(g.id, 'add')}
                            className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                          >
                            {creditBusy === g.id ? <Loader2 size={15} className="animate-spin" /> : 'Adicionar'}
                          </button>
                          <button
                            type="button"
                            disabled={creditBusy === g.id}
                            onClick={() => adjustCredits(g.id, 'remove')}
                            className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                          >
                            Remover
                          </button>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <select value={transferTargets[g.id] || ''} onChange={(event) => setTransferTargets((current) => ({ ...current, [g.id]: event.target.value }))} className="orion-control min-w-0 flex-1 px-3 py-2 text-sm">
                            <option value="">Transferir para...</option>
                            {gestores.filter((item) => item.id !== g.id).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                          </select>
                          <button type="button" disabled={creditBusy === g.id || !transferTargets[g.id]} onClick={() => adjustCredits(g.id, 'transfer')} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Transferir</button>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link 
                          href={`/admin/usuarios?edit=${g.id}`}
                          className="cursor-pointer p-3 text-slate-400 transition-all hover:-translate-y-0.5 hover:bg-blue-50 hover:text-blue-600"
                          title="Editar Gestor"
                        >
                          <Edit2 size={18} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => startViewingAsGestor(g.id)}
                          className="cursor-pointer p-3 text-slate-400 transition-all hover:-translate-y-0.5 hover:bg-emerald-50 hover:text-emerald-600"
                          title="Entrar como gestor"
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => copyId(g.id)}
                          className="cursor-pointer p-3 text-slate-400 transition-all hover:-translate-y-0.5 hover:bg-blue-50 hover:text-blue-600"
                          title="Copiar ID"
                        >
                          <Copy size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
