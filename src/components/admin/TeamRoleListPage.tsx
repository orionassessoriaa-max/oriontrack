'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Plus, 
  Search, 
  Eye, 
  Loader2, 
  ShieldAlert, 
  RefreshCw, 
  Palette, 
  MessageSquare, 
  Copy, 
  Edit2,
  Filter
} from 'lucide-react';
import { Profile, UserRole } from '@/types';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { getTeamMemberPhoto } from '@/lib/orionTeam';

type TeamRoleListPageProps = {
  role: Extract<UserRole, 'designer' | 'account_manager'>;
  title: string;
  description: string;
  newLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  panelHref: string;
};

export default function TeamRoleListPage({
  role,
  title,
  description,
  newLabel,
  emptyTitle,
  emptyDescription,
  panelHref,
}: TeamRoleListPageProps) {
  const { startViewingAsDesigner, startViewingAsAccount } = useAuth();
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const Icon = role === 'designer' ? Palette : MessageSquare;

  async function fetchPeople() {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/admin/usuarios', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Erro ao carregar pessoas.');
      }

      setPeople((payload.profiles || []).filter((profile: Profile) => profile.tipo_usuario === role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar pessoas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPeople();
  }, []);

  const filtered = people.filter((person) => {
    const matchesSearch = `${person.nome} ${person.email} ${person.email_real || ''}`.toLowerCase().includes(search.toLowerCase());
    
    const normalizedStatus = person.status?.toLowerCase() || 'ativo';
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

  async function openPanel(person: Profile) {
    if (role === 'designer') {
      await startViewingAsDesigner(person.id);
      return;
    }

    await startViewingAsAccount(person.id);
  }

  return (
    <InternalLayout>
      <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">{title}</h1>
          <p className="font-medium text-gray-500">{description}</p>
        </div>
        <Link
          href={`/admin/usuarios?tipo=${role}`}
          className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 font-black text-white shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-700"
        >
          <Plus size={20} />
          {newLabel}
        </Link>
      </div>

      <div className="orion-panel mb-8 space-y-6 p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-8 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-500" size={18} />
            <input
              type="text"
              placeholder="Buscar por nome ou email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
          <div className="flex justify-center p-24">
            <Loader2 className="animate-spin text-blue-600" size={40} />
          </div>
        ) : error ? (
          <div className="p-24 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <ShieldAlert size={32} />
            </div>
            <h3 className="mb-2 text-xl font-bold text-gray-900">Ops! Algo deu errado</h3>
            <p className="mx-auto mb-6 max-w-md font-medium text-red-500">{error}</p>
            <button onClick={fetchPeople} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 hover:underline">
              <RefreshCw size={14} /> Tentar novamente
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-24 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-slate-50 text-slate-300">
              <Icon size={40} />
            </div>
            <h3 className="mb-1 text-xl font-bold text-gray-900">{emptyTitle}</h3>
            <p className="font-medium text-gray-500">{emptyDescription}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">{role === 'designer' ? 'Designer / Time' : 'Account / Time'}</th>
                  <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Cadastro</th>
                  <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400 text-center">Status</th>
                  <th className="px-8 py-6 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((person) => (
                  <tr key={person.id} className="group transition-colors hover:bg-blue-50/30">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => void openPanel(person)}
                          className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-black text-white shadow-sm transition-all hover:scale-105 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-500/20 cursor-pointer"
                          title={`Entrar como ${role === 'designer' ? 'designer' : 'account'}`}
                        >
                          {person.foto_url || getTeamMemberPhoto(person.nome) ? (
                            <img src={person.foto_url || getTeamMemberPhoto(person.nome) || ''} alt={person.nome} className="h-full w-full object-cover" />
                          ) : person.nome?.[0].toUpperCase()}
                        </button>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => void openPanel(person)}
                            className="block text-left font-bold text-gray-900 transition-colors hover:text-blue-600 cursor-pointer"
                            title={`Entrar como ${role === 'designer' ? 'designer' : 'account'}`}
                          >
                            {person.nome}
                          </button>
                          <p className="text-[10px] font-bold uppercase tracking-tighter text-gray-400">
                            {person.email} {person.email_real ? `(Real: ${person.email_real})` : ''}
                          </p>
                          <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 w-fit">
                            ID n8n: <span className="normal-case tracking-normal text-slate-700">{person.id}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs font-bold text-slate-500">
                        {person.created_at ? new Date(person.created_at).toLocaleDateString('pt-BR') : '-'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-center">
                      <span className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                        (person.status?.toLowerCase() === 'active' || person.status?.toLowerCase() === 'ativo')
                          ? "bg-green-50 text-green-600 border-green-100" 
                          : "bg-red-50 text-red-600 border-red-100"
                      }`}>
                        {(person.status?.toLowerCase() === 'active' || person.status?.toLowerCase() === 'ativo') ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/usuarios?edit=${person.id}`}
                          className="cursor-pointer p-3 text-slate-400 transition-all hover:-translate-y-0.5 hover:bg-blue-50 hover:text-blue-600"
                          title={`Editar ${person.nome}`}
                        >
                          <Edit2 size={18} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => void openPanel(person)}
                          className="cursor-pointer p-3 text-slate-400 transition-all hover:-translate-y-0.5 hover:bg-emerald-50 hover:text-emerald-600"
                          title={`Abrir painel de ${person.nome}`}
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => copyId(person.id)}
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
