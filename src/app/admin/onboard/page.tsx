'use client';

import { Check, Clock3, Copy, ExternalLink, FileText, History, Loader2, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';

type SavedOnboarding = {
  id: string;
  cliente: string;
  segmento: string | null;
  link_path: string;
  created_at: string;
  created_by_name: string;
};

export default function AdminOnboardPage() {
  const [cliente, setCliente] = useState('');
  const [segmento, setSegmento] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [recentItems, setRecentItems] = useState<SavedOnboarding[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [saving, setSaving] = useState(false);
  const savedSignatureRef = useRef('');
  const savingSignatureRef = useRef('');

  const clienteValido = Boolean(cliente.trim());
  const onboardingPath = useMemo(() => {
    return `/onboard/?cliente=${encodeURIComponent(cliente.trim())}&segmento=${encodeURIComponent(segmento.trim())}`;
  }, [cliente, segmento]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadRecent() {
    setLoadingRecent(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');
      const response = await fetch('/api/admin/onboard', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao carregar os onboardings salvos.');
      setRecentItems(payload.items || []);
    } catch (error: any) {
      setCopyError(error?.message || 'Erro ao carregar os onboardings salvos.');
    } finally {
      setLoadingRecent(false);
    }
  }

  useEffect(() => {
    void loadRecent();
  }, []);

  async function saveCurrentOnboarding() {
    const signature = `${cliente.trim()}\n${segmento.trim()}`;
    if (!clienteValido || savedSignatureRef.current === signature || savingSignatureRef.current === signature) return;

    savingSignatureRef.current = signature;
    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');
      const response = await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cliente: cliente.trim(), segmento: segmento.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao salvar o onboarding.');

      savedSignatureRef.current = signature;
      setRecentItems((current) => [payload.item, ...current.filter((item) => item.id !== payload.item.id)].slice(0, 12));
    } catch (error: any) {
      setCopyError(error?.message || 'Erro ao salvar o onboarding.');
    } finally {
      if (savingSignatureRef.current === signature) savingSignatureRef.current = '';
      setSaving(false);
    }
  }

  function openOnboarding() {
    if (!clienteValido) return;
    window.open(onboardingPath, '_blank', 'noopener,noreferrer');
    void saveCurrentOnboarding();
  }

  async function copyLink() {
    if (!clienteValido) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${onboardingPath}`);
      setCopied(true);
      void saveCurrentOnboarding();
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyError('Não foi possível copiar o link. Tente novamente.');
    }
  }

  async function copySavedLink(item: SavedOnboarding) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${item.link_path}`);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 2200);
    } catch {
      setCopyError('Não foi possível copiar o link. Tente novamente.');
    }
  }

  function formatCreatedAt(value: string) {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  return (
    <InternalLayout>
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 overflow-hidden rounded-[2rem] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.18),transparent_38%),linear-gradient(135deg,#071521,#0b172b_58%,#07111f)] p-7 shadow-2xl shadow-slate-950/20 sm:p-9">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
            <FileText size={24} aria-hidden />
          </div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">Time Apollo</p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Onboarding de clientes</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-300 sm:text-base">
            Personalize a apresentação da Orion e gere o link público para enviar ao cliente.
          </p>
        </header>

        <section className="rounded-[2rem] border border-white/10 bg-[#090e1a] p-6 shadow-2xl shadow-slate-950/20 sm:p-8">
          <div className="grid gap-6 md:grid-cols-2">
            <label className="space-y-2">
              <span className="ml-1 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Nome do cliente
              </span>
              <input
                value={cliente}
                onChange={(event) => {
                  setCliente(event.target.value);
                  setCopied(false);
                  setCopyError(null);
                }}
                placeholder="Nome da corretora"
                autoComplete="organization"
                className="min-h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60 focus:ring-4 focus:ring-cyan-400/10"
              />
            </label>

            <label className="space-y-2">
              <span className="ml-1 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Segmento <span className="normal-case tracking-normal text-slate-600">(opcional)</span>
              </span>
              <input
                value={segmento}
                onChange={(event) => {
                  setSegmento(event.target.value);
                  setCopied(false);
                  setCopyError(null);
                }}
                placeholder="Corretora parceira"
                className="min-h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60 focus:ring-4 focus:ring-cyan-400/10"
              />
            </label>
          </div>

          <div className="mt-6 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
            <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Link gerado</span>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-300">
              {clienteValido ? onboardingPath : '/onboard/?cliente=Nome%20do%20cliente&segmento='}
            </p>
          </div>

          {copyError && (
            <div role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
              {copyError}
            </div>
          )}

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            {saving && (
              <span className="inline-flex items-center justify-center gap-2 text-xs font-bold text-cyan-300 sm:mr-auto">
                <Loader2 size={15} className="animate-spin" aria-hidden /> Salvando no histórico
              </span>
            )}
            <button
              type="button"
              onClick={() => void copyLink()}
              disabled={!clienteValido}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-6 text-sm font-black text-white transition hover:border-cyan-400/30 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
              {copied ? 'Link copiado' : 'Copiar link'}
            </button>
            <button
              type="button"
              onClick={openOnboarding}
              disabled={!clienteValido}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-7 text-sm font-black text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <ExternalLink size={18} aria-hidden />
              Abrir onboarding
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-[#090e1a] p-6 shadow-2xl shadow-slate-950/20 sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-cyan-300">
                <History size={18} aria-hidden />
                <span className="text-[10px] font-black uppercase tracking-[0.18em]">Histórico compartilhado</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight text-white">Últimos onboardings criados</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">Links salvos pela equipe operacional.</p>
            </div>
          </div>

          {loadingRecent ? (
            <div className="flex min-h-40 items-center justify-center rounded-2xl border border-white/[0.07] bg-black/20">
              <Loader2 size={28} className="animate-spin text-cyan-400" aria-label="Carregando onboardings" />
            </div>
          ) : recentItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-6 py-10 text-center">
              <p className="text-sm font-bold text-slate-400">Nenhum onboarding criado ainda.</p>
              <p className="mt-1 text-xs text-slate-600">Ao copiar ou abrir um novo link, ele aparecerá aqui.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {recentItems.map((item) => (
                <article key={item.id} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5 transition hover:border-cyan-400/25">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-black text-white">{item.cliente}</h3>
                      <p className="mt-1 truncate text-xs font-bold text-cyan-300">
                        {item.segmento || 'Sem segmento informado'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.open(item.link_path, '_blank', 'noopener,noreferrer')}
                      aria-label={`Abrir onboarding de ${item.cliente}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 transition hover:bg-cyan-400/20"
                    >
                      <ExternalLink size={17} aria-hidden />
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/[0.07] pt-4 text-[11px] font-bold text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><UserRound size={13} aria-hidden /> {item.created_by_name}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock3 size={13} aria-hidden /> {formatCreatedAt(item.created_at)}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void copySavedLink(item)}
                    className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-slate-200 transition hover:border-cyan-400/25 hover:bg-white/[0.07]"
                  >
                    {copiedId === item.id ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                    {copiedId === item.id ? 'Link copiado' : 'Copiar link'}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </InternalLayout>
  );
}
