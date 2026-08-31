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
  qrcode?: string | null;
  paircode?: string | null;
  motivo_desconexao?: string | null;
  error?: string;
};

export default function AiConnectionPage() {
  const { profile } = useAuth();
  const [connection, setConnection] = useState<AiConnection>({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [paircode, setPaircode] = useState<string | null>(null);
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
        setPaircode(null);
        setNotice(null);
      } else if (payload.qrcode) {
        // O codigo da central vale menos de um minuto: a imagem na tela
        // acompanha o que ela espera agora, senao o aparelho recusa a leitura.
        setQr(payload.qrcode);
        setPaircode(payload.paircode || null);
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
    const interval = window.setInterval(() => void load(), 15000);
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
      setPaircode(payload.paircode || null);
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
          {!loading && !connection.connected && connection.motivo_desconexao && (
            <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-200">
              A central informou: {connection.motivo_desconexao}.
              {/^403|logged out/i.test(String(connection.motivo_desconexao)) && ' Isso acontece quando o proprio aparelho do numero da IA desconecta o dispositivo. Confira em Dispositivos conectados antes de ler o QR de novo.'}
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
              <p className="mx-auto mt-2 max-w-xs text-xs font-bold text-slate-500">
                Use o celular do numero da IA, nao o do seu atendimento.
              </p>
              <img
                className="mx-auto mt-5 h-72 w-72"
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR Code para conectar a IA"
              />
              <p className="mt-3 text-[11px] font-bold text-slate-400">O codigo se renova sozinho a cada 15 segundos.</p>
              {paircode && (
                <div className="mt-4 rounded-2xl bg-slate-100 px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                    Ou conecte pelo numero de telefone
                  </p>
                  <p className="mt-1 text-2xl font-black tracking-[0.3em] text-slate-900">{paircode}</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">
                    WhatsApp, Dispositivos conectados, Conectar com numero de telefone.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </InternalLayout>
  );
}
