'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { FerramentaCatalogItem, FerramentaStatus, FERRAMENTA_STATUS_LABEL } from '@/lib/ferramentas';
import {
  Check,
  ChevronDown,
  Filter,
  Gift,
  Layers3,
  Loader2,
  Search,
  Settings,
  X,
} from 'lucide-react';

type Tool = FerramentaCatalogItem & {
  status: FerramentaStatus;
  observacoes: string | null;
};

type ToolTab = 'todas' | 'ativo' | 'disponivel';

const tabItems: Array<{ key: ToolTab; label: string }> = [
  { key: 'todas', label: 'Todas' },
  { key: 'ativo', label: 'Ativas' },
  { key: 'disponivel', label: 'Disponiveis' },
];

function statusStyle(status: FerramentaStatus) {
  if (status === 'ativo') {
    return 'border-emerald-400/45 bg-emerald-500/10 text-emerald-300';
  }
  if (status === 'disponivel') {
    return 'border-indigo-400/45 bg-indigo-500/10 text-indigo-300';
  }
  if (status === 'em_breve') {
    return 'border-amber-400/45 bg-amber-500/10 text-amber-300';
  }
  return 'border-slate-500/45 bg-slate-500/10 text-slate-300';
}

function coverFallback(tool: Tool) {
  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${tool.accent}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.22),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.10),transparent_35%)]" />
      <div className="relative px-7 text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-white/65">{tool.categoria}</p>
        <h3 className="mt-4 text-3xl font-black leading-[0.95] text-white">{tool.titulo}</h3>
      </div>
    </div>
  );
}

export default function FerramentasPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ToolTab>('todas');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

      const loadedTools = data.tools || [];
      setTools(loadedTools);
      setSelectedKey((current) => current || loadedTools[0]?.key || null);
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
    return tools.filter((tool) => {
      const matchesTab = activeTab === 'todas' || tool.status === activeTab;
      const matchesSearch = !term || `${tool.titulo} ${tool.categoria} ${tool.resumo}`.toLowerCase().includes(term);
      return matchesTab && matchesSearch;
    });
  }, [activeTab, search, tools]);

  const selectedTool = useMemo(() => {
    return tools.find((tool) => tool.key === selectedKey) || filteredTools[0] || tools[0] || null;
  }, [filteredTools, selectedKey, tools]);

  return (
    <InternalLayout>
      <main className="min-h-[calc(100vh-9rem)] bg-[#060d18] px-1 pb-8 text-white">
        <div className="mx-auto max-w-[1480px]">
          <header className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-[-0.02em] text-white">Ferramentas</h1>
              <p className="mt-2 text-base font-medium text-slate-400">
                Todas as ferramentas disponiveis para potencializar seus resultados
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
              <label className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/10 bg-[#09111f] px-4 shadow-[0_14px_40px_rgba(0,0,0,0.20)] xl:w-[360px]">
                <Search size={18} className="text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar ferramenta..."
                  className="h-full flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-slate-500"
                />
              </label>
              <button
                type="button"
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#09111f] px-6 text-sm font-bold text-slate-200 transition hover:border-indigo-400/50 hover:text-white"
              >
                <Filter size={17} />
                Filtrar
              </button>
            </div>
          </header>

          <div className="mb-7 flex flex-wrap items-center gap-3">
            {tabItems.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`min-h-12 rounded-xl px-7 text-sm font-bold transition ${
                  activeTab === tab.key
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <Loader2 className="animate-spin text-indigo-300" size={34} />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6 text-sm font-black text-rose-200">
              {error}
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
              <p className="text-lg font-black text-white">Nenhuma ferramenta encontrada.</p>
              <p className="mt-2 text-sm font-bold text-slate-500">Ajuste a busca ou limpe os filtros.</p>
            </div>
          ) : (
            <>
              <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredTools.map((tool) => (
                  <button
                    key={tool.key}
                    type="button"
                    onClick={() => setSelectedKey(tool.key)}
                    className={`group overflow-hidden rounded-xl border bg-[#0b1422] text-left shadow-[0_18px_44px_rgba(0,0,0,0.26)] transition duration-300 hover:-translate-y-1 hover:border-indigo-400/45 ${
                      selectedTool?.key === tool.key ? 'border-indigo-400/60' : 'border-white/10'
                    }`}
                  >
                    <div className="relative aspect-[4/5] overflow-hidden bg-slate-900">
                      {tool.coverImage ? (
                        <img
                          src={tool.coverImage}
                          alt={tool.titulo}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
                        />
                      ) : (
                        coverFallback(tool)
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0b1422] via-transparent to-black/18" />
                      <span className={`absolute left-4 top-4 rounded-md border px-2.5 py-1 text-[11px] font-black uppercase ${statusStyle(tool.status)}`}>
                        {FERRAMENTA_STATUS_LABEL[tool.status]}
                      </span>
                    </div>
                    <div className="min-h-[158px] p-5">
                      <h2 className="text-xl font-black leading-tight text-white">{tool.titulo}</h2>
                      <p className="mt-3 text-sm font-medium leading-relaxed text-slate-400">{tool.resumo}</p>
                    </div>
                  </button>
                ))}
              </section>

              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  className="flex min-h-12 min-w-[260px] items-center justify-center gap-3 rounded-xl border border-white/10 bg-[#09111f] px-6 text-sm font-semibold text-slate-300 transition hover:border-indigo-400/45 hover:text-white"
                >
                  Carregar mais ferramentas
                  <ChevronDown size={18} />
                </button>
              </div>

              {selectedTool && (
                <section className="mt-6 rounded-xl border border-white/10 bg-[#0b1422] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.32)] lg:p-7">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-6 lg:flex-row">
                      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-slate-900 shadow-2xl shadow-black/30 sm:w-[310px]">
                        {selectedTool.coverImage ? (
                          <img src={selectedTool.coverImage} alt={selectedTool.titulo} className="h-full w-full object-cover" />
                        ) : (
                          coverFallback(selectedTool)
                        )}
                      </div>

                      <div className="max-w-3xl pt-1">
                        <span className={`inline-flex rounded-md border px-2.5 py-1 text-[11px] font-black uppercase ${statusStyle(selectedTool.status)}`}>
                          {FERRAMENTA_STATUS_LABEL[selectedTool.status]}
                        </span>
                        <h2 className="mt-4 text-3xl font-black tracking-[-0.02em] text-white">{selectedTool.titulo}</h2>
                        <p className="mt-4 max-w-2xl text-base font-medium leading-relaxed text-slate-300">{selectedTool.descricao}</p>

                        <div className="mt-7 grid gap-4 text-sm font-medium text-slate-400 sm:grid-cols-3">
                          <div className="flex items-center gap-2">
                            <Gift size={16} className="text-slate-500" />
                            Categoria: <span className="text-slate-200">{selectedTool.categoria}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Layers3 size={16} className="text-slate-500" />
                            Tipo: <span className="text-slate-200">{selectedTool.tipo || 'Ferramenta'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            Status: <span className="text-slate-200">{FERRAMENTA_STATUS_LABEL[selectedTool.status]}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedKey(null)}
                      className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-white"
                      aria-label="Fechar detalhes"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="border-t border-white/10 pt-6">
                    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
                      <div>
                        <h3 className="text-base font-black text-white">Funcionalidades</h3>
                        <div className="mt-4 grid gap-2">
                          {selectedTool.entregas.map((item) => (
                            <div key={item} className="flex items-center gap-3 text-sm font-medium text-slate-300">
                              <Check size={16} className="text-slate-200" />
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                        <h3 className="text-base font-black text-white">Beneficios</h3>
                        <div className="mt-4 grid gap-2">
                          {(selectedTool.beneficios || []).map((item) => (
                            <div key={item} className="flex items-center gap-3 text-sm font-medium text-slate-300">
                              <Check size={16} className="text-slate-200" />
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-7 border-t border-white/10 pt-6">
                      <h3 className="text-base font-black text-white">Como funciona</h3>
                      <div className="mt-4 grid gap-4 md:grid-cols-4">
                        {(selectedTool.funcionamento || []).map((step, index) => (
                          <div key={step} className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white">
                              {index + 1}
                            </span>
                            <p className="text-sm font-medium leading-relaxed text-slate-300">{step}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-7 flex justify-end">
                      <button
                        type="button"
                        className="flex min-h-12 min-w-[300px] items-center justify-center gap-3 rounded-lg bg-indigo-600 px-6 text-sm font-black text-white shadow-lg shadow-indigo-950/35 transition hover:bg-indigo-500"
                      >
                        <Settings size={18} />
                        Configurar Ferramenta
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </InternalLayout>
  );
}
