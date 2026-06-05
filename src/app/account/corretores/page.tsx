'use client';

import { useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCorretoresOptions } from '@/hooks/useCorretoresOptions';
import { Building2, Eye, Loader2, Search, Users } from 'lucide-react';

export default function AccountCorretoresPage() {
  const { startViewingAsCorretor } = useAuth();
  const { corretores, loading, error } = useCorretoresOptions();
  const [search, setSearch] = useState('');

  const filteredCorretores = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return corretores;
    return corretores.filter((corretor) =>
      String(corretor.nome || '').toLowerCase().includes(term) ||
      String(corretor.nome_empresa || '').toLowerCase().includes(term) ||
      String(corretor.email || '').toLowerCase().includes(term)
    );
  }, [corretores, search]);

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400">Account manager</p>
          <h1 className="mt-2 text-3xl font-black text-white">Corretores acompanhados</h1>
          <p className="mt-1 text-sm font-bold text-slate-400">Entre no painel do corretor para visualizar CRM, leads, inbox e resultados sem acessar o financeiro.</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-5 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Carteira</p>
          <p className="text-2xl font-black text-white">{corretores.length}</p>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-white/5 bg-[#090e1a]/80 p-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar corretor ou corretora..."
            className="w-full rounded-2xl border border-white/10 bg-black/30 py-4 pl-12 pr-4 text-sm font-bold text-white outline-none focus:border-cyan-400"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#090e1a]/85 shadow-2xl">
        {loading ? (
          <div className="flex justify-center p-20">
            <Loader2 className="animate-spin text-cyan-400" size={36} />
          </div>
        ) : error ? (
          <div className="p-16 text-center text-sm font-bold text-rose-400">{error}</div>
        ) : filteredCorretores.length === 0 ? (
          <div className="p-16 text-center">
            <Users className="mx-auto mb-4 text-slate-600" size={40} />
            <p className="font-black text-white">Nenhum corretor encontrado</p>
            <p className="mt-1 text-xs font-bold text-slate-500">Quando houver corretores na carteira, eles aparecem aqui.</p>
          </div>
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredCorretores.map((corretor) => (
              <div key={corretor.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition hover:border-cyan-400/30">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black text-white">{corretor.nome}</p>
                    <p className="mt-1 truncate text-[10px] font-black uppercase tracking-widest text-slate-500">{corretor.email}</p>
                    {corretor.nome_empresa && (
                      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-300">
                        <Building2 size={12} /> {corretor.nome_empresa}
                      </p>
                    )}
                  </div>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white">
                    {corretor.nome?.[0]?.toUpperCase() || 'C'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => startViewingAsCorretor(corretor.id)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-950 transition hover:bg-cyan-400"
                >
                  <Eye size={16} /> Visualizar painel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
