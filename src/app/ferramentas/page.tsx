'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { FerramentaCatalogItem, FerramentaStatus, FERRAMENTA_STATUS_LABEL } from '@/lib/ferramentas';
import { ArrowRight, CheckCircle2, Loader2, Search, Sparkles, X } from 'lucide-react';

type Tool = FerramentaCatalogItem & {
  status: FerramentaStatus;
  observacoes: string | null;
};

export default function FerramentasPage() {
  const { profile } = useAuth();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  async function loadTools() {
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setError('Sessao expirada. Faca login novamente.');
        return;
      }

      const response = await fetch('/api/ferramentas', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Erro ao carregar ferramentas.');
        return;
      }
      setTools(data.tools || []);
    } catch (err: any) {
      setError(err?.message || 'Erro de rede ao carregar ferramentas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTools();
  }, []);

  const filteredTools = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tools;
    return tools.filter((tool) => `${tool.titulo} ${tool.categoria} ${tool.resumo}`.toLowerCase().includes(term));
  }, [search, tools]);

  const categories = useMemo(() => {
    return Array.from(new Set(filteredTools.map((tool) => tool.categoria)));
  }, [filteredTools]);

  return (
    <InternalLayout>
      <div className="min-h-[calc(100vh-9rem)] bg-[#020617] text-white">
        <header className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">
              <Sparkles size={14} /> Ferramentas Orion
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white">Ferramentas</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold text-slate-400">
              Solucoes comerciais, automacoes e materiais para acelerar sua operacao.
            </p>
          </div>

          <div className="flex min-h-14 w-full items-center gap-3 rounded-[1.25rem] border border-white/10 bg-white/5 px-4 lg:max-w-md">
            <Search size={18} className="text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar ferramenta..."
              className="h-full flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-600"
            />
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-[1.5rem] border border-white/10 bg-white/[0.03]">
            <Loader2 className="animate-spin text-cyan-400" size={34} />
          </div>
        ) : error ? (
          <div className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/10 p-6 text-sm font-black text-rose-200">
            {error}
          </div>
        ) : filteredTools.length === 0 ? (
          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-10 text-center">
            <p className="text-lg font-black text-white">Nenhuma ferramenta liberada ainda.</p>
            <p className="mt-2 text-sm font-bold text-slate-500">Fale com o time Orion para ativar novas solucoes.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {categories.map((category) => (
              <section key={category}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-black text-white">{category}</h2>
                  <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                    {filteredTools.filter((tool) => tool.categoria === category).length} itens
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filteredTools.filter((tool) => tool.categoria === category).map((tool) => (
                    <button
                      key={tool.key}
                      type="button"
                      onClick={() => setSelectedTool(tool)}
                      className="group min-h-[250px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#0b1220] text-left shadow-xl shadow-black/20 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/40 hover:shadow-cyan-950/30"
                    >
                      <div className={`h-28 bg-gradient-to-br ${tool.accent} p-5`}>
                        <div className="flex items-start justify-between">
                          <span className="rounded-full bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                            {tool.destaque}
                          </span>
                          <ArrowRight size={18} className="text-white/80 transition group-hover:translate-x-1" />
                        </div>
                      </div>
                      <div className="p-5">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h3 className="text-lg font-black leading-tight text-white">{tool.titulo}</h3>
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">
                            {FERRAMENTA_STATUS_LABEL[tool.status]}
                          </span>
                        </div>
                        <p className="text-sm font-bold leading-relaxed text-slate-400">{tool.resumo}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {selectedTool && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
            <div className="w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#08111f] shadow-2xl">
              <div className={`h-32 bg-gradient-to-br ${selectedTool.accent} p-6`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/70">{selectedTool.categoria}</p>
                    <h2 className="mt-2 text-3xl font-black text-white">{selectedTool.titulo}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTool(null)}
                    className="rounded-2xl bg-black/20 p-2 text-white transition hover:bg-black/35"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-6 p-6">
                <p className="text-sm font-bold leading-relaxed text-slate-300">{selectedTool.descricao}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedTool.entregas.map((item) => (
                    <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <CheckCircle2 size={17} className="text-emerald-300" />
                      <span className="text-sm font-black text-white">{item}</span>
                    </div>
                  ))}
                </div>
                {selectedTool.observacoes && (
                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm font-bold text-cyan-100">
                    {selectedTool.observacoes}
                  </div>
                )}
                <button
                  type="button"
                  className="w-full rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-blue-950/40 transition hover:bg-blue-500"
                >
                  Solicitar ativacao
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
