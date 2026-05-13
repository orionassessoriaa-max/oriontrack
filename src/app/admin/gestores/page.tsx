'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Plus, 
  Search, 
  Edit2,
  Eye,
  Loader2,
  UserCog,
  ShieldAlert,
  RefreshCw
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';

export default function AdminGestoresPage() {
  const { startViewingAsGestor } = useAuth();
  const [gestores, setGestores] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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

  const filtered = gestores.filter(g => 
    (g.nome?.toLowerCase() || '').includes(search.toLowerCase()) || 
    (g.email?.toLowerCase() || '').includes(search.toLowerCase())
  );

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Gestores de Tráfego</h1>
          <p className="text-gray-500 font-medium">Gerencie os acessos da equipe de tráfego e relatórios.</p>
        </div>
        <Link 
          href="/admin/gestores/novo"
          className="bg-blue-600 text-white px-6 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
        >
          <Plus size={20} />
          Novo Gestor
        </Link>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm mb-8">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
          <input 
            type="text"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
          />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-20 flex justify-center">
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
          <div className="p-20 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-slate-300">
              <UserCog size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Nenhum gestor encontrado</h3>
            <p className="text-gray-500 font-medium">Cadastre um novo gestor para começar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Gestor</th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Email</th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cadastro</th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((g) => (
                  <tr key={g.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center font-black text-lg">
                          {g.nome?.[0].toUpperCase()}
                        </div>
                        <p className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{g.nome}</p>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-medium text-slate-500">{g.email}</span>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs text-gray-400 font-bold">
                        {g.created_at ? new Date(g.created_at).toLocaleDateString('pt-BR') : '-'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link 
                          href={`/admin/gestores/${g.id}/editar`}
                          className="p-2.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all"
                          title="Editar Gestor"
                        >
                          <Edit2 size={18} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => startViewingAsGestor(g.id)}
                          className="p-2.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition-all"
                          title="Entrar como gestor"
                        >
                          <Eye size={18} />
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
