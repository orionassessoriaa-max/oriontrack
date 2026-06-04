'use client';

import { useEffect, useState } from 'react';
import { X, WalletCards } from 'lucide-react';

export default function SaleFinanceRedirect({
  leadId,
  leadName,
  onCancel,
}: {
  leadId: string;
  leadName?: string | null;
  onCancel: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [seconds, setSeconds] = useState(3);

  useEffect(() => {
    const showTimer = window.setTimeout(() => setVisible(true), 1000);
    return () => window.clearTimeout(showTimer);
  }, []);

  useEffect(() => {
    if (!visible) return;

    if (seconds <= 0) {
      window.location.href = `/financeiro?lead=${leadId}`;
      return;
    }

    const timer = window.setTimeout(() => setSeconds((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [leadId, seconds, visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[2rem] border border-cyan-500/20 bg-[#07111f] p-6 text-white shadow-2xl shadow-black/40">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
              <WalletCards size={24} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Venda fechada</p>
              <h2 className="mt-1 text-xl font-black">Abrir controle financeiro?</h2>
            </div>
          </div>
          <button onClick={onCancel} className="rounded-xl bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm font-bold leading-6 text-slate-300">
          {leadName || 'Esse lead'} virou venda. Vou te levar para configurar parcelamento, receita do mes e previsao do proximo mes em {seconds}s.
        </p>
        <div className="mt-5 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 transition hover:bg-white/5">
            Cancelar
          </button>
          <button onClick={() => { window.location.href = `/financeiro?lead=${leadId}`; }} className="flex-1 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-400">
            Ir agora
          </button>
        </div>
      </div>
    </div>
  );
}
