'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Users, 
  Search, 
  Globe, 
  Loader2,
  AlertCircle,
  RefreshCw,
  Copy,
  ShieldAlert,
  Eye
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Corretor } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { getOnboardingStatus } from '@/lib/onboarding';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

export default function TrafficCorretoresPage() {
  const { profile, startViewingAsCorretor } = useAuth();
  const router = useRouter();
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (profile && profile.tipo_usuario !== 'gestor_trafego') {
      if (profile.tipo_usuario === 'admin') {
        router.push('/admin/corretores');
      } else {
        router.push('/dashboard');
      }
      return;
    }
    
    fetchCorretores();
  }, [profile]);

  const fetchCorretores = async () => {
    if (!profile?.id) return;
    
    setLoading(true);
    setError(null);
    try {
      const { data, error: supabaseError } = await supabase
        .from('corretores')
        .select('*')
        .in('status', ['active', 'ativo', 'Ativo'])
        .order('nome');

      if (supabaseError) throw supabaseError;

      let filtered = data || [];
      if (profile.tipo_usuario === 'gestor_trafego') {
        filtered = filtered.filter(c => isGestorLinkedToConcessionariaCorretor(c, profile));
      }

      setCorretores(filtered);
    } catch (err: any) {
      console.error('Error fetching traffic manager corretores:', err);
      setError("Erro ao carregar sua lista de corretores.");
    } finally {
      setLoading(false);
    }
  };

  const filteredCorretores = corretores.filter(c => 
    (c.nome?.toLowerCase() || '').includes(search.toLowerCase()) || 
    (c.email?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (c.telefone || '').includes(search)
  );

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Meus Corretores</h1>
        <p className="text-gray-500 font-medium text-lg">Gerencie os parceiros vinculados à sua gestão.</p>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm mb-8">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
          <input 
            type="text"
            placeholder="Buscar por nome, email ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
          />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden mb-12">
        {loading ? (
          <div className="p-24 flex justify-center">
            <Loader2 className="animate-spin text-blue-600" size={40} />
          </div>
        ) : error ? (
          <div className="p-24 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ShieldAlert size={32} />
            </div>
            <p className="text-red-500 font-bold mb-6">{error}</p>
            <button onClick={fetchCorretores} className="text-blue-600 font-black uppercase tracking-widest text-xs hover:underline">Tentar novamente</button>
          </div>
        ) : filteredCorretores.length === 0 ? (
          <div className="p-24 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-slate-300">
              <Users size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">
              {search ? 'Nenhum corretor encontrado' : 'Nenhum corretor vinculado a você'}
            </h3>
            <p className="text-gray-500 font-medium">Fale com o administrador para vincular novos parceiros.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Corretor / Parceiro</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Página de Captação</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredCorretores.map((c) => (
                  <tr key={c.id} className="hover:bg-blue-50/30 transition-colors group">
                    {(() => {
                      const onboardingStatus = getOnboardingStatus(c);
                      return (
                        <>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-xl flex items-center justify-center font-black text-lg shadow-sm">
                          {c.nome?.[0].toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{c.nome}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      {c.link_pagina ? (
                        <div className="flex items-center gap-2">
                          <Globe size={14} className="text-blue-500" />
                          <a 
                            href={c.link_pagina} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors truncate max-w-[200px]"
                          >
                            {c.link_pagina}
                          </a>
                        </div>
                      ) : (
                        <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest italic">Não vinculada</span>
                      )}
                    </td>
                    <td className="px-8 py-6 text-center">
                      <span className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest border ${onboardingStatus.className}`}>
                        {onboardingStatus.label}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startViewingAsCorretor(c.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cyan-500 transition hover:bg-cyan-500/20"
                          title="Visualizar painel do corretor"
                        >
                          <Eye size={14} /> Visualizar
                        </button>
                        {c.link_pagina && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(c.link_pagina!);
                              alert('Link copiado!');
                            }}
                            className="p-3 text-slate-400 hover:bg-slate-100 rounded-xl transition-all"
                            title="Copiar Link"
                          >
                            <Copy size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                        </>
                      );
                    })()}
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
