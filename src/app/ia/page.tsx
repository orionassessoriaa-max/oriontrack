'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';

type AiConnection = {
  configured?: boolean;
  dedicated?: boolean;
  active?: boolean;
  connected?: boolean;
  state?: 'open' | 'connecting' | 'close';
  concessionaria?: string;
  error?: string;
};

export default function AiConnectionPage() {
  const [connection, setConnection] = useState<AiConnection>({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token || '', []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ia/whatsapp', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' });
      const payload = await response.json();
      setConnection(payload);
      if (!response.ok && payload.error) setNotice(payload.error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!qr && connection.state !== 'connecting') return;
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, [qr, connection.state, load]);

  async function connect() {
    setConnecting(true);
    setNotice(null);
    try {
      const response = await fetch('/api/ia/whatsapp', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Falha ao conectar.');
      setQr(payload.qrcode || null);
      setConnection((current) => ({ ...current, state: 'connecting' }));
      setNotice(payload.qrcode ? 'Escaneie o QR Code com o numero exclusivo da IA.' : 'Conexao iniciada. Aguarde alguns segundos.');
    } catch (error: any) {
      setNotice(error.message);
    } finally {
      setConnecting(false);
    }
  }

  return <InternalLayout>
    <main className="mx-auto max-w-4xl px-5 py-8 sm:py-12">
      <section className="overflow-hidden rounded-[28px] border border-cyan-500/15 bg-[#07111f] shadow-2xl shadow-cyan-950/20">
        <header className="border-b border-white/5 bg-gradient-to-r from-cyan-500/10 to-blue-500/5 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><Bot size={25} /></span>
            <div><span className="text-[10px] font-black uppercase tracking-[.22em] text-cyan-400">Atendimento automatico</span><h1 className="mt-1 text-3xl font-black text-white">Conectar IA</h1><p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-slate-400">Conecte um WhatsApp exclusivo para a IA da sua concessionaria. Esta conexao nao pertence ao Inbox de nenhum usuario.</p></div>
          </div>
        </header>
        <div className="space-y-5 p-6 sm:p-8">
          {loading ? <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-cyan-400" size={34} /></div> : <>
            <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-slate-950/50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Concessionaria</p><p className="mt-1 text-lg font-black text-white">{connection.concessionaria || 'Nao identificada'}</p></div>
              <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black ${connection.connected ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-400/25 bg-amber-500/10 text-amber-300'}`}>{connection.connected ? <CheckCircle2 size={15} /> : <Smartphone size={15} />}{connection.connected ? 'IA conectada' : 'Aguardando conexao'}</span>
            </div>
            {!connection.dedicated && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm font-bold text-amber-200">O administrador deve selecionar <strong>Numero exclusivo da IA</strong> na configuracao desta concessionaria. As conexoes atuais de usuarios continuam funcionando normalmente.</div>}
            {connection.dedicated && !connection.connected && <button type="button" disabled={connecting} onClick={() => void connect()} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-cyan-500 px-5 py-4 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-400 disabled:opacity-50">{connecting ? <Loader2 size={19} className="animate-spin" /> : <QrCode size={19} />}Conectar IA</button>}
            {connection.connected && <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/5 p-4 text-sm font-bold text-emerald-200"><ShieldCheck size={20} /> A IA esta pronta para atender pelo numero exclusivo.</div>}
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 text-xs font-black text-slate-400 hover:text-white"><RefreshCw size={14} /> Atualizar status</button>
          </>}
          {notice && <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-sm font-bold text-slate-300">{notice}</div>}
        </div>
      </section>
      {qr && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-sm"><div className="relative rounded-3xl border border-white/10 bg-white p-7 text-center shadow-2xl"><button onClick={() => setQr(null)} className="absolute right-3 top-3 rounded-full bg-slate-100 p-2 text-slate-700"><X size={16} /></button><h2 className="text-xl font-black text-slate-950">Conecte o WhatsApp da IA</h2><p className="mt-1 text-sm font-semibold text-slate-500">Aponte a camera do WhatsApp para o codigo.</p><img className="mx-auto mt-5 h-72 w-72" src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR Code da IA" /></div></div>}
    </main>
  </InternalLayout>;
}
