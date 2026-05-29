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

export default function AdminGestoresPage() {
  const { startViewingAsGestor } = useAuth();
  const [gestores, setGestores] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
            <table className="w-full min-w-[1000px] border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Gestor / Time</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cadastro</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((g) => (
                  <tr key={g.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-black text-white shadow-inner">
                          {g.foto_url || getTeamMemberPhoto(g.nome) ? (
                            <img src={g.foto_url || getTeamMemberPhoto(g.nome) || ''} alt={g.nome} className="h-full w-full object-cover" />
                          ) : g.nome?.[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{g.nome}</p>
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
