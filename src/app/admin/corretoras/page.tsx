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
  Edit2,
  Plus,
  X
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
  empty?: boolean;
  corretora_id?: string | null;
  modo_operacao?: OperationMode;
}

interface CorretoraRecord {
  id: string;
  nome: string;
  descricao?: string | null;
  status?: string | null;
  meta_ad_account_id?: string | null;
  meta_ad_account_name?: string | null;
  modo_operacao?: OperationMode | null;
}

type OperationMode = 'individual' | 'grupo_rodizio' | 'grupo_rodizio_admin';

const operationModeLabels: Record<OperationMode, string> = {
  individual: 'Individual',
  grupo_rodizio: 'Grupo com rodizio',
  grupo_rodizio_admin: 'Grupo com rodizio + visao geral admin',
};

function normalizeOperationMode(value: unknown): OperationMode {
  return value === 'grupo_rodizio' || value === 'grupo_rodizio_admin' ? value : 'individual';
}

type CorretoraMember = {
  key: string;
  nome: string;
  email: string;
  email_real?: string | null;
  telefone?: string | null;
  status?: string | null;
  tipo_usuario?: string | null;
  foto_url?: string | null;
  profile_id?: string | null;
  corretor_id?: string | null;
  has_profile: boolean;
};

function getCorretoraMembers(group: CorretoraGroup): CorretoraMember[] {
  const members: CorretoraMember[] = [];
  const usedCorretorIds = new Set<string>();
  const usedEmails = new Set<string>();

  group.profiles.forEach((profile) => {
    const corretorRow = group.corretoresRows.find((row) => row.id === profile.corretor_id);
    const email = profile.email_real || profile.email || corretorRow?.email || '';
    members.push({
      key: `profile:${profile.id}`,
      nome: profile.nome,
      email,
      email_real: profile.email_real,
      telefone: corretorRow?.telefone || profile.telefone,
      status: profile.status,
      tipo_usuario: profile.tipo_usuario,
      foto_url: profile.foto_url,
      profile_id: profile.id,
      corretor_id: profile.corretor_id,
      has_profile: true,
    });

    if (profile.corretor_id) usedCorretorIds.add(profile.corretor_id);
    if (email) usedEmails.add(email.trim().toLowerCase());
  });

  group.corretoresRows.forEach((corretor) => {
    const email = corretor.email || '';
    const normalizedEmail = email.trim().toLowerCase();
    if (usedCorretorIds.has(corretor.id) || (normalizedEmail && usedEmails.has(normalizedEmail))) {
      return;
    }

    members.push({
      key: `corretor:${corretor.id}`,
      nome: corretor.nome,
      email,
      telefone: corretor.telefone,
      status: corretor.status,
      tipo_usuario: null,
      foto_url: null,
      profile_id: null,
      corretor_id: corretor.id,
      has_profile: false,
    });
  });

  return members.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function groupData(corretoresList: Corretor[], profilesList: Profile[], corretorasList: CorretoraRecord[] = []): CorretoraGroup[] {
  const groups: { [key: string]: CorretoraGroup } = {};

  corretorasList.forEach((corretora) => {
    const name = String(corretora.nome || '').trim();
    if (!name) return;
    const key = `empresa:${name.toLowerCase()}`;
    groups[key] = {
      id: corretora.id,
      nome: name,
      is_empresa: true,
      corretoresRows: [],
      profiles: [],
      meta_ad_account_id: corretora.meta_ad_account_id || null,
      meta_ad_account_name: corretora.meta_ad_account_name || null,
      status: corretora.status || 'ativo',
      empty: true,
      corretora_id: corretora.id,
      modo_operacao: normalizeOperationMode(corretora.modo_operacao),
    };
  });

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
        status: c.status || 'ativo',
        empty: false,
        corretora_id: null,
        modo_operacao: 'individual',
      };
    }

    groups[key].empty = false;
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
        status: p.status || 'active',
        empty: false,
        corretora_id: null,
        modo_operacao: 'individual',
      };
    }

    groups[key].empty = false;
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
  const [corretorasCadastradas, setCorretorasCadastradas] = useState<CorretoraRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all, empresa, individual
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creatingBrokerage, setCreatingBrokerage] = useState(false);
  const [newBrokerage, setNewBrokerage] = useState({ nome: '', descricao: '' });
  const [createBrokerageError, setCreateBrokerageError] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [savingOperationMode, setSavingOperationMode] = useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const [corretoresRes, profilesRes, corretorasRes] = await Promise.all([
        supabase
          .from('corretores')
          .select('*')
          .order('nome'),
        supabase
          .from('profiles')
          .select('*')
          .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro'])
          .order('nome'),
        token ? fetch('/api/admin/corretoras', {
          headers: { Authorization: `Bearer ${token}` }
        }) : Promise.resolve(null)
      ]);

      if (corretoresRes.error) throw corretoresRes.error;
      if (profilesRes.error) throw profilesRes.error;

      let loadedCorretoras: CorretoraRecord[] = [];
      if (corretorasRes) {
        const payload = await corretorasRes.json().catch(() => ({}));
        if (corretorasRes.ok) {
          loadedCorretoras = payload.corretoras || [];
          setMigrationPending(Boolean(payload.migration_pending));
        } else if (payload.migration_pending) {
          setMigrationPending(true);
        }
      }

      if (loadedCorretoras.length === 0) {
        const { data: directCorretoras, error: directCorretorasError } = await supabase
          .from('corretoras')
          .select('*')
          .order('nome');

        if (!directCorretorasError) {
          loadedCorretoras = directCorretoras || [];
          setMigrationPending(false);
        }
      }

      setCorretorasCadastradas(loadedCorretoras);
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
    return groupData(corretores, profiles, corretorasCadastradas);
  }, [corretores, profiles, corretorasCadastradas]);

  const filteredCorretoras = useMemo(() => {
    return corretoras.filter((c) => {
      const term = search.toLowerCase();
      const members = getCorretoraMembers(c);
      const matchesSearch = 
        c.nome.toLowerCase().includes(term) ||
        (c.meta_ad_account_name || '').toLowerCase().includes(term) ||
        members.some((member) => member.nome.toLowerCase().includes(term) || member.email.toLowerCase().includes(term));

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

  const updateOperationMode = async (group: CorretoraGroup, modoOperacao: OperationMode) => {
    const corretoraId = group.corretora_id || (group.empty ? group.id : null);
    if (!corretoraId) {
      alert('Crie a concessionaria no cadastro antes de alterar o modo de operacao.');
      return;
    }

    setSavingOperationMode(group.id);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch('/api/admin/corretoras', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: corretoraId, modo_operacao: modoOperacao }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao atualizar modo de operacao.');

      setCorretorasCadastradas((current) => current.map((item) =>
        item.id === corretoraId ? { ...item, modo_operacao: modoOperacao } : item
      ));
    } catch (err: any) {
      alert(err.message || 'Erro ao atualizar modo de operacao.');
    } finally {
      setSavingOperationMode(null);
    }
  };

  const createBrokerage = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreatingBrokerage(true);
    setError(null);
    setCreateBrokerageError(null);
    try {
      const nome = newBrokerage.nome.trim().replace(/\s+/g, ' ');
      const descricao = newBrokerage.descricao.trim() || null;
      if (!nome) throw new Error('Informe o nome da concessionaria.');

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch('/api/admin/corretoras', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nome, descricao, modo_operacao: 'individual' }),
      });
      const payload = await response.json().catch(() => ({}));
      let createdCorretora: CorretoraRecord | null = response.ok ? payload.corretora : null;
      if (!response.ok) {
        if (payload.migration_pending) setMigrationPending(true);

        const { data: existing } = await supabase
          .from('corretoras')
          .select('*')
          .ilike('nome', nome)
          .maybeSingle();

        if (existing) {
          createdCorretora = existing;
        } else {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('corretoras')
            .insert([{ nome, descricao, status: 'ativo', modo_operacao: 'individual' }])
            .select('*')
            .single();

          if (fallbackError) throw new Error(payload.error || fallbackError.message || 'Erro ao criar concessionaria.');
          createdCorretora = fallbackData;
        }
      }

      if (createdCorretora) {
        setCorretorasCadastradas((current) => {
          const withoutDuplicate = current.filter((item) => item.nome.trim().toLowerCase() !== createdCorretora!.nome.trim().toLowerCase());
          return [...withoutDuplicate, createdCorretora!].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        });
      }

      setNewBrokerage({ nome: '', descricao: '' });
      setCreateModalOpen(false);
      await fetchData();
    } catch (err: any) {
      setCreateBrokerageError(err.message || 'Erro ao criar concessionaria.');
    } finally {
      setCreatingBrokerage(false);
    }
  };

  const newCorretorHref = (nomeEmpresa?: string) => {
    const params = new URLSearchParams({ tipo: 'corretor' });
    if (nomeEmpresa) params.set('corretora', nomeEmpresa);
    return `/admin/usuarios?${params.toString()}`;
  };

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <Building2 className="text-blue-600" size={32} /> Concessionarias
          </h1>
          <p className="text-gray-500 font-medium">Visualizacao agrupada de concessionarias e corretores associados.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="bg-cyan-500 text-slate-950 px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-cyan-400 transition-all shadow-xl shadow-cyan-500/20"
          >
            <Plus size={20} /> Nova Concessionaria
          </button>
          <Link
            href="/admin/usuarios?tipo=corretor"
            className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
          >
            <UserPlus size={20} /> Novo Corretor
          </Link>
        </div>
      </div>

      {migrationPending && (
        <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm font-bold text-amber-300">
          O cadastro de concessionarias ainda precisa da migration no Supabase. A listagem antiga continua funcionando, mas concessionarias vazias so aparecem apos aplicar a migration.
        </div>
      )}

      {createModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
          <form onSubmit={createBrokerage} className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-[#090e1a] p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Cadastro de concessionaria</p>
                <h2 className="mt-1 text-2xl font-black text-white">Nova concessionaria</h2>
                <p className="mt-1 text-xs font-bold text-slate-400">Crie a concessionaria primeiro e depois adicione corretores dentro dela.</p>
              </div>
              <button type="button" onClick={() => setCreateModalOpen(false)} className="rounded-xl bg-white/5 p-2 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              {createBrokerageError && (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-300">
                  {createBrokerageError}
                </div>
              )}
              <div>
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Nome da concessionaria</label>
                <input
                  value={newBrokerage.nome}
                  onChange={(event) => setNewBrokerage((current) => ({ ...current, nome: event.target.value }))}
                  required
                  placeholder="Ex: B2L Concessionaria"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Observacao interna</label>
                <textarea
                  value={newBrokerage.descricao}
                  onChange={(event) => setNewBrokerage((current) => ({ ...current, descricao: event.target.value }))}
                  rows={3}
                  placeholder="Opcional"
                  className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCreateModalOpen(false)} className="rounded-2xl border border-white/10 px-6 py-3 text-xs font-black text-slate-300">
                Cancelar
              </button>
              <button type="submit" disabled={creatingBrokerage} className="flex items-center gap-2 rounded-2xl bg-cyan-500 px-6 py-3 text-xs font-black text-slate-950 disabled:opacity-60">
                {creatingBrokerage ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Criar concessionaria
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="orion-panel p-6 bg-gradient-to-br from-blue-50 to-white dark:from-slate-900/50 dark:to-slate-900/10 border-blue-100/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-1">Total de Concessionarias</p>
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
              placeholder="Buscar por concessionaria, conta Meta ou corretor..."
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
            <h3 className="text-xl font-bold text-gray-900 mb-1">Nenhuma concessionaria encontrada</h3>
            <p className="text-gray-500 font-medium">Ajuste os filtros ou crie uma nova concessionaria.</p>
          </div>
        ) : (
          filteredCorretoras.map((c) => {
            const isExpanded = !!expandedGroups[c.id];
            const members = getCorretoraMembers(c);
            return (
              <div 
                key={c.id} 
                className="orion-panel overflow-hidden border border-gray-100/80 bg-white transition-all shadow-sm duration-200"
              >
                {/* Cabecalho da concessionaria */}
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
                        {members.length} {members.length === 1 ? 'corretor' : 'corretores'}
                      </p>
                      {members.length > 0 && (
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mt-2 truncate max-w-[420px]">
                          Corretores: {members.map((member) => member.nome).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap md:flex-nowrap justify-between md:justify-end">
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="flex min-w-[230px] flex-col gap-1"
                    >
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Modo de operacao</span>
                      <select
                        value={normalizeOperationMode(c.modo_operacao)}
                        disabled={savingOperationMode === c.id || !c.corretora_id}
                        onChange={(event) => updateOperationMode(c, event.target.value as OperationMode)}
                        className="rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-cyan-700 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300"
                      >
                        {Object.entries(operationModeLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>

                    <Link
                      href={newCorretorHref(c.nome)}
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-500"
                    >
                      <UserPlus size={13} /> Adicionar corretor
                    </Link>

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
                  <div className="border-t border-gray-100/10 bg-slate-950/[0.03] dark:bg-slate-950/40 px-6 py-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left border-collapse">
                        <thead>
                          <tr className="border-b border-gray-100/10">
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Nome do Corretor</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">E-mail Orion</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Telefone</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100/10">
                          {members.map((member) => {
                            const phone = member.telefone || 'Sem telefone';
                            return (
                              <tr key={member.key} className="hover:bg-slate-950/[0.02] dark:hover:bg-slate-900/30 transition-colors">
                                <td className="py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center font-bold text-white text-sm shrink-0 overflow-hidden">
                                      {member.foto_url ? (
                                        <img src={member.foto_url} alt={member.nome} className="h-full w-full object-cover object-top" />
                                      ) : (
                                        member.nome[0].toUpperCase()
                                      )}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-bold text-gray-900 text-sm">{member.nome}</p>
                                        <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border ${
                                          member.tipo_usuario === 'corretor' 
                                            ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20' 
                                            : member.tipo_usuario === 'corretor_admin'
                                            ? 'bg-cyan-50 text-cyan-700 border-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/20'
                                            : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                        }`}>
                                          {member.tipo_usuario === 'corretor' 
                                            ? 'Admin' 
                                            : member.tipo_usuario === 'corretor_admin' 
                                            ? 'Admin' 
                                            : member.has_profile
                                            ? 'Corretor integrante'
                                            : 'Cadastro sem acesso'}
                                        </span>
                                      </div>
                                      {member.email_real && (
                                        <p className="text-[10px] text-gray-400 font-medium mt-0.5">Real: {member.email_real}</p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-4 text-xs font-semibold text-slate-600">{member.email || 'Sem e-mail'}</td>
                                <td className="py-4 text-xs font-semibold text-slate-600">{phone}</td>
                                <td className="py-4 text-center">
                                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                                    (member.status?.toLowerCase() === 'active' || member.status?.toLowerCase() === 'ativo')
                                      ? "bg-green-50 text-green-600 border-green-100" 
                                      : "bg-red-50 text-red-600 border-red-100"
                                  }`}>
                                    {(member.status?.toLowerCase() === 'active' || member.status?.toLowerCase() === 'ativo') ? 'Ativo' : 'Inativo'}
                                  </span>
                                </td>
                                <td className="py-4 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {member.corretor_id && (
                                      <button
                                        type="button"
                                        onClick={() => startViewingAsCorretor(member.corretor_id!, member.profile_id)}
                                        className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 rounded-lg"
                                        title="Entrar como corretor"
                                      >
                                        <Eye size={16} />
                                      </button>
                                    )}
                                    <Link 
                                      href={member.profile_id ? `/admin/usuarios?edit=${member.profile_id}` : `/admin/corretores/${member.corretor_id}/editar`}
                                      className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600 rounded-lg"
                                      title="Editar Usuário"
                                    >
                                      <Edit2 size={16} />
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={() => copyId(member.corretor_id || member.profile_id || member.key)}
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
