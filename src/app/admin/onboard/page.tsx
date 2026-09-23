'use client';

import { Check, Copy, ExternalLink, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';

export default function AdminOnboardPage() {
  const [cliente, setCliente] = useState('');
  const [segmento, setSegmento] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const clienteValido = Boolean(cliente.trim());
  const onboardingPath = useMemo(() => {
    return `/onboard/?cliente=${encodeURIComponent(cliente.trim())}&segmento=${encodeURIComponent(segmento.trim())}`;
  }, [cliente, segmento]);

  function openOnboarding() {
    if (!clienteValido) return;
    window.open(onboardingPath, '_blank', 'noopener,noreferrer');
  }

  async function copyLink() {
    if (!clienteValido) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${onboardingPath}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyError('Não foi possível copiar o link. Tente novamente.');
    }
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

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
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
      </div>
    </InternalLayout>
  );
}
