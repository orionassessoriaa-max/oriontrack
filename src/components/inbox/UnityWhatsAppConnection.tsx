'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, QrCode, RefreshCw, Smartphone, Unplug } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useDialog } from '@/components/providers/DialogProvider';
import { supabase } from '@/lib/supabase/client';

type ConnectionState = 'checking' | 'open' | 'connecting' | 'close';

function formatConnectedNumber(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 12) return value;
  const country = digits.slice(0, 2);
  const area = digits.slice(2, 4);
  const number = digits.slice(4);
  return `+${country} (${area}) ${number.slice(0, number.length - 4)}-${number.slice(-4)}`;
}

export default function UnityWhatsAppConnection({ isDark }: { isDark: boolean }) {
  const { profile } = useAuth();
  const { confirmDialog } = useDialog();
  const [status, setStatus] = useState<ConnectionState>('checking');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedCompany = String(profile?.nome_empresa || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  const isUnity = normalizedCompany === 'UNITY SAUDE';

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!isUnity || !profile?.id) return;
    const token = await getToken();
    if (!token) return;

    try {
      const response = await fetch('/api/inbox/uazapi/connect', {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-orion-view-profile-id': profile.id,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel consultar a conexao.');

      setStatus(payload.state || 'close');
      setQrCode(payload.connected ? null : payload.qrcode || null);
      setNumber(String(payload.numero || ''));
      setOwnerName(payload.targetProfile?.nome || profile.nome || 'Unity');
      setCanManage(payload.canManageConnection !== false);
      setError(null);
    } catch (statusError: any) {
      setError(statusError?.message || 'Nao foi possivel consultar a conexao.');
    } finally {
      setLoading(false);
    }
  }, [getToken, isUnity, profile?.id, profile?.nome]);

  useEffect(() => {
    void fetchStatus();
    if (!isUnity) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchStatus();
    }, status === 'open' ? 30_000 : 10_000);
    return () => window.clearInterval(interval);
  }, [fetchStatus, isUnity, status]);

  async function connect() {
    const token = await getToken();
    if (!token || !profile?.id) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/inbox/uazapi/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-orion-view-profile-id': profile.id,
        },
        body: JSON.stringify({ accepted_terms: true, terms_version: 'whatsapp-inbox-v1' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel gerar o QR Code.');
      setStatus(payload.state || (payload.connected ? 'open' : 'connecting'));
      setQrCode(payload.connected ? null : payload.qrcode || null);
      setOwnerName(payload.targetProfile?.nome || profile.nome || 'Unity');
      await fetchStatus();
    } catch (connectError: any) {
      setError(connectError?.message || 'Nao foi possivel gerar o QR Code.');
    } finally {
      setActionLoading(false);
    }
  }

  async function disconnect() {
    const confirmed = await confirmDialog(
      'Desconectar o WhatsApp da Unity? As mensagens deixarao de chegar ate uma nova leitura do QR Code.',
      { title: 'Desconectar WhatsApp', confirmLabel: 'Desconectar', cancelLabel: 'Cancelar', variant: 'danger' },
    );
    if (!confirmed) return;

    const token = await getToken();
    if (!token || !profile?.id) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/inbox/uazapi/connect', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-orion-view-profile-id': profile.id,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel desconectar a conta.');
      setStatus('close');
      setQrCode(null);
      setNumber('');
    } catch (disconnectError: any) {
      setError(disconnectError?.message || 'Nao foi possivel desconectar a conta.');
    } finally {
      setActionLoading(false);
    }
  }

  if (!isUnity) return null;

  const connected = status === 'open';
  return (
    <section className={`mb-8 overflow-hidden rounded-[2rem] border ${isDark ? 'border-white/5 bg-[#090e1a]' : 'border-gray-100 bg-white shadow-sm'}`} aria-labelledby="unity-whatsapp-title">
      <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-500'}`}>
            {loading ? <Loader2 className="animate-spin" size={22} /> : connected ? <Smartphone size={22} /> : <QrCode size={22} />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="unity-whatsapp-title" className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>WhatsApp da Unity</h2>
              <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${connected ? 'bg-emerald-500/10 text-emerald-500' : status === 'connecting' ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-500'}`}>
                {loading ? 'Verificando' : connected ? 'Conectado' : status === 'connecting' ? 'Aguardando leitura' : 'Desconectado'}
              </span>
            </div>
            <p className={`mt-1 text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
              {connected
                ? `${ownerName || 'Conta'} conectada${number ? ` no numero ${formatConnectedNumber(number)}` : ''}.`
                : canManage
                  ? 'Gere o QR Code aqui para conectar a conta compartilhada da Unity.'
                  : `A conexao compartilhada e administrada por ${ownerName || 'um responsavel da Unity'}.`}
            </p>
            {error && <p role="alert" className="mt-2 text-xs font-bold text-rose-500">{error}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={() => void fetchStatus()} disabled={loading || actionLoading} className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-xs font-black ${isDark ? 'border-white/10 text-slate-300 hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'} disabled:opacity-50`}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
          {canManage && (connected ? (
            <button type="button" onClick={() => void disconnect()} disabled={actionLoading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 text-xs font-black text-rose-500 hover:bg-rose-500/15 disabled:opacity-50">
              {actionLoading ? <Loader2 className="animate-spin" size={15} /> : <Unplug size={15} />} Desconectar
            </button>
          ) : (
            <button type="button" onClick={() => void connect()} disabled={actionLoading || status === 'checking'} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50">
              {actionLoading ? <Loader2 className="animate-spin" size={15} /> : <QrCode size={15} />} Gerar QR Code
            </button>
          ))}
        </div>
      </div>

      {qrCode && !connected && canManage && (
        <div className={`border-t p-6 ${isDark ? 'border-white/5 bg-black/20' : 'border-gray-100 bg-slate-50'}`}>
          <div className="mx-auto flex max-w-xl flex-col items-center text-center">
            <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code para conectar o WhatsApp da Unity" className="h-56 w-56 rounded-2xl bg-white p-3 shadow-lg" />
            <p className={`mt-4 text-xs font-bold ${isDark ? 'text-slate-300' : 'text-gray-600'}`}>No WhatsApp, abra Aparelhos conectados e leia este código.</p>
            <p className={`mt-1 text-[10px] font-semibold ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>A página atualiza o status automaticamente após a leitura.</p>
          </div>
        </div>
      )}
    </section>
  );
}
