'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Loader2, MessageSquare, QrCode, RefreshCw, Smartphone } from 'lucide-react';

type Conversation = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
  telefone: string;
  nome_contato: string | null;
  status: string;
  ultima_mensagem_at: string | null;
};

export default function BrokerInboxPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [leadPhone, setLeadPhone] = useState('');

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

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">WhatsApp</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Inbox</h1>
          <p className="font-medium text-gray-500">Conecte seu WhatsApp e centralize as conversas dos leads dentro do Orion Track.</p>
        </div>
        <button onClick={fetchInbox} className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm">
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
            Aqui entra a conexão via Evolution API. O corretor vai clicar em conectar, escanear o QR Code e as conversas passam a aparecer nesta tela.
          </p>
          <button className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white opacity-80">
            <Smartphone size={18} /> Conectar meu WhatsApp
          </button>
          <p className="mt-3 text-xs font-bold text-blue-700">
            Status atual: aguardando integração Evolution API.
          </p>
        </div>

        <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
            <CheckCircle2 size={24} />
          </div>
          <h2 className="text-xl font-black text-gray-950">Como vai funcionar</h2>
          <div className="mt-4 grid gap-3 text-sm font-bold text-slate-600 md:grid-cols-3">
            <span className="rounded-2xl bg-white/80 p-4">1. Corretor conecta o WhatsApp pelo QR Code.</span>
            <span className="rounded-2xl bg-white/80 p-4">2. Evolution envia conversas para o Orion Track.</span>
            <span className="rounded-2xl bg-white/80 p-4">3. Botão “Chamar inbox” abre este atendimento.</span>
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
                className={`w-full border-b border-gray-100 p-4 text-left transition-all hover:bg-blue-50 ${selectedConversation?.id === conversation.id ? 'bg-blue-50' : 'bg-white'}`}
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
            <p className="text-xs font-bold text-slate-400">Mensagens em tempo real entram na próxima etapa da integração Evolution.</p>
          </div>
          <div className="flex flex-1 items-center justify-center bg-slate-50 p-8 text-center">
            <div>
              <MessageSquare className="mx-auto mb-4 text-blue-500" size={42} />
              <h3 className="text-xl font-black text-gray-900">Inbox pronto para integração</h3>
              <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-relaxed text-slate-500">
                A tela já está criada. Para ficar funcional de verdade, vamos ligar a Evolution API para gerar QR Code, listar mensagens e enviar respostas.
              </p>
            </div>
          </div>
        </section>
      </div>
    </InternalLayout>
  );
}
