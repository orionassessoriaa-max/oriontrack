'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Loader2, MessageSquare, QrCode, RefreshCw, Send, Smartphone } from 'lucide-react';

type Conversation = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
  telefone: string;
  nome_contato: string | null;
  status: string;
  ultima_mensagem_at: string | null;
};

type InboxMessage = {
  id: string;
  conversa_id: string;
  direction: 'inbound' | 'outbound';
  remetente: string | null;
  mensagem: string;
  created_at: string;
};

export default function BrokerInboxPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [leadPhone, setLeadPhone] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  async function fetchInbox() {
    if (!profile?.corretor_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams(window.location.search);
    setLeadPhone(params.get('telefone') || '');

    const { data } = await supabase
      .from('whatsapp_conversas')
      .select('*')
      .eq('corretor_id', profile.corretor_id)
      .order('ultima_mensagem_at', { ascending: false })
      .limit(80);

    const rows = (data || []) as Conversation[];
    setConversations(rows);
    setSelectedConversation(rows[0] || null);
    setLoading(false);
  }

  useEffect(() => {
    void fetchInbox();
  }, [profile?.corretor_id]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  async function fetchMessages(conversationId: string) {
    const token = await getToken();
    if (!token) return;

    setLoadingMessages(true);
    const response = await fetch(`/api/inbox/messages?conversation_id=${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    setMessages(response.ok ? (payload.messages || []) : []);
    setLoadingMessages(false);
  }

  useEffect(() => {
    if (selectedConversation?.id) {
      void fetchMessages(selectedConversation.id);
    } else {
      setMessages([]);
    }
  }, [selectedConversation?.id]);

  async function connectWhatsApp() {
    setConnecting(true);
    setConnectError(null);
    setQrCode(null);

    const token = await getToken();
    if (!token) {
      setConnectError('Sessao expirada. Entre novamente.');
      setConnecting(false);
      return;
    }

    const response = await fetch('/api/inbox/evolution/connect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    setConnecting(false);

    if (!response.ok) {
      setConnectError(payload.error || 'Nao consegui gerar o QR Code agora. Tente novamente em alguns instantes.');
      return;
    }

    setQrCode(payload.qrcode || null);
    if (!payload.qrcode) {
      setConnectError('Nao recebi o QR Code. Tente novamente ou avise a equipe da Orion.');
    }
  }

  async function sendMessage() {
    if (!selectedConversation || !messageText.trim()) return;

    const token = await getToken();
    if (!token) {
      setConnectError('Sessao expirada. Entre novamente.');
      return;
    }

    setSendingMessage(true);
    const response = await fetch('/api/inbox/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversation_id: selectedConversation.id,
        mensagem: messageText.trim(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setSendingMessage(false);

    if (!response.ok) {
      setConnectError(payload.error || 'Nao consegui enviar agora. Tente novamente em instantes.');
      return;
    }

    setMessageText('');
    setConnectError(null);
    if (payload.message) setMessages((current) => [...current, payload.message]);
    void fetchInbox();
  }

  const formatHour = (value: string) => {
    try {
      return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">WhatsApp</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Inbox</h1>
          <p className="font-medium text-gray-500">Atenda seus leads com mais controle, historico e velocidade em um so lugar.</p>
        </div>
        <button onClick={fetchInbox} className="flex cursor-pointer items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar
        </button>
      </div>

      <div className="mb-8 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-[2rem] border border-blue-100 bg-blue-50 p-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
            <QrCode size={24} />
          </div>
          <h2 className="text-xl font-black text-gray-950">Conectar WhatsApp</h2>
          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
            Escaneie o QR Code e atenda seus leads direto por aqui. Suas conversas ficam organizadas para voce responder rapido, acompanhar retornos e nao perder oportunidades.
          </p>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-blue-100 bg-white/80 p-4 text-left transition-all hover:border-blue-200 hover:bg-white">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-blue-200 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs font-bold leading-relaxed text-slate-600">
              Li e aceito conectar meu WhatsApp ao Orion Track. Entendo que as conversas dos leads poderao aparecer aqui para facilitar meu atendimento, historico e acompanhamento comercial.
            </span>
          </label>
          <button
            onClick={connectWhatsApp}
            disabled={connecting || !acceptedTerms}
            className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {connecting ? <Loader2 className="animate-spin" size={18} /> : <Smartphone size={18} />}
            {connecting ? 'Gerando QR Code...' : 'Conectar meu WhatsApp'}
          </button>
          {qrCode ? (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 text-center">
              <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code WhatsApp" className="mx-auto h-52 w-52 rounded-xl object-contain" />
              <p className="mt-3 text-xs font-black uppercase tracking-widest text-blue-700">Escaneie com o WhatsApp</p>
            </div>
          ) : null}
          {connectError ? (
            <p className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-700">{connectError}</p>
          ) : (
            <p className="mt-3 text-xs font-bold text-blue-700">Quando o QR Code aparecer, abra o WhatsApp no celular, toque em aparelhos conectados e faca a leitura.</p>
          )}
        </div>

        <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
            <CheckCircle2 size={24} />
          </div>
          <h2 className="text-xl font-black text-gray-950">Como vai funcionar</h2>
          <div className="mt-4 grid gap-3 text-sm font-bold text-slate-600 md:grid-cols-3">
            <span className="rounded-2xl bg-white/80 p-4">1. Voce conecta seu WhatsApp pelo QR Code.</span>
            <span className="rounded-2xl bg-white/80 p-4">2. As conversas dos leads ficam organizadas por atendimento.</span>
            <span className="rounded-2xl bg-white/80 p-4">3. No CRM, o botao de conversar leva direto para esse lead.</span>
          </div>
          {leadPhone && (
            <div className="mt-4 rounded-2xl bg-white p-4 text-sm font-black text-emerald-700">
              Lead selecionado pelo CRM: {leadPhone}
            </div>
          )}
        </div>
      </div>

      <div className="grid min-h-[520px] overflow-hidden rounded-[2rem] border border-gray-100 bg-white shadow-sm lg:grid-cols-[360px_1fr]">
        <aside className="border-r border-gray-100">
          <div className="border-b border-gray-100 p-5">
            <h2 className="font-black text-gray-900">Conversas</h2>
            <p className="text-xs font-bold text-slate-400">{conversations.length} conversas encontradas</p>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="animate-spin text-blue-600" size={28} />
              </div>
            ) : conversations.length > 0 ? conversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => setSelectedConversation(conversation)}
                className={`w-full cursor-pointer border-b border-gray-100 p-4 text-left transition-all hover:bg-blue-50 ${selectedConversation?.id === conversation.id ? 'bg-blue-50' : 'bg-white'}`}
              >
                <p className="font-black text-gray-900">{conversation.nome_contato || conversation.telefone}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{conversation.telefone}</p>
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-blue-600">{conversation.status || 'Aberta'}</p>
              </button>
            )) : (
              <div className="p-8 text-center">
                <MessageSquare className="mx-auto mb-3 text-slate-300" size={34} />
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Nenhuma conversa ainda</p>
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-[520px] flex-col">
          <div className="border-b border-gray-100 p-5">
            <h2 className="font-black text-gray-900">{selectedConversation?.nome_contato || selectedConversation?.telefone || 'Selecione uma conversa'}</h2>
            <p className="text-xs font-bold text-slate-400">{selectedConversation ? selectedConversation.telefone : 'Escolha um atendimento para responder.'}</p>
          </div>
          {selectedConversation ? (
            <>
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-slate-50 p-5">
                {loadingMessages ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="animate-spin text-blue-600" size={30} />
                  </div>
                ) : messages.length > 0 ? messages.map((message) => {
                  const mine = message.direction === 'outbound';
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] rounded-3xl px-4 py-3 shadow-sm ${mine ? 'bg-blue-600 text-white' : 'bg-white text-slate-800'}`}>
                        <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed">{message.mensagem}</p>
                        <p className={`mt-2 text-[10px] font-black uppercase tracking-widest ${mine ? 'text-blue-100' : 'text-slate-400'}`}>{formatHour(message.created_at)}</p>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="flex flex-1 items-center justify-center text-center">
                    <div>
                      <MessageSquare className="mx-auto mb-4 text-blue-500" size={42} />
                      <h3 className="text-xl font-black text-gray-900">Conversa pronta para atender</h3>
                      <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-relaxed text-slate-500">
                        Quando o cliente responder, as mensagens aparecem aqui. Voce tambem pode iniciar o contato pelo campo abaixo.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-gray-100 bg-white p-4">
                <div className="flex gap-3">
                  <textarea
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    rows={2}
                    placeholder="Escreva sua resposta..."
                    className="min-h-[52px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-300 focus:bg-white"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sendingMessage || !messageText.trim()}
                    className="flex min-w-[112px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sendingMessage ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} Enviar
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center bg-slate-50 p-8 text-center">
              <div>
                <MessageSquare className="mx-auto mb-4 text-blue-500" size={42} />
                <h3 className="text-xl font-black text-gray-900">Conecte para iniciar os atendimentos</h3>
                <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-relaxed text-slate-500">
                  Conecte seu WhatsApp para acompanhar as conversas dos leads com mais clareza e rapidez.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </InternalLayout>
  );
}
