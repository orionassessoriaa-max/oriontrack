'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Pause, Play, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type WhatsAppMessage = {
  id: string;
  conversa_id: string;
  direction: 'inbound' | 'outbound';
  remetente: string | null;
  mensagem: string;
  created_at: string;
  metadata?: any;
};

function getMimeType(message: WhatsAppMessage) {
  const metadata = message.metadata || {};
  const media = metadata?.message?.audioMessage
    || metadata?.data?.message?.audioMessage
    || metadata?.message?.message?.audioMessage
    || metadata?.data?.message?.message?.audioMessage;
  return String(
    metadata.media_mimetype
    || metadata.mimetype
    || media?.mimetype
    || media?.mimeType
    || ''
  ).toLowerCase();
}

function isAudioMessage(message: WhatsAppMessage) {
  const metadata = message.metadata || {};
  const messageType = String(
    metadata.messageType
    || metadata.type
    || metadata.mediaType
    || metadata?.data?.messageType
    || ''
  ).toLowerCase();
  const text = String(message.mensagem || '').toLowerCase();
  return getMimeType(message).startsWith('audio/')
    || messageType.includes('audio')
    || messageType.includes('voice')
    || text.includes('mensagem de voz')
    || text.includes('audio gravado')
    || text.includes('áudio gravado');
}

function getAudioTranscript(message: WhatsAppMessage) {
  return String(
    message.metadata?.audio_transcript
    || message.metadata?.ai_customer_message
    || ''
  )
    .replace(/^Audio transcrito do cliente:\s*/i, '')
    .trim();
}

function base64ToObjectUrl(base64: string, mimeType: string) {
  const cleanBase64 = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;
  const bytes = Uint8Array.from(atob(cleanBase64), (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || 'audio/ogg' }));
}

export default function LeadWhatsAppHistory({ leadId, profileId }: { leadId: string; profileId?: string | null }) {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<Record<string, string>>({});

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/messages`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar a conversa.');
      setMessages(payload.messages || []);
    } catch (loadError: any) {
      setError(loadError?.message || 'Nao foi possivel carregar a conversa.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void loadMessages();
    const refreshTimer = window.setInterval(() => void loadMessages(true), 30_000);
    return () => window.clearInterval(refreshTimer);
  }, [loadMessages]);

  useEffect(() => () => {
    audioRef.current?.pause();
    Object.values(audioUrlsRef.current).forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
  }, []);

  async function playAudio(message: WhatsAppMessage) {
    if (playingAudioId === message.id) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
      return;
    }

    audioRef.current?.pause();
    setLoadingAudioId(message.id);
    try {
      let url = audioUrlsRef.current[message.id];
      if (!url) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Sessao expirada.');

        const response = await fetch(`/api/inbox/messages/media?message_id=${encodeURIComponent(message.id)}&refresh=1`, {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(profileId ? { 'x-orion-view-profile-id': profileId } : {}),
          },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Audio indisponivel.');
        url = payload.base64
          ? base64ToObjectUrl(payload.base64, payload.mimeType || getMimeType(message) || 'audio/ogg')
          : payload.url;
        if (!url) throw new Error('Audio indisponivel.');
        audioUrlsRef.current[message.id] = url;
      }

      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = url;
      audio.currentTime = 0;
      audioRef.current = audio;
      audio.onended = () => setPlayingAudioId(null);
      audio.onerror = () => {
        setPlayingAudioId(null);
        setError('Nao foi possivel reproduzir este audio por completo.');
      };
      await audio.play();
      setPlayingAudioId(message.id);
    } catch (audioError: any) {
      setError(audioError?.message || 'Nao foi possivel reproduzir este audio.');
      setPlayingAudioId(null);
    } finally {
      setLoadingAudioId(null);
    }
  }

  return (
    <section className="mb-5 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-emerald-950">
            <MessageCircle size={16} /> Conversa WhatsApp
          </h3>
          <p className="mt-1 text-[11px] font-bold text-emerald-700">
            {loading ? 'Carregando historico completo...' : `${messages.length} mensagem(ns)`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMessages()}
          disabled={loading}
          title="Atualizar conversa"
          className="rounded-xl border border-emerald-200 bg-white p-2 text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <p className="mb-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}

      <div className="max-h-96 space-y-2 overflow-y-auto rounded-2xl bg-[#07111f] p-3">
        {loading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="animate-spin text-emerald-400" size={22} />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-xs font-bold text-slate-400">Nenhuma mensagem registrada para este lead.</p>
        ) : messages.map((message) => {
          const outbound = message.direction === 'outbound';
          const audio = isAudioMessage(message);
          const transcript = getAudioTranscript(message);
          return (
            <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-3 py-2 ${outbound ? 'rounded-tr-sm bg-cyan-600 text-white' : 'rounded-tl-sm bg-slate-800 text-slate-100'}`}>
                {audio ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void playAudio(message)}
                      disabled={loadingAudioId === message.id}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15"
                    >
                      {loadingAudioId === message.id
                        ? <Loader2 className="animate-spin" size={14} />
                        : playingAudioId === message.id
                          ? <Pause size={14} fill="currentColor" />
                          : <Play size={14} fill="currentColor" />}
                    </button>
                    <div>
                      <p className="text-xs font-black">Mensagem de voz</p>
                      {transcript && <p className="mt-1 text-[11px] font-medium leading-relaxed opacity-85">{transcript}</p>}
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-xs font-medium leading-relaxed">{message.mensagem || 'Mensagem sem texto'}</p>
                )}
                <div className="mt-1 flex items-center justify-end gap-2 text-[9px] font-bold opacity-70">
                  {message.remetente && <span>{message.remetente}</span>}
                  <time>{new Date(message.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
