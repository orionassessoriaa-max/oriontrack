'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { FerramentaCatalogItem, FerramentaStatus, FERRAMENTA_STATUS_LABEL } from '@/lib/ferramentas';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Loader2,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';

type Tool = FerramentaCatalogItem & {
  status: FerramentaStatus;
  observacoes: string | null;
};

const FEATURE_ICONS = [Zap, ShieldCheck, Gauge, BarChart3];

function statusStyle(status: FerramentaStatus) {
  if (status === 'ativo') return 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300';
  if (status === 'disponivel') return 'border-indigo-400/50 bg-indigo-500/15 text-indigo-300';
  if (status === 'em_breve') return 'border-amber-400/50 bg-amber-500/15 text-amber-300';
  return 'border-slate-500/50 bg-slate-500/15 text-slate-300';
}

function heroImageStyle(tool: Tool) {
  if (tool.key === 'pagina_comercial') return 'object-cover object-center';
  if (tool.key === 'captacao_imagens_videos') return 'object-cover object-center';
  return 'object-cover object-center';
}

function coverFallback(tool: Tool, compact = false) {
  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br ${tool.accent}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,0.18),transparent_25%),linear-gradient(135deg,rgba(0,0,0,0.10),rgba(0,0,0,0.34))]" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
      <div className="relative px-5 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/65">{tool.categoria}</p>
        <h3 className={`${compact ? 'mt-3 text-2xl' : 'mt-5 text-4xl'} font-black leading-[0.92] text-white`}>
          {tool.titulo}
        </h3>
      </div>
    </div>
  );
}

function ToolPoster({ tool, selected, onClick }: { tool: Tool; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative h-[190px] min-w-[280px] overflow-hidden rounded-xl border bg-[#07111e] text-left shadow-[0_20px_45px_rgba(0,0,0,0.32)] transition duration-300 hover:-translate-y-1 hover:border-indigo-300/80 md:h-[210px] md:min-w-[340px] ${
        selected ? 'border-indigo-300 ring-2 ring-indigo-400/70' : 'border-white/10'
      }`}
    >
      {tool.coverImage ? (
        <img
          src={tool.coverImage}
          alt={tool.titulo}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        coverFallback(tool, true)
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/22 to-black/12" />
      <span className={`absolute left-4 top-4 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase ${statusStyle(tool.status)}`}>
        {FERRAMENTA_STATUS_LABEL[tool.status]}
      </span>
      {selected && (
        <span className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white text-indigo-700 shadow-lg">
          <Check size={18} strokeWidth={3} />
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-4">
        <h3 className="text-lg font-black leading-tight text-white drop-shadow">{tool.titulo}</h3>
        <p className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-300">{tool.resumo}</p>
      </div>
    </button>
  );
}

function ToolRail({
  title,
  tools,
  selectedKey,
  onSelect,
}: {
  title: string;
  tools: Tool[];
  selectedKey: string | null;
  onSelect: (tool: Tool) => void;
}) {
  if (tools.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xl font-black tracking-[-0.01em] text-white">{title}</h2>
        <button type="button" className="flex items-center gap-2 text-sm font-bold text-slate-400 transition hover:text-white">
          Ver todas
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-3 pr-4 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
        {tools.map((tool) => (
          <ToolPoster key={tool.key} tool={tool} selected={selectedKey === tool.key} onClick={() => onSelect(tool)} />
        ))}
      </div>
    </section>
  );
}

export default function FerramentasPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
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

      const loadedTools: Tool[] = data.tools || [];
      setTools(loadedTools);
      setSelectedKey((current) => current || loadedTools.find((tool) => tool.key === 'pagina_comercial')?.key || loadedTools[0]?.key || null);
    } catch (err: any) {
      setError(err?.message || 'Erro de rede ao carregar ferramentas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTools();
  }, []);

  const visibleTools = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tools;
    return tools.filter((tool) => `${tool.titulo} ${tool.categoria} ${tool.resumo} ${tool.descricao}`.toLowerCase().includes(term));
  }, [search, tools]);

  const activeTools = visibleTools.filter((tool) => tool.status === 'ativo');
  const availableTools = visibleTools.filter((tool) => tool.status === 'disponivel' || tool.status === 'em_breve');

  const selectedTool = useMemo(() => {
    return tools.find((tool) => tool.key === selectedKey) || visibleTools[0] || tools[0] || null;
  }, [selectedKey, tools, visibleTools]);

  const selectedIndex = visibleTools.findIndex((tool) => tool.key === selectedTool?.key);

  function selectAdjacent(direction: -1 | 1) {
    if (!visibleTools.length) return;
    const current = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = (current + direction + visibleTools.length) % visibleTools.length;
    setSelectedKey(visibleTools[nextIndex].key);
  }

  return (
    <InternalLayout>
      <main className="min-h-[calc(100vh-9rem)] bg-[#030914] text-white">
        <div className="relative mx-auto max-w-[1540px] px-3 pb-10 sm:px-6">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_24%_0%,rgba(34,197,94,0.14),transparent_30%),radial-gradient(circle_at_75%_8%,rgba(37,99,235,0.18),transparent_28%)]" />

          <div className="relative pt-7">
            <header className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
                  <Sparkles size={15} />
                  Orion Store
                </p>
                <h1 className="text-4xl font-black tracking-[-0.03em] text-white md:text-5xl">Ferramentas</h1>
                <p className="mt-2 max-w-2xl text-base font-medium text-slate-400">
                  Solucoes que impulsionam sua corretora e elevam seus resultados.
                </p>
              </div>

              <label className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur lg:w-[390px]">
                <Search size={18} className="text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar ferramenta..."
                  className="h-full flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-slate-500"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="text-slate-500 transition hover:text-white" aria-label="Limpar busca">
                    <X size={16} />
                  </button>
                )}
              </label>
            </header>

            {loading ? (
              <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                <Loader2 className="animate-spin text-indigo-300" size={36} />
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-sm font-black text-rose-200">
                {error}
              </div>
            ) : !selectedTool ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
                <p className="text-lg font-black text-white">Nenhuma ferramenta encontrada.</p>
                <p className="mt-2 text-sm font-bold text-slate-500">Ajuste a busca para continuar.</p>
              </div>
            ) : (
              <>
                <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#07111e] shadow-[0_24px_90px_rgba(0,0,0,0.34)]">
                  <div className="absolute inset-0">
                    {selectedTool.coverImage ? (
                      <img src={selectedTool.coverImage} alt="" className={`h-full w-full ${heroImageStyle(selectedTool)} opacity-45 blur-[1px] scale-105`} />
                    ) : (
                      coverFallback(selectedTool)
                    )}
                    <div className="absolute inset-0 bg-gradient-to-r from-[#07111e] via-[#07111e]/80 to-[#07111e]/25" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#07111e] via-transparent to-transparent" />
                  </div>

                  <button
                    type="button"
                    onClick={() => selectAdjacent(-1)}
                    className="absolute left-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur transition hover:bg-white/20 lg:flex"
                    aria-label="Ferramenta anterior"
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button
                    type="button"
                    onClick={() => selectAdjacent(1)}
                    className="absolute right-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur transition hover:bg-white/20 lg:flex"
                    aria-label="Proxima ferramenta"
                  >
                    <ChevronRight size={24} />
                  </button>

                  <div className="relative z-10 grid min-h-[360px] gap-6 p-5 md:p-8 lg:grid-cols-[1.1fr_0.85fr] lg:items-center xl:min-h-[410px] xl:grid-cols-[1fr_0.95fr]">
                    <div className="max-w-xl lg:pl-8">
                      <span className={`inline-flex rounded-md border px-3 py-1.5 text-xs font-black uppercase ${statusStyle(selectedTool.status)}`}>
                        {FERRAMENTA_STATUS_LABEL[selectedTool.status]}
                      </span>
                      <h2 className="mt-5 text-4xl font-black leading-[0.96] tracking-[-0.04em] text-white md:text-6xl">
                        {selectedTool.titulo}
                      </h2>
                      <p className="mt-5 max-w-lg text-base font-medium leading-relaxed text-slate-300 md:text-lg">
                        {selectedTool.resumo}
                      </p>
                      <div className="mt-7 flex flex-wrap gap-3">
                        <a
                          href="#descricao"
                          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 text-sm font-black text-white shadow-lg shadow-indigo-950/35 transition hover:bg-indigo-500"
                        >
                          <Play size={17} fill="currentColor" />
                          Ver descricao
                        </a>
                        <button
                          type="button"
                          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/8 px-6 text-sm font-black text-slate-200 transition hover:bg-white/14 hover:text-white"
                        >
                          <Settings size={17} />
                          Configurar
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-[#0b1524]/88 p-5 backdrop-blur-md">
                      <h3 className="text-base font-black text-white">Sobre esta ferramenta</h3>
                      <p className="mt-3 text-sm font-medium leading-relaxed text-slate-300">{selectedTool.descricao}</p>
                      <div className="mt-5 grid gap-3">
                        {selectedTool.entregas.slice(0, 5).map((item) => (
                          <div key={item} className="flex items-center gap-3 text-sm font-medium text-slate-300">
                            <span className="flex h-5 w-5 items-center justify-center rounded border border-lime-400/45 text-lime-300">
                              <Check size={13} />
                            </span>
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <ToolRail title="Ativas" tools={activeTools} selectedKey={selectedTool.key} onSelect={(tool) => setSelectedKey(tool.key)} />
                <ToolRail title="Disponiveis" tools={availableTools} selectedKey={selectedTool.key} onSelect={(tool) => setSelectedKey(tool.key)} />

                <section id="descricao" className="mt-6 rounded-2xl border border-white/10 bg-[#081321] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.30)] md:p-7">
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-3xl font-black tracking-[-0.03em] text-white">{selectedTool.titulo}</h2>
                        <span className={`rounded-md border px-2.5 py-1 text-[10px] font-black uppercase ${statusStyle(selectedTool.status)}`}>
                          {FERRAMENTA_STATUS_LABEL[selectedTool.status]}
                        </span>
                      </div>
                      <p className="mt-3 text-base font-medium leading-relaxed text-slate-300">{selectedTool.descricao}</p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 text-sm font-black text-white shadow-lg shadow-indigo-950/35 transition hover:bg-indigo-500"
                    >
                      <Settings size={17} />
                      Configurar Ferramenta
                    </button>
                  </div>

                  <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {(selectedTool.beneficios || selectedTool.entregas).slice(0, 4).map((item, index) => {
                      const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length];
                      return (
                        <div key={item} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-lime-400/20 bg-lime-400/10 text-lime-300">
                            <Icon size={18} />
                          </div>
                          <h3 className="mt-4 text-sm font-black text-white">{item}</h3>
                          <p className="mt-2 text-xs font-medium leading-relaxed text-slate-400">
                            Recurso integrado ao fluxo da corretora para ganhar velocidade e consistencia.
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
    </InternalLayout>
  );
}
