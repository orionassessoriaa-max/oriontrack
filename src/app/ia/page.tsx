'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, X } from 'lucide-react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';

type AiConnection = {
  dedicated?: boolean;
  can_connect?: boolean;
  connected?: boolean;
  state?: 'open' | 'connecting' | 'close';
  error?: string;
};

export default function AiConnectionPage() {
  const { profile } = useAuth();
  const [connection, setConnection] = useState<AiConnection>({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accessToken = useCallback(
    async () => (await supabase.auth.getSession()).data.session?.access_token || '',
    [],
  );

  const requestHeaders = useCallback(async () => ({
    Authorization: `Bearer ${await accessToken()}`,
    ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
  }), [accessToken, profile?.id]);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/ia/whatsapp', {
        headers: await requestHeaders(),
        cache: 'no-store',
      });
      const payload = await response.json();
      setConnection(payload);
      if (response.ok) setNotice(null);
      else setNotice(payload.error || 'Nao foi possivel consultar a conexao.');
      if (payload.connected) {
        setQr(null);
        setNotice(null);
      }
    } catch {
      setNotice('Nao foi possivel consultar a conexao.');
    } finally {
      setLoading(false);
    }
  }, [requestHeaders]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!qr && connection.state !== 'connecting') return;
    const interval = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(interval);
  }, [connection.state, load, qr]);

  async function connect() {
    setConnecting(true);
    setNotice(null);
    try {
      const response = await fetch('/api/ia/whatsapp', {
        method: 'POST',
        headers: await requestHeaders(),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Falha ao conectar.');
      setQr(payload.qrcode || null);
      setConnection((current) => ({ ...current, state: 'connecting' }));
      if (!payload.qrcode) setNotice('Conexao iniciada. Aguarde alguns segundos.');
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Falha ao conectar.');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <InternalLayout>
      <main className="grid min-h-[calc(100vh-80px)] place-items-center px-5 py-10">
        <section className="w-full max-w-md rounded-[28px] border border-cyan-500/15 bg-[#07111f] p-7 text-center shadow-2xl shadow-cyan-950/20 sm:p-9">
          <h1 className="text-3xl font-black text-white">Conectar IA</h1>

          {loading ? (
            <Loader2 className="mx-auto mt-8 animate-spin text-cyan-400" size={34} />
          ) : connection.connected ? (
            <div className="mt-8 flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-5 py-4 text-sm font-black text-emerald-300">
              <CheckCircle2 size={19} /> IA conectada
            </div>
          ) : (
            <button
              type="button"
              disabled={connecting || connection.can_connect !== true}
              onClick={() => void connect()}
              className="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl bg-cyan-500 px-5 py-4 text-sm font-black text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? <Loader2 size={19} className="animate-spin" /> : <QrCode size={19} />}
              Conectar IA
            </button>
          )}

          {!loading && connection.can_connect === false && (
            <p className="mt-4 text-sm font-bold text-amber-300">
              Esta concessionaria ja usa a IA pelo WhatsApp de um perfil. Altere para numero exclusivo no painel administrativo antes de conectar.
            </p>
          )}
          {notice && <p className="mt-4 text-sm font-bold text-rose-300">{notice}</p>}
        </section>

        {qr && (
          <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-sm">
            <div className="relative rounded-3xl bg-white p-7 text-center shadow-2xl">
              <button type="button" onClick={() => setQr(null)} className="absolute right-3 top-3 rounded-full bg-slate-100 p-2 text-slate-700">
                <X size={16} />
              </button>
              <h2 className="text-xl font-black text-slate-950">Escaneie o QR Code</h2>
              <img
                className="mx-auto mt-5 h-72 w-72"
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR Code para conectar a IA"
              />
            </div>
          </div>
        )}
      </main>
    </InternalLayout>
  );
}
