'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { FerramentaCatalogItem, FerramentaStatus, FERRAMENTA_STATUS_LABEL } from '@/lib/ferramentas';
import { Building2, Check, Loader2, Search, Settings2, Sparkles } from 'lucide-react';

type Corretora = {
  id: string;
  nome: string;
  status: string;
};

type Config = {
  id: string;
  corretora_id: string;
  ferramenta_key: string;
  status: FerramentaStatus;
  observacoes: string | null;
  updated_at: string;
};

const statusOptions: FerramentaStatus[] = ['disponivel', 'ativo', 'em_breve', 'oculto'];

export default function AdminFerramentasPage() {
  const [corretoras, setCorretoras] = useState<Corretora[]>([]);
  const [ferramentas, setFerramentas] = useState<FerramentaCatalogItem[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [selectedCorretoraId, setSelectedCorretoraId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setError('Sessao expirada. Faca login novamente.');
        return;
      }

      const response = await fetch('/api/admin/ferramentas', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Erro ao carregar configuracoes.');
        return;
      }
      setCorretoras(data.corretoras || []);
      setFerramentas(data.ferramentas || []);
      setConfigs(data.configuracoes || []);
      setSelectedCorretoraId((current) => current || data.corretoras?.[0]?.id || '');
    } catch (err: any) {
      setError(err?.message || 'Erro de rede ao carregar configuracoes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredCorretoras = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return corretoras;
    return corretoras.filter((corretora) => corretora.nome.toLowerCase().includes(term));
  }, [corretoras, search]);

  const selectedCorretora = useMemo(
    () => corretoras.find((corretora) => corretora.id === selectedCorretoraId) || null,
    [corretoras, selectedCorretoraId]
  );

  const configByTool = useMemo(() => {
    return new Map(
      configs
        .filter((config) => config.corretora_id === selectedCorretoraId)
        .map((config) => [config.ferramenta_key, config])
    );
  }, [configs, selectedCorretoraId]);

  const activeCount = ferramentas.filter((tool) => {
    const status = configByTool.get(tool.key)?.status || 'disponivel';
    return status !== 'oculto';
  }).length;

  async function saveTool(tool: FerramentaCatalogItem, status: FerramentaStatus, observacoes?: string | null) {
    if (!selectedCorretoraId) return;
    setSavingKey(tool.key);
    setMessage(null);
    setError(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const current = configByTool.get(tool.key);
      const response = await fetch('/api/admin/ferramentas', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          corretoraId: selectedCorretoraId,
          ferramentaKey: tool.key,
          status,
          observacoes: observacoes === undefined ? current?.observacoes || null : observacoes,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Erro ao salvar ferramenta.');
        return;
      }

      setConfigs((currentConfigs) => {
        const withoutCurrent = currentConfigs.filter(
          (config) => !(config.corretora_id === selectedCorretoraId && config.ferramenta_key === tool.key)
        );
        return [...withoutCurrent, data.config];
      });
      setMessage('Configuracao salva.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar ferramenta.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <InternalLayout>
      <div className="min-h-[calc(100vh-9rem)] bg-[#020617] text-white">
        <header className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">
              <Settings2 size={14} /> Configuracao
            </div>
            <h1 className="text-4xl font-black tracking-tight">Ferramentas</h1>
            <p className="mt-2 text-sm font-bold text-slate-400">
              Libere ou oculte ferramentas por concessionaria.
            </p>
          </div>
          {selectedCorretora && (
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-5 py-4 text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Selecionada</p>
              <p className="mt-1 text-lg font-black text-white">{selectedCorretora.nome}</p>
              <p className="text-xs font-bold text-cyan-300">{activeCount} ferramentas visiveis</p>
            </div>
          )}
        </header>

        {message && (
          <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-sm font-black text-emerald-200">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-5 py-4 text-sm font-black text-rose-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-[1.5rem] border border-white/10 bg-white/[0.03]">
            <Loader2 className="animate-spin text-cyan-400" size={34} />
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="rounded-[1.5rem] border border-white/10 bg-[#08111f] p-4">
              <div className="mb-4 flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4">
                <Search size={17} className="text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar concessionaria..."
                  className="h-full flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-600"
                />
              </div>
              <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto pr-1">
                {filteredCorretoras.map((corretora) => {
                  const active = corretora.id === selectedCorretoraId;
                  return (
                    <button
                      key={corretora.id}
                      type="button"
                      onClick={() => setSelectedCorretoraId(corretora.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        active
                          ? 'border-cyan-400/50 bg-cyan-400/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-cyan-300">
                          <Building2 size={18} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">{corretora.nome}</p>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{corretora.status}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="rounded-[1.5rem] border border-white/10 bg-[#08111f] p-5">
              <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Catalogo</p>
                  <h2 className="mt-1 text-2xl font-black text-white">Ferramentas por titulo</h2>
                </div>
                <Sparkles size={24} className="text-cyan-300" />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {ferramentas.map((tool) => {
                  const config = configByTool.get(tool.key);
                  const status = config?.status || 'disponivel';
                  return (
                    <div key={tool.key} className="rounded-[1.25rem] border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${tool.accent}`} />
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{tool.categoria}</p>
                          </div>
                          <h3 className="text-lg font-black text-white">{tool.titulo}</h3>
                          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-400">{tool.resumo}</p>
                        </div>
                        <select
                          value={status}
                          disabled={savingKey === tool.key}
                          onChange={(event) => saveTool(tool, event.target.value as FerramentaStatus)}
                          className="min-h-12 rounded-2xl border border-white/10 bg-[#050b14] px-4 text-xs font-black uppercase tracking-widest text-white outline-none focus:border-cyan-400"
                        >
                          {statusOptions.map((option) => (
                            <option key={option} value={option}>
                              {FERRAMENTA_STATUS_LABEL[option]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <input
                          defaultValue={config?.observacoes || ''}
                          placeholder="Observacao interna ou texto para o corretor..."
                          onBlur={(event) => saveTool(tool, status, event.target.value)}
                          className="min-h-12 flex-1 rounded-2xl border border-white/10 bg-[#050b14] px-4 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
                        />
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                          {savingKey === tool.key ? <Loader2 className="animate-spin" size={17} /> : <Check size={17} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
