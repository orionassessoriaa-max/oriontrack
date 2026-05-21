'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { Plus, Search, Eye, Loader2, ShieldAlert, RefreshCw, Palette, MessageSquare, Copy, Edit2 } from 'lucide-react';
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
    const target = `${person.nome} ${person.email} ${person.email_real || ''}`.toLowerCase();
    return target.includes(search.toLowerCase());
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
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
          <p className="font-medium text-gray-500">{description}</p>
        </div>
        <Link
          href={`/admin/usuarios?tipo=${role}`}
          className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 font-black text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700"
        >
          <Plus size={20} />
          {newLabel}
        </Link>
      </div>

      <div className="mb-8 rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm">
        <div className="group relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-500" size={18} />
          <input
            type="text"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-2xl border-none bg-gray-50 py-4 pl-12 pr-4 font-medium transition-all focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center p-20">
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
          <div className="p-20 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-50 text-slate-300">
              <Icon size={40} />
            </div>
            <h3 className="mb-1 text-xl font-bold text-gray-900">{emptyTitle}</h3>
            <p className="font-medium text-gray-500">{emptyDescription}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">{title}</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Email</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">ID</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Cadastro</th>
                  <th className="px-8 py-5 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((person) => (
                  <tr key={person.id} className="group transition-colors hover:bg-blue-50/30">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-lg font-black text-slate-600">
                          {person.foto_url || getTeamMemberPhoto(person.nome) ? (
                            <img src={person.foto_url || getTeamMemberPhoto(person.nome) || ''} alt={person.nome} className="h-full w-full object-cover" />
                          ) : person.nome?.[0].toUpperCase()}
                        </div>
                        <p className="font-bold text-gray-900 transition-colors group-hover:text-blue-600">{person.nome}</p>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-medium text-slate-500">{person.email}</span>
                      {person.email_real && <p className="mt-1 text-xs font-medium text-slate-400">Real: {person.email_real}</p>}
                    </td>
                    <td className="px-8 py-6">
                      <button
                        type="button"
                        onClick={() => copyId(person.id)}
                        className="inline-flex max-w-[220px] items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-black text-slate-500 transition-all hover:bg-blue-50 hover:text-blue-700"
                        title={person.id}
                      >
                        <Copy size={13} />
                        <span className="truncate">{person.id}</span>
                      </button>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs font-bold text-gray-400">
                        {person.created_at ? new Date(person.created_at).toLocaleDateString('pt-BR') : '-'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <Link
                        href={`/admin/usuarios?tipo=${role}`}
                        className="mr-2 inline-flex rounded-xl p-2.5 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600"
                        title={`Editar ${person.nome}`}
                      >
                        <Edit2 size={18} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void openPanel(person)}
                        className="inline-flex rounded-xl p-2.5 text-slate-400 transition-all hover:bg-emerald-50 hover:text-emerald-600"
                        title={`Abrir painel de ${person.nome}`}
                      >
                        <Eye size={18} />
                      </button>
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
