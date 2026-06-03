'use client';

import { useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { Loader2, ExternalLink, RefreshCw, Calculator, Info } from 'lucide-react';

export default function SimuladorPage() {
  const [loading, setLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);

  const baseIframeUrl = "https://beta.paineldocorretor.com.br/cotacoes?somente-conteudo=true";

  const handleRefresh = () => {
    setLoading(true);
    setIframeKey((prev) => prev + 1);
  };

  return (
    <InternalLayout>
      <div className="flex flex-col h-[calc(100vh-110px)] space-y-4">
        
        {/* Header Superior Premium */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-extrabold text-xs uppercase tracking-widest">
              <Calculator size={14} className="animate-pulse" />
              <span>Simulador de Planos</span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
              Painel do Corretor
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-bold text-slate-400">
              Faça suas simulações e cálculos de planos de saúde de forma integrada.
            </p>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-bold text-slate-300 transition-all active:scale-95"
              title="Recarregar Simulador"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Recarregar
            </button>
            <a
              href="https://beta.paineldocorretor.com.br/cotacoes?"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-bold text-white transition-all shadow-lg shadow-cyan-950/20 active:scale-95"
            >
              <ExternalLink size={14} />
              Abrir em Nova Aba
            </a>
          </div>
        </div>

        {/* Informação sobre exibição de usuário */}
        <div className="flex items-start gap-3 p-3.5 bg-slate-900/60 rounded-2xl border border-white/5 text-xs text-slate-400 shrink-0">
          <Info size={16} className="text-cyan-400 shrink-0 mt-0.5" />
          <p className="font-medium leading-relaxed">
            <strong className="text-white">Aviso de Exibição:</strong> O simulador abaixo é fornecido externamente pelo Painel do Corretor. Para ocultar cabeçalhos ou dados da conta, você deve configurar ou solicitar um link direto simplificado (Hash) junto ao suporte do Painel do Corretor. Tentamos carregar no modo simplificado automaticamente.
          </p>
        </div>

        {/* Container do Iframe com Loading State */}
        <div className="relative flex-1 w-full bg-slate-950/40 rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm transition-all duration-300">
              <Loader2 size={36} className="text-cyan-400 animate-spin mb-4" />
              <p className="text-sm font-black text-white tracking-wider uppercase">Carregando Simulador...</p>
              <p className="text-2xs text-slate-500 mt-1 font-bold">Painel do Corretor Integrado</p>
            </div>
          )}

          <iframe
            key={iframeKey}
            src={baseIframeUrl}
            className="w-full h-full border-none rounded-3xl"
            onLoad={() => setLoading(false)}
            allow="clipboard-read; clipboard-write; geolocation"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          />
        </div>

      </div>
    </InternalLayout>
  );
}
