'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Users, 
  Plus, 
  Search, 
  Edit2,
  Filter,
  Loader2,
  Copy,
  Eye,
  Globe,
  ShieldAlert,
  RefreshCw,
  X,
  UserCog,
  UserPlus
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Corretor, Profile } from '@/types';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';

type CorretorWithGestorJoin = Corretor & {
  profiles?: Profile | null;
};

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function inferGestorFromTeam(corretor: CorretorWithGestorJoin, gestores: Profile[]) {
  if (corretor.profiles) return corretor.profiles;

  const team = Array.isArray(corretor.time_operacional) ? corretor.time_operacional : [];
  const managerMember = team.find((member: any) => {
    const role = normalizeText(member?.tipo_usuario);
    const cargo = normalizeText(member?.cargo);
    const nome = normalizeText(member?.nome);
    return role === 'gestor_trafego' || cargo.includes('trafego') || gestores.some((gestor) => normalizeText(gestor.nome) === nome);
  }) as any;

  if (!managerMember) return null;

  if (managerMember.profile_id) {
    return gestores.find((gestor) => gestor.id === managerMember.profile_id) || null;
  }

  return gestores.find((gestor) => normalizeText(gestor.nome) === normalizeText(managerMember.nome)) || null;
}

function CorretoresContent() {
  const { profile, startViewingAsCorretor } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialGestorId = searchParams.get('gestor');

  const [corretores, setCorretores] = useState<(Corretor & { gestor?: Profile })[]>([]);
  const [gestores, setGestores] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [gestorFilter, setGestorFilter] = useState(initialGestorId || 'all');

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [corretoresRes, gestoresRes] = await Promise.all([
        supabase
          .from('corretores')
          .select('*, profiles:gestor_trafego_id(id, nome, email)')
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('*')
          .eq('tipo_usuario', 'gestor_trafego')
          .in('status', ['active', 'ativo', 'Ativo'])
          .order('nome')
      ]);

      if (corretoresRes.error) throw corretoresRes.error;
      
      const gestoresList = gestoresRes.data || [];
      const formattedCorretores = ((corretoresRes.data || []) as CorretorWithGestorJoin[]).map((c) => {
        const inferredGestor = inferGestorFromTeam(c, gestoresList);
        return {
          ...c,
          gestor_trafego_id: c.gestor_trafego_id || inferredGestor?.id || null,
          gestor: inferredGestor || undefined
        };
      });

      setCorretores(formattedCorretores);
      setGestores(gestoresList);
    } catch (err: unknown) {
      console.error('Error fetching corretores data:', err);
      const errorMessage = err instanceof Error ? err.message : '';
      const errorCode = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';

      if (errorCode === '42501' || errorMessage.toLowerCase().includes('row-level security')) {
        setError("Acesso Negado (RLS): Você não tem permissão para visualizar esta lista.");
      } else {
        setError("Erro ao carregar dados.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile && profile.tipo_usuario !== 'admin') {
      if (profile.tipo_usuario === 'gestor_trafego') {
        router.push('/trafego/corretores');
      } else {
        router.push('/dashboard');
      }
      return;
    }
    
    void Promise.resolve().then(fetchData);
  }, [profile]);

  useEffect(() => {
    void Promise.resolve().then(() => setGestorFilter(initialGestorId || 'all'));
  }, [initialGestorId]);

  const filteredCorretores = corretores.filter(c => {
    const matchesSearch = 
      (c.nome?.toLowerCase() || '').includes(search.toLowerCase()) || 
      (c.email?.toLowerCase() || '').includes(search.toLowerCase()) ||
      (c.telefone || '').includes(search);

    const normalizedStatus = c.status?.toLowerCase() || 'ativo';
    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'active' && (normalizedStatus === 'active' || normalizedStatus === 'ativo')) ||
      (statusFilter === 'inactive' && (normalizedStatus === 'inactive' || normalizedStatus === 'inativo'));

    let matchesGestor = true;
    if (gestorFilter === 'sem-gestor') {
      matchesGestor = !c.gestor_trafego_id;
    } else if (gestorFilter !== 'all') {
      matchesGestor = c.gestor_trafego_id === gestorFilter;
    }

    return matchesSearch && matchesStatus && matchesGestor;
  });

  const activeGestorName = gestorFilter === 'sem-gestor' 
    ? 'Sem gestor definido' 
    : gestores.find(g => g.id === gestorFilter)?.nome;

  const clearGestorFilter = () => {
    setGestorFilter('all');
    router.push('/admin/corretores');
  };

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Corretores</h1>
          <p className="text-gray-500 font-medium">Gerencie seus parceiros e seus links de captação.</p>
        </div>
        <Link 
          href="/admin/usuarios"
          className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
        >
          <Plus size={20} /> Novo Corretor
        </Link>
      </div>

      {/* Active Filter Banner */}
      {gestorFilter !== 'all' && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between animate-in fade-in slide-in-from-left-4">
          <div className="flex items-center gap-3 text-blue-700 font-bold text-sm">
            <UserCog size={18} />
            Filtrando por gestor: <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase">{activeGestorName}</span>
          </div>
          <button 
            onClick={clearGestorFilter}
            className="text-blue-600 hover:text-blue-800 font-black text-[10px] uppercase tracking-widest flex items-center gap-1 bg-white px-3 py-2 rounded-xl shadow-sm"
          >
            <X size={14} /> Limpar filtro
          </button>
        </div>
      )}

      <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm mb-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-6 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              type="text"
              placeholder="Buscar por nome, email ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
            />
          </div>
          <div className="md:col-span-3 relative">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
            >
              <option value="all">Todos Status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </div>
          <div className="md:col-span-3 relative">
            <UserCog className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select 
              value={gestorFilter}
              onChange={(e) => setGestorFilter(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
            >
              <option value="all">Todos Gestores</option>
              <option value="sem-gestor">Sem gestor definido</option>
              {gestores.map(g => (
                <option key={g.id} value={g.id}>{g.nome}</option>
              ))}
            </select>
          </div>
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
            <h3 className="text-xl font-bold text-gray-900 mb-2">Ops!</h3>
            <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
            <button 
              onClick={fetchData}
              className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
            >
              <RefreshCw size={14} /> Tentar novamente
            </button>
          </div>
        ) : filteredCorretores.length === 0 ? (
          <div className="p-24 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-slate-300">
              <Users size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">
              {search || statusFilter !== 'all' || gestorFilter !== 'all' ? 'Nenhum corretor encontrado' : 'Nenhum corretor cadastrado'}
            </h3>
            <p className="text-gray-500 font-medium">Ajuste os filtros ou cadastre um novo parceiro.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Corretor / Parceiro</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Gestor de Tráfego</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Página de Captação</th>
                  <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                  <th className="min-w-[280px] px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredCorretores.map((c) => (
                  <tr key={c.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => startViewingAsCorretor(c.id)}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-black text-white shadow-sm transition-all hover:scale-105 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                          title="Entrar como corretor"
                        >
                          {c.nome?.[0].toUpperCase() || '?'}
                        </button>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => startViewingAsCorretor(c.id)}
                            className="block max-w-[260px] truncate text-left font-bold text-gray-900 transition-colors hover:text-blue-600"
                            title="Entrar como corretor"
                          >
                            {c.nome}
                          </button>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{c.email}</p>
                          <p className="mt-1 max-w-[260px] truncate rounded-lg bg-slate-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
                            ID n8n: <span className="normal-case tracking-normal text-slate-700">{c.id}</span>
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 lg:hidden">
                            <button
                              type="button"
                              onClick={() => startViewingAsCorretor(c.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-700"
                            >
                              <Eye size={13} /> Painel
                            </button>
                            <Link
                              href={`/admin/corretores/${c.id}/editar`}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-2 text-[9px] font-black uppercase tracking-widest text-blue-700"
                            >
                              <Edit2 size={13} /> Editar
                            </Link>
                            <Link
                              href={`/admin/corretores/${c.id}/time`}
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-2 text-[9px] font-black uppercase tracking-widest text-indigo-700"
                            >
                              <UserPlus size={13} /> Criar time
                            </Link>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(c.id);
                                alert('ID do corretor copiado para usar no n8n.');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-2 text-[9px] font-black uppercase tracking-widest text-slate-700"
                            >
                              <Copy size={13} /> ID
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="space-y-1">
                        {c.gestor ? (
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-[10px] font-black">
                              {c.gestor.nome[0]}
                            </div>
                            <span className="text-sm font-bold text-gray-700">{c.gestor.nome}</span>
                          </div>
                        ) : (
                          <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest italic">Gestor não definido</span>
                        )}
                        {(!c.time_operacional || c.time_operacional.length === 0) && (
                          <p className="text-[9px] font-black text-orange-400 uppercase tracking-tighter">Time operacional não definido</p>
                        )}
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
                      <span className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                        (c.status?.toLowerCase() === 'active' || c.status?.toLowerCase() === 'ativo')
                          ? "bg-green-50 text-green-600 border-green-100" 
                          : "bg-red-50 text-red-600 border-red-100"
                      }`}>
                        {(c.status?.toLowerCase() === 'active' || c.status?.toLowerCase() === 'ativo') ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/corretores/${c.id}/time`}
                          className="inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-indigo-700 transition-all hover:bg-indigo-100"
                          title="Criar e gerenciar time comercial"
                        >
                          <UserPlus size={16} />
                          Time
                        </Link>
                        <Link 
                          href={`/admin/corretores/${c.id}/editar`}
                          className="p-3 text-slate-400 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all"
                          title="Editar Corretor"
                        >
                          <Edit2 size={18} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => startViewingAsCorretor(c.id)}
                          className="p-3 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition-all"
                          title="Entrar como corretor"
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(c.id);
                            alert('ID do corretor copiado para usar no n8n.');
                          }}
                          className="p-3 text-slate-400 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all"
                          title="Copiar ID para n8n"
                        >
                          <Copy size={18} />
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

export default function AdminCorretoresPage() {
  return (
    <Suspense fallback={
      <InternalLayout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    }>
      <CorretoresContent />
    </Suspense>
  );
}
