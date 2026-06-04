'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Building2,
  Users,
  Search, 
  Filter,
  Loader2,
  Copy,
  Eye,
  Link2,
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Edit2
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Corretor, Profile } from '@/types';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';

interface CorretoraGroup {
  id: string; // ID of the first corretor/profile in the group
  nome: string; // Company name (nome_empresa) or corretor's individual name
  is_empresa: boolean;
  corretoresRows: Corretor[];
  profiles: Profile[];
  meta_ad_account_name?: string | null;
  meta_ad_account_id?: string | null;
  status: string;
}

function groupData(corretoresList: Corretor[], profilesList: Profile[]): CorretoraGroup[] {
  const groups: { [key: string]: CorretoraGroup } = {};

  // Initialize from corretores table
  corretoresList.forEach((c) => {
    const key = c.nome_empresa ? `empresa:${c.nome_empresa.trim().toLowerCase()}` : `individual:${c.id}`;
    const name = c.nome_empresa ? c.nome_empresa.trim() : c.nome;

    if (!groups[key]) {
      groups[key] = {
        id: c.id,
        nome: name,
        is_empresa: !!c.nome_empresa,
        corretoresRows: [],
        profiles: [],
        meta_ad_account_name: c.meta_ad_account_name,
        meta_ad_account_id: c.meta_ad_account_id,
        status: c.status || 'ativo'
      };
    }

    groups[key].corretoresRows.push(c);
    if (c.meta_ad_account_name && !groups[key].meta_ad_account_name) {
      groups[key].meta_ad_account_name = c.meta_ad_account_name;
      groups[key].meta_ad_account_id = c.meta_ad_account_id;
    }
  });

  // Assign profiles to groups
  profilesList.forEach((p) => {
    let key = '';
    
    if (p.corretor_id) {
      const corretor = corretoresList.find((c) => c.id === p.corretor_id);
      if (corretor) {
        key = corretor.nome_empresa ? `empresa:${corretor.nome_empresa.trim().toLowerCase()}` : `individual:${corretor.id}`;
      } else {
        key = p.nome_empresa ? `empresa:${p.nome_empresa.trim().toLowerCase()}` : `profile:${p.id}`;
      }
    } else {
      key = p.nome_empresa ? `empresa:${p.nome_empresa.trim().toLowerCase()}` : `profile:${p.id}`;
    }

    const name = p.nome_empresa ? p.nome_empresa.trim() : p.nome;

    if (!groups[key]) {
      groups[key] = {
        id: p.corretor_id || p.id,
        nome: name,
        is_empresa: !!p.nome_empresa,
        corretoresRows: [],
        profiles: [],
        meta_ad_account_name: null,
        meta_ad_account_id: null,
        status: p.status || 'active'
      };
    }

    // Avoid duplicate profiles in the same brokerage group
    if (!groups[key].profiles.some((existing) => existing.id === p.id)) {
      groups[key].profiles.push(p);
    }
  });

  return Object.values(groups).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function CorretorasContent() {
  const { profile, startViewingAsCorretor } = useAuth();
  const router = useRouter();

  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all, empresa, individual
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [corretoresRes, profilesRes] = await Promise.all([
        supabase
          .from('corretores')
          .select('*')
          .order('nome'),
        supabase
          .from('profiles')
          .select('*')
          .eq('tipo_usuario', 'corretor')
          .order('nome')
      ]);

      if (corretoresRes.error) throw corretoresRes.error;
      if (profilesRes.error) throw profilesRes.error;

      setCorretores(corretoresRes.data || []);
      setProfiles(profilesRes.data || []);
    } catch (err: unknown) {
      console.error('Error fetching data:', err);
      setError("Erro ao carregar dados do banco de dados.");
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

  const corretoras = useMemo(() => {
    return groupData(corretores, profiles);
  }, [corretores, profiles]);

  const filteredCorretoras = useMemo(() => {
    return corretoras.filter((c) => {
      const term = search.toLowerCase();
      const matchesSearch = 
        c.nome.toLowerCase().includes(term) ||
        (c.meta_ad_account_name || '').toLowerCase().includes(term) ||
        c.profiles.some((p) => p.nome.toLowerCase().includes(term) || p.email.toLowerCase().includes(term));

      const matchesType = 
        typeFilter === 'all' || 
        (typeFilter === 'empresa' && c.is_empresa) ||
        (typeFilter === 'individual' && !c.is_empresa);

      return matchesSearch && matchesType;
    });
  }, [corretoras, search, typeFilter]);

  const toggleExpand = (id: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    alert('ID copiado com sucesso!');
  };

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <Building2 className="text-blue-600" size={32} /> Corretoras
          </h1>
          <p className="text-gray-500 font-medium">Visualização agrupada de imobiliárias e corretores associados.</p>
        </div>
        <Link 
          href="/admin/usuarios?tipo=corretor"
          className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
        >
          <UserPlus size={20} /> Novo Corretor
        </Link>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="orion-panel p-6 bg-gradient-to-br from-blue-50 to-white dark:from-slate-900/50 dark:to-slate-900/10 border-blue-100/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-1">Total de Corretoras</p>
          <p className="text-3xl font-black text-gray-900">{corretoras.length}</p>
        </div>
        <div className="orion-panel p-6 bg-gradient-to-br from-emerald-50 to-white dark:from-slate-900/50 dark:to-slate-900/10 border-emerald-100/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1">Empresas / Grupos</p>
          <p className="text-3xl font-black text-gray-900">{corretoras.filter(c => c.is_empresa).length}</p>
        </div>
        <div className="orion-panel p-6 bg-gradient-to-br from-purple-50 to-white dark:from-slate-900/50 dark:to-slate-900/10 border-purple-100/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 mb-1">Corretores Individuais</p>
          <p className="text-3xl font-black text-gray-900">{corretoras.filter(c => !c.is_empresa).length}</p>
        </div>
      </div>

      {/* Painel de Filtros */}
      <div className="orion-panel mb-8 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-8 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              type="text"
              placeholder="Buscar por imobiliária, conta Meta ou corretor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="orion-control w-full py-4 pl-12 pr-4 font-medium"
            />
          </div>
          <div className="md:col-span-4 relative">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select 
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="orion-control w-full appearance-none py-4 pl-12 pr-4 font-bold"
            >
              <option value="all">Todas</option>
              <option value="empresa">Apenas Empresas/Grupos</option>
              <option value="individual">Apenas Corretores Individuais</option>
            </select>
          </div>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div className="space-y-4">
        {loading ? (
          <div className="orion-panel p-24 flex justify-center items-center">
            <Loader2 className="animate-spin text-blue-600" size={40} />
          </div>
        ) : error ? (
          <div className="orion-panel p-24 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ShieldAlert size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Erro</h3>
            <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
            <button 
              onClick={fetchData}
              className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
            >
              <RefreshCw size={14} /> Recarregar
            </button>
          </div>
        ) : filteredCorretoras.length === 0 ? (
          <div className="orion-panel p-24 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-slate-300">
              <Building2 size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Nenhuma corretora encontrada</h3>
            <p className="text-gray-500 font-medium">Ajuste os filtros ou crie um novo corretor com uma imobiliária definida.</p>
          </div>
        ) : (
          filteredCorretoras.map((c) => {
            const isExpanded = !!expandedGroups[c.id];
            return (
              <div 
                key={c.id} 
                className="orion-panel overflow-hidden border border-gray-100/80 bg-white transition-all shadow-sm duration-200"
              >
                {/* Cabeçalho da Corretora */}
                <div 
                  onClick={() => toggleExpand(c.id)}
                  className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-white shrink-0 ${
                      c.is_empresa 
                        ? 'bg-gradient-to-br from-blue-500 to-indigo-600' 
                        : 'bg-gradient-to-br from-slate-400 to-slate-600'
                    }`}>
                      {c.is_empresa ? <Building2 size={22} /> : <Users size={22} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-gray-950 truncate max-w-[280px]">{c.nome}</h2>
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          c.is_empresa 
                            ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          {c.is_empresa ? 'Empresa' : 'Individual'}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-400 mt-1 flex items-center gap-1.5">
                        <Users size={13} className="text-slate-300" />
                        {c.profiles.length} {c.profiles.length === 1 ? 'corretor' : 'corretores'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap md:flex-nowrap justify-between md:justify-end">
                    {/* Conta Meta Vinculada */}
                    {c.meta_ad_account_name ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-emerald-700 border border-emerald-100">
                        <Link2 size={13} /> {c.meta_ad_account_name}
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-slate-400 border border-slate-100">
                        Sem Conta Meta
                      </div>
                    )}

                    <div className="text-slate-400 hover:text-gray-900 transition-colors">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                {/* Lista de Corretores (Expandida) */}
                {isExpanded && (
                  <div className="border-t border-gray-50 bg-slate-50/20 px-6 py-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left border-collapse">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Nome do Corretor</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">E-mail Orion</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Telefone</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {c.profiles.map((p) => {
                            const corretorRow = c.corretoresRows.find((row) => row.id === p.corretor_id);
                            const phone = corretorRow?.telefone || p.telefone || 'Sem telefone';
                            return (
                              <tr key={p.id} className="hover:bg-slate-50/30 transition-colors">
                                <td className="py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center font-bold text-white text-sm shrink-0 overflow-hidden">
                                      {p.foto_url ? (
                                        <img src={p.foto_url} alt={p.nome} className="h-full w-full object-cover object-top" />
                                      ) : (
                                        p.nome[0].toUpperCase()
                                      )}
                                    </div>
                                    <div>
                                      <p className="font-bold text-gray-900 text-sm">{p.nome}</p>
                                      {p.email_real && (
                                        <p className="text-[10px] text-gray-400 font-medium">Real: {p.email_real}</p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-4 text-xs font-semibold text-slate-600">{p.email}</td>
                                <td className="py-4 text-xs font-semibold text-slate-600">{phone}</td>
                                <td className="py-4 text-center">
                                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                                    (p.status?.toLowerCase() === 'active' || p.status?.toLowerCase() === 'ativo')
                                      ? "bg-green-50 text-green-600 border-green-100" 
                                      : "bg-red-50 text-red-600 border-red-100"
                                  }`}>
                                    {(p.status?.toLowerCase() === 'active' || p.status?.toLowerCase() === 'ativo') ? 'Ativo' : 'Inativo'}
                                  </span>
                                </td>
                                <td className="py-4 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {p.corretor_id && (
                                      <button
                                        type="button"
                                        onClick={() => startViewingAsCorretor(p.corretor_id!)}
                                        className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 rounded-lg"
                                        title="Entrar como corretor"
                                      >
                                        <Eye size={16} />
                                      </button>
                                    )}
                                    <Link 
                                      href={`/admin/usuarios?edit=${p.id}`}
                                      className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600 rounded-lg"
                                      title="Editar Usuário"
                                    >
                                      <Edit2 size={16} />
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={() => copyId(p.corretor_id || p.id)}
                                      className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-slate-100 rounded-lg"
                                      title="Copiar ID"
                                    >
                                      <Copy size={16} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </InternalLayout>
  );
}

export default function AdminCorretorasPage() {
  return (
    <Suspense fallback={
      <InternalLayout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    }>
      <CorretorasContent />
    </Suspense>
  );
}
