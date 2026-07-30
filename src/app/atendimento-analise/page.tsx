'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CircleAlert,
  CircleCheck,
  Clock3,
  Loader2,
  LockKeyhole,
  PauseCircle,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';

type StageKey = 'entrada' | 'safe' | 'atencao' | 'risco' | 'aviso' | 'stand_by' | 'suspenso';
type Concessionaria = {
  key: string;
  nome: string;
  corretor_ids: string[];
  etapa: StageKey;
  updated_at?: string | null;
};

const STAGES: Array<{
  key: StageKey;
  label: string;
  description: string;
  icon: typeof Building2;
  color: string;
  soft: string;
}> = [
  { key: 'entrada', label: 'Entrada', description: 'Aguardando classificação', icon: Building2, color: '#2563eb', soft: '#eff6ff' },
  { key: 'safe', label: 'Safe', description: 'Operação saudável', icon: ShieldCheck, color: '#059669', soft: '#ecfdf5' },
  { key: 'atencao', label: 'Atenção', description: 'Precisa de acompanhamento', icon: CircleAlert, color: '#d97706', soft: '#fffbeb' },
  { key: 'risco', label: 'Risco', description: 'Ação prioritária', icon: AlertTriangle, color: '#e11d48', soft: '#fff1f2' },
  { key: 'aviso', label: 'Aviso', description: 'Cliente já sinalizado', icon: CircleCheck, color: '#7c3aed', soft: '#f5f3ff' },
  { key: 'stand_by', label: 'Stand by', description: 'Operação em espera', icon: Clock3, color: '#64748b', soft: '#f8fafc' },
  { key: 'suspenso', label: 'Suspenso', description: 'Atendimento suspenso', icon: PauseCircle, color: '#334155', soft: '#f1f5f9' },
];

export default function AtendimentoAnalisePage() {
  const [items, setItems] = useState<Concessionaria[]>([]);
  const [canMove, setCanMove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sessão expirada.');
      const response = await fetch('/api/atendimento-analise', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o quadro.');
      setItems(payload.concessionarias || []);
      setCanMove(Boolean(payload.can_move));
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return items;
    return items.filter((item) => item.nome.toLocaleLowerCase('pt-BR').includes(normalized));
  }, [items, query]);

  async function move(item: Concessionaria, etapa: StageKey) {
    if (!canMove || item.etapa === etapa || moving) return;
    const previous = item.etapa;
    setMoving(item.key);
    setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, etapa } : entry));
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sessão expirada.');
      const response = await fetch('/api/atendimento-analise', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concessionaria_key: item.key,
          concessionaria_nome: item.nome,
          etapa,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível mover a concessionária.');
    } catch (moveError: unknown) {
      setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, etapa: previous } : entry));
      setError(moveError instanceof Error ? moveError.message : 'Erro ao mover.');
    } finally {
      setMoving(null);
      setDragging(null);
    }
  }

  return (
    <InternalLayout>
      <div className="analysis-board min-h-[calc(100vh-8rem)]">
        <header className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-500">Operação Orion</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">Temperatura</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-slate-400">
              Visão compartilhada da saúde de todas as concessionárias. Novas contas entram automaticamente em Entrada.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar concessionária..."
                className="h-11 w-full rounded-xl border border-slate-700 bg-slate-900/80 pl-10 pr-4 text-sm font-bold text-white outline-none transition-colors focus:border-cyan-500 sm:w-72"
              />
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800"
            >
              <RefreshCw size={16} /> Atualizar
            </button>
          </div>
        </header>

        <div className="mb-5 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm font-bold text-slate-300">
          {canMove ? <ShieldCheck size={17} className="text-emerald-400" /> : <LockKeyhole size={17} className="text-amber-400" />}
          {canMove ? 'Modo admin: você pode arrastar e mover as concessionárias.' : 'Modo visualização: somente administradores podem alterar as etapas.'}
        </div>

        {error ? <div className="mb-5 rounded-xl border border-rose-900/70 bg-rose-950/40 px-4 py-3 text-sm font-bold text-rose-300">{error}</div> : null}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 text-sm font-bold text-slate-400">
            <Loader2 className="animate-spin text-cyan-400" size={24} /> Carregando concessionárias...
          </div>
        ) : (
          <div className="analysis-board-scroll flex min-h-[600px] gap-4 overflow-x-auto pb-5 [scrollbar-gutter:stable]">
            {STAGES.map((stage, stageIndex) => {
              const stageItems = filtered.filter((item) => item.etapa === stage.key);
              const Icon = stage.icon;
              return (
                <section
                  key={stage.key}
                  onDragOver={(event) => canMove && event.preventDefault()}
                  onDrop={() => {
                    const item = items.find((entry) => entry.key === dragging);
                    if (item) void move(item, stage.key);
                  }}
                  className={`analysis-stage flex min-w-[278px] max-w-[300px] flex-1 flex-col overflow-hidden rounded-2xl border bg-slate-900/70 transition-[border-color,background-color,transform] duration-150 ${dragging ? 'border-cyan-700/70' : 'border-slate-800'}`}
                >
                  <header className="border-b border-slate-800 px-4 py-4" style={{ boxShadow: `inset 0 3px 0 ${stage.color}` }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: stage.soft, color: stage.color }}>
                          <Icon size={18} />
                        </span>
                        <div>
                          <h2 className="text-sm font-black text-white">{stage.label}</h2>
                          <p className="text-[11px] font-medium text-slate-500">{stage.description}</p>
                        </div>
                      </div>
                      <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-black text-slate-300">{stageItems.length}</span>
                    </div>
                  </header>

                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {stageItems.map((item) => (
                      <article
                        key={item.key}
                        draggable={canMove}
                        onDragStart={() => canMove && setDragging(item.key)}
                        onDragEnd={() => setDragging(null)}
                        className={`analysis-card group rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 shadow-sm transition-[transform,border-color,box-shadow,opacity] duration-150 ${canMove ? 'cursor-grab hover:-translate-y-0.5 hover:border-slate-600 hover:shadow-lg active:cursor-grabbing' : ''} ${moving === item.key ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300">
                            <Building2 size={15} />
                          </span>
                          <div className="min-w-0">
                            <h3 className="break-words text-sm font-black leading-snug text-slate-100">{item.nome}</h3>
                            <p className="mt-1 text-[11px] font-medium text-slate-500">
                              {item.corretor_ids.length} cadastro{item.corretor_ids.length === 1 ? '' : 's'} vinculado{item.corretor_ids.length === 1 ? '' : 's'}
                            </p>
                          </div>
                        </div>
                        {canMove ? (
                          <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2">
                            <button
                              type="button"
                              disabled={stageIndex === 0 || Boolean(moving)}
                              onClick={() => void move(item, STAGES[stageIndex - 1].key)}
                              aria-label={`Mover ${item.nome} para a etapa anterior`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-20"
                            >
                              <ArrowLeft size={15} />
                            </button>
                            {moving === item.key ? <Loader2 className="animate-spin text-cyan-400" size={14} /> : <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Mover</span>}
                            <button
                              type="button"
                              disabled={stageIndex === STAGES.length - 1 || Boolean(moving)}
                              onClick={() => void move(item, STAGES[stageIndex + 1].key)}
                              aria-label={`Mover ${item.nome} para a próxima etapa`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-20"
                            >
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                    {stageItems.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-800 px-4 py-9 text-center text-xs font-bold text-slate-600">
                        Nenhuma concessionária
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
