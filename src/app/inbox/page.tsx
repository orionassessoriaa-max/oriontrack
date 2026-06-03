'use client';

import { useEffect, useState, useRef } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { 
  CheckCircle2, 
  Loader2, 
  MessageSquare, 
  Paperclip, 
  QrCode, 
  RefreshCw, 
  Send, 
  Smartphone, 
  X,
  Clock,
  Archive,
  AlertTriangle,
  User,
  MoreHorizontal,
  Calendar,
  History,
  Ban,
  Share2,
  Smile,
  FileText,
  Mic,
  Plus,
  Trash2,
  Check,
  Search,
  Bot,
  Sparkles
} from 'lucide-react';

type Conversation = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
  telefone: string;
  nome_contato: string | null;
  status: string;
  ultima_mensagem_at: string | null;
  agentName?: string;
  expirationTime?: string;
  protocolNumber?: string;
  tags?: string[];
  notes?: string[];
  source?: string;
  aiActive?: boolean;
};

type InboxMessage = {
  id: string;
  conversa_id: string;
  direction: 'inbound' | 'outbound';
  remetente: string | null;
  mensagem: string;
  created_at: string;
  isAudio?: boolean;
  audioDuration?: string;
};

const TEMPLATES_PADRAO = [
  { id: '1', title: 'Boas-vindas Comercial', text: 'Olá! Sou da Orion Seguros. Como posso te ajudar hoje com a cotação do seu plano de saúde?' },
  { id: '2', title: 'Simulação Pronta', text: 'Tudo bem? Sua simulação de planos de saúde já está pronta. Segue o link com as opções detalhadas para você analisar: [Link]' },
  { id: '3', title: 'Cobrança de Documentos', text: 'Para darmos andamento na contratação do seu plano, preciso que me envie os seguintes documentos: RG, CPF e Comprovante de Residência.' },
  { id: '4', title: 'Pesquisa de Satisfação', text: 'O que achou do nosso atendimento hoje? Sua opinião é muito importante para nós!' }
];

export default function BrokerInboxPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  
  // Connection states
  const [isWhatsAppConnected, setIsWhatsAppConnected] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<'checking' | 'open' | 'connecting' | 'close'>('checking');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Message states
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // File states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  // Tab Filtering & Search
  const [activeFilter, setActiveFilter] = useState<'chatting' | 'waiting' | 'closed' | 'alerts'>('chatting');
  const [searchTerm, setSearchTerm] = useState('');

  // Audio Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Template Modal
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Sidebar controls
  const [newNote, setNewNote] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  // Normalize phone number
  const normalizePhone = (value: string) => {
    let digits = value.replace(/\D/g, '');
    if (!digits) return '';
    if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
    return digits;
  };

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  // Fetch connection status
  async function fetchConnectionStatus() {
    const token = await getToken();
    if (!token) return;

    try {
      const response = await fetch('/api/inbox/evolution/connect', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.success) {
        setIsWhatsAppConnected(payload.connected);
        setWhatsappStatus(payload.state || 'close');
        if (payload.connected) {
          setQrCode(null);
          setConnectError(null);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar status da conexao:', err);
    }
  }

  // Fetch conversations
  async function fetchInbox() {
    if (!profile?.corretor_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams(window.location.search);
    const urlPhone = params.get('telefone') || '';

    const { data } = await supabase
      .from('whatsapp_conversas')
      .select('*')
      .eq('corretor_id', profile.corretor_id)
      .order('ultima_mensagem_at', { ascending: false })
      .limit(80);

    const rows = (data || []).map((row: any) => ({
      ...row,
      agentName: profile.nome || 'Bianca Alves',
      expirationTime: '03/06 às 23:07',
      protocolNumber: `20260529${Math.floor(10000000 + Math.random() * 90000000)}`,
      tags: row.tags || ['Lead Frio'],
      notes: row.notes || [],
      source: row.source || 'Instagram Organico',
      aiActive: row.aiActive ?? false
    })) as Conversation[];

    // Add temp conversation if URL has lead phone and it's not saved
    let matchedConv = null;
    if (urlPhone) {
      const targetPhone = normalizePhone(urlPhone);
      matchedConv = rows.find((r) => normalizePhone(r.telefone) === targetPhone);

      if (!matchedConv) {
        const leadId = params.get('lead');
        let contactName = params.get('nome') ? decodeURIComponent(params.get('nome')!) : 'Novo Contato';

        if (leadId && contactName === 'Novo Contato') {
          const { data: leadData } = await supabase
            .from('leads')
            .select('nome')
            .eq('id', leadId)
            .maybeSingle();
          if (leadData?.nome) {
            contactName = leadData.nome;
          }
        }

        const tempConv: Conversation = {
          id: 'new-' + targetPhone,
          lead_id: leadId || null,
          corretor_id: profile.corretor_id,
          telefone: targetPhone,
          nome_contato: contactName,
          status: 'espera',
          ultima_mensagem_at: new Date().toISOString(),
          agentName: profile.nome || 'Bianca Alves',
          expirationTime: '03/06 às 23:07',
          protocolNumber: `20260529${Math.floor(10000000 + Math.random() * 90000000)}`,
          tags: ['Aguardando'],
          notes: [],
          source: 'Meta Ads',
          aiActive: false
        };
        rows.unshift(tempConv);
        matchedConv = tempConv;
      }
    }

    setConversations(rows);
    setSelectedConversation(matchedConv || rows[0] || null);
    setLoading(false);
    void fetchConnectionStatus();
  }

  useEffect(() => {
    void fetchInbox();
  }, [profile?.corretor_id]);

  useEffect(() => {
    if (!isWhatsAppConnected && (qrCode || whatsappStatus === 'connecting')) {
      const interval = setInterval(() => {
        void fetchConnectionStatus();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isWhatsAppConnected, qrCode, whatsappStatus]);

  // Fetch Messages for Selected Conversation
  async function fetchMessages(conversationId: string) {
    if (conversationId.startsWith('new-')) {
      setMessages([]);
      return;
    }

    const token = await getToken();
    if (!token) return;

    setLoadingMessages(true);
    try {
      const response = await fetch(`/api/inbox/messages?conversation_id=${conversationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      setMessages(response.ok ? (payload.messages || []) : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  }

  useEffect(() => {
    setSendError(null);
    if (selectedConversation?.id) {
      void fetchMessages(selectedConversation.id);
    } else {
      setMessages([]);
    }
  }, [selectedConversation?.id]);

  // Connect WhatsApp
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

    try {
      const response = await fetch('/api/inbox/evolution/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        },
        body: JSON.stringify({
          accepted_terms: acceptedTerms,
          terms_version: 'whatsapp-inbox-v1',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      setConnecting(false);

      if (!response.ok) {
        setConnectError(payload.error || 'Nao consegui gerar o QR Code agora.');
        return;
      }

      setQrCode(payload.qrcode || null);
    } catch (err) {
      console.error(err);
      setConnecting(false);
    }
  }

  // Disconnect WhatsApp
  async function disconnectWhatsApp() {
    setConnecting(true);
    setConnectError(null);
    setQrCode(null);

    const token = await getToken();
    if (!token) {
      setConnectError('Sessao expirada. Entre novamente.');
      setConnecting(false);
      return;
    }

    try {
      const response = await fetch('/api/inbox/evolution/connect', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        },
      });
      setConnecting(false);

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setConnectError(payload.error || 'Nao consegui resetar a conexao.');
        return;
      }

      setIsWhatsAppConnected(false);
      setWhatsappStatus('close');
      alert('Instancia limpa e reiniciada no servidor!');
    } catch (err) {
      console.error(err);
      setConnecting(false);
    }
  }

  // Send message
  async function sendMessage(textOverride?: string, isAudio = false, audioDuration = '') {
    if (!selectedConversation) return;
    const finalMsg = textOverride || messageText.trim();
    if (!finalMsg && !filePreview && !isAudio) return;

    const token = await getToken();
    if (!token) {
      setSendError('Sessao expirada. Entre novamente.');
      return;
    }

    setSendingMessage(true);
    setSendError(null);
    const isNew = selectedConversation.id.startsWith('new-');

    let mediatype = 'document';
    if (selectedFile) {
      if (selectedFile.type.startsWith('image/')) mediatype = 'image';
      else if (selectedFile.type.startsWith('video/')) mediatype = 'video';
      else if (selectedFile.type.startsWith('audio/')) mediatype = 'audio';
    }

    try {
      const response = await fetch('/api/inbox/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversation_id: selectedConversation.id,
          mensagem: isAudio ? '[Áudio Gravado]' : finalMsg,
          ...(isNew ? {
            telefone: selectedConversation.telefone,
            lead_id: selectedConversation.lead_id,
            nome_contato: selectedConversation.nome_contato,
          } : {}),
          ...(filePreview ? {
            media: filePreview,
            mimetype: selectedFile?.type,
            fileName: selectedFile?.name,
            mediatype,
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSendError(payload.error || 'Nao consegui enviar agora.');
        return;
      }

      setMessageText('');
      setSelectedFile(null);
      setFilePreview(null);

      // Local mock append for fast response
      const localMsg: InboxMessage = payload.message || {
        id: `local_${Date.now()}`,
        conversa_id: selectedConversation.id,
        direction: 'outbound',
        remetente: profile?.nome || 'Bianca Alves',
        mensagem: isAudio ? '🎤 Mensagem de voz' : finalMsg,
        created_at: new Date().toISOString(),
        isAudio,
        audioDuration
      };

      setMessages(current => [...current, localMsg]);

      // If AI is active, simulate a response from Apolo AI
      if (selectedConversation.aiActive) {
        setTimeout(() => {
          const aiMsg: InboxMessage = {
            id: `ai_${Date.now()}`,
            conversa_id: selectedConversation.id,
            direction: 'inbound',
            remetente: selectedConversation.nome_contato,
            mensagem: `🤖 *[Apolo Co-Piloto]*: Entendi sua mensagem! Vou simular uma resposta com base nas tabelas de saúde que analisamos no Simulador.`,
            created_at: new Date().toISOString()
          };
          setMessages(current => [...current, aiMsg]);
        }, 1500);
      }

      if (payload.success && payload.conversation) {
        const realConv = payload.conversation as Conversation;
        setSelectedConversation(realConv);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSendingMessage(false);
    }
  }

  // Audio Recording Toggle
  const startRecording = () => {
    setIsRecording(true);
    setRecordSeconds(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordSeconds(prev => prev + 1);
    }, 1000);
  };

  const stopAndSendRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    
    // Formatar segundos
    const mins = Math.floor(recordSeconds / 60).toString().padStart(2, '0');
    const secs = (recordSeconds % 60).toString().padStart(2, '0');
    const durationStr = `${mins}:${secs}`;
    
    void sendMessage(undefined, true, durationStr);
  };

  const cancelRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordSeconds(0);
  };

  // Status conversion toggles
  const handleTogglePause = () => {
    if (!selectedConversation) return;
    const isPaused = selectedConversation.status === 'pausada';
    updateConversationStatus(isPaused ? 'aberta' : 'pausada');
  };

  const handleEndChat = () => {
    updateConversationStatus('fechada');
  };

  const updateConversationStatus = (newStatus: string) => {
    if (!selectedConversation) return;
    const updated = { ...selectedConversation, status: newStatus };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
  };

  const toggleAIActive = () => {
    if (!selectedConversation) return;
    const updated = { ...selectedConversation, aiActive: !selectedConversation.aiActive };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
  };

  // Sidebar notes & tags updates
  const handleAddNote = () => {
    if (!selectedConversation || !newNote.trim()) return;
    const updatedNotes = [...(selectedConversation.notes || []), newNote.trim()];
    const updated = { ...selectedConversation, notes: updatedNotes };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
    setNewNote('');
  };

  const handleAddTag = (tag: string) => {
    if (!selectedConversation || !tag) return;
    if (selectedConversation.tags?.includes(tag)) return;
    const updatedTags = [...(selectedConversation.tags || []), tag];
    const updated = { ...selectedConversation, tags: updatedTags };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
  };

  const handleRemoveTag = (tag: string) => {
    if (!selectedConversation) return;
    const updatedTags = (selectedConversation.tags || []).filter(t => t !== tag);
    const updated = { ...selectedConversation, tags: updatedTags };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
  };

  // Handlers for attachments
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setFilePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  // Tab Filtering logic
  const filteredConversations = conversations.filter((c) => {
    // Search filter
    if (searchTerm) {
      const matchName = c.nome_contato?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchPhone = c.telefone.includes(searchTerm);
      if (!matchName && !matchPhone) return false;
    }

    // Tab filter
    if (activeFilter === 'chatting') return c.status === 'aberta' || c.status === 'pausada';
    if (activeFilter === 'waiting') return c.status === 'espera';
    if (activeFilter === 'closed') return c.status === 'fechada';
    return true; // fallback
  });

  const getFilterCount = (filter: 'chatting' | 'waiting' | 'closed' | 'alerts') => {
    if (filter === 'chatting') return conversations.filter(c => c.status === 'aberta' || c.status === 'pausada').length;
    if (filter === 'waiting') return conversations.filter(c => c.status === 'espera').length;
    if (filter === 'closed') return conversations.filter(c => c.status === 'fechada').length;
    if (filter === 'alerts') return 0;
    return 0;
  };

  const formatHour = (value: string) => {
    try {
      return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const renderAudioWaveform = () => {
    return (
      <div className="flex items-center gap-1">
        <span className="h-3 w-0.5 bg-cyan-400 rounded-full animate-pulse" />
        <span className="h-5 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.1s' }} />
        <span className="h-7 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
        <span className="h-4 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
        <span className="h-6 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
        <span className="h-3 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
        <span className="h-5 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }} />
        <span className="h-2 w-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.7s' }} />
      </div>
    );
  };

  return (
    <InternalLayout>
      <div className="orion-inbox-shell space-y-6 h-[calc(100vh-120px)] flex flex-col">
        
        {/* Connection status header bar if disconnected */}
        {!isWhatsAppConnected && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 animate-in fade-in-50">
            <div className="flex items-center gap-3">
              <QrCode className="text-amber-400 shrink-0" size={20} />
              <div>
                <p className="text-xs font-black text-amber-200 uppercase tracking-wider">WhatsApp Desconectado</p>
                <p className="text-2xs text-slate-400 font-bold mt-0.5">Conecte sua conta para poder enviar mensagens reais diretamente por aqui.</p>
              </div>
            </div>
            <button
              onClick={connectWhatsApp}
              disabled={connecting}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-2xs font-black uppercase text-white shadow-lg shadow-orange-950/20 disabled:opacity-50"
            >
              {connecting ? 'Gerando QR...' : 'Conectar Conta'}
            </button>
          </div>
        )}

        {/* QR Code Scan modal/container if connection is active */}
        {qrCode && (
          <div className="bg-slate-900/90 border border-blue-500/20 rounded-3xl p-6 flex flex-col items-center justify-center text-center shrink-0 animate-in zoom-in-95">
            <QrCode className="text-cyan-400 animate-pulse mb-3" size={32} />
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Escaneie o QR Code no seu Celular</h3>
            <p className="text-2xs text-slate-400 max-w-sm mt-1">Abra o WhatsApp, clique em Dispositivos Conectados e escaneie o código abaixo:</p>
            <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="h-44 w-44 bg-white p-2.5 rounded-2xl object-contain mt-4 shadow-2xl" />
            <button
              onClick={disconnectWhatsApp}
              className="mt-4 px-4 py-2 text-[10px] font-black text-rose-400 uppercase tracking-widest hover:bg-rose-500/10 rounded-xl transition-all"
            >
              Cancelar e Limpar Sessão
            </button>
          </div>
        )}

        {/* MAIN 3-COLUMN LAYOUT PANEL */}
        <div className="orion-inbox-panel flex-1 min-h-0 bg-slate-950/20 border border-white/5 rounded-3xl overflow-hidden shadow-2xl grid grid-cols-1 lg:grid-cols-[320px_1fr_300px]">
          
          {/* COLUMN 1: CONVERSATIONS SIDEBAR */}
          <div className="orion-inbox-list border-r border-white/5 flex flex-col bg-slate-900/20">
            {/* Counts Filter Header */}
            <div className="p-4 border-b border-white/5 space-y-3.5">
              <div className="flex items-center justify-between bg-white/5 p-1 rounded-2xl gap-0.5 shadow-inner">
                {([
                  { filter: 'alerts', icon: AlertTriangle },
                  { filter: 'waiting', icon: Clock },
                  { filter: 'chatting', icon: MessageSquare },
                  { filter: 'closed', icon: Archive }
                ] as const).map((tab) => {
                  const count = getFilterCount(tab.filter);
                  const isActive = activeFilter === tab.filter;
                  return (
                    <button
                      key={tab.filter}
                      onClick={() => setActiveFilter(tab.filter)}
                      className={`relative flex-1 py-2 rounded-xl flex items-center justify-center gap-1 transition-all ${
                        isActive ? 'bg-cyan-600 text-white shadow-md scale-105' : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <tab.icon size={13} />
                      <span className="text-[10px] font-black">{count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Search Box */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-500" size={13} />
                <input
                  type="text"
                  placeholder="Pesquisar conversa..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-950 border border-white/5 rounded-xl pl-9 pr-4 py-2 text-2xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
            </div>

            {/* Conversas list */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/2 max-h-[500px]">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="animate-spin text-cyan-400" size={24} />
                </div>
              ) : filteredConversations.length > 0 ? (
                filteredConversations.map((c) => {
                  const isActive = selectedConversation?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedConversation(c)}
                      className={`w-full flex items-start gap-3 p-4 text-left transition-all ${
                        isActive ? 'bg-cyan-600/10 border-l-4 border-cyan-500' : 'hover:bg-white/2'
                      }`}
                    >
                      {/* Avatar */}
                      <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 border border-white/10 flex items-center justify-center text-xs font-black uppercase text-white shrink-0 shadow-lg">
                        {c.nome_contato?.slice(0, 2) || 'CT'}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs font-black text-white truncate block">{c.nome_contato || c.telefone}</span>
                          <span className="text-[9px] font-bold text-slate-500 shrink-0">
                            {c.ultima_mensagem_at ? formatHour(c.ultima_mensagem_at) : ''}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium truncate leading-tight">
                          {c.id.startsWith('new-') ? 'Inicie a conversa' : 'Ver histórico de atendimento...'}
                        </p>
                        
                        {/* Agent / Brand badge */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <img src="/orion-empty-logo.png" alt="Orion" className="h-3 w-3 object-contain opacity-60" />
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">{c.agentName}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-8 text-center space-y-2">
                  <MessageSquare className="mx-auto text-slate-600" size={24} />
                  <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Sem conversas</p>
                </div>
              )}
            </div>
          </div>

          {/* COLUMN 2: MIDDLE CHAT CONVERSATION WINDOW */}
          <div className="orion-inbox-chat flex flex-col bg-slate-900/10 border-r border-white/5">
            {selectedConversation ? (
              <>
                {/* Header do chat */}
                <div className="orion-inbox-chat-header p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/30 shrink-0">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-black text-white">{selectedConversation.nome_contato || selectedConversation.telefone}</h2>
                      <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[8px] font-black uppercase text-emerald-400 tracking-wider">
                        Expira em {selectedConversation.expirationTime}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold text-slate-500">
                      <span>Nº PROTOCOLO: {selectedConversation.protocolNumber}</span>
                      <span>•</span>
                      <span>Canal: Comercial | {selectedConversation.agentName}</span>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setShowTemplateModal(true)}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-[9px] font-black uppercase tracking-wider text-slate-300 transition-all cursor-pointer"
                    >
                      Template
                    </button>
                    <button
                      onClick={() => alert('Transferência de chat simulada!')}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-[9px] font-black uppercase tracking-wider text-slate-300 transition-all cursor-pointer"
                    >
                      Transferir
                    </button>
                    <button
                      onClick={handleTogglePause}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-[9px] font-black uppercase tracking-wider text-slate-300 transition-all cursor-pointer"
                    >
                      {selectedConversation.status === 'pausada' ? 'Retomar' : 'Pausar'}
                    </button>
                    <button
                      onClick={handleEndChat}
                      className="px-3 py-1.5 rounded-xl border border-rose-500/30 hover:bg-rose-500/10 text-[9px] font-black uppercase tracking-wider text-rose-400 transition-all cursor-pointer"
                    >
                      Encerrar
                    </button>

                    {/* Header Action Icons Toolbar */}
                    <div className="flex items-center gap-1.5 border-l border-white/5 pl-2 ml-1">
                      <button className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Exportar conversa">
                        <Share2 size={13} />
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Pesquisar mensagens">
                        <Search size={13} />
                      </button>
                      <button
                        onClick={toggleAIActive}
                        className={`p-1.5 transition-colors cursor-pointer rounded-lg ${
                          selectedConversation.aiActive 
                            ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20' 
                            : 'text-slate-400 hover:text-white'
                        }`}
                        title="Ativar/Pausar IA Co-Piloto"
                      >
                        <Bot size={13} />
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Bloquear contato">
                        <Ban size={13} />
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Agendar contato">
                        <Calendar size={13} />
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Histórico de chamados">
                        <History size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Mensagens list */}
                <div className="orion-inbox-messages flex-1 overflow-y-auto bg-slate-950/20 p-5 space-y-4 max-h-[420px]">
                  {loadingMessages ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="animate-spin text-cyan-400" size={24} />
                    </div>
                  ) : messages.length > 0 ? (
                    messages.map((message) => {
                      const isMine = message.direction === 'outbound';
                      return (
                        <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} animate-in fade-in-50 duration-200`}>
                          <div className={`max-w-[75%] rounded-[1.5rem] p-3.5 shadow-lg space-y-1.5 ${
                            isMine 
                              ? 'bg-cyan-600 text-white rounded-tr-none' 
                              : 'bg-slate-900 border border-white/5 text-slate-100 rounded-tl-none'
                          }`}>
                            {/* Se for áudio */}
                            {message.isAudio ? (
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                                  <Mic size={14} />
                                </div>
                                <div className="space-y-0.5">
                                  <span className="text-[10px] font-black uppercase tracking-wider block">Mensagem de Voz</span>
                                  <span className="text-[8px] font-bold text-slate-300 block">{message.audioDuration || '00:00'}</span>
                                </div>
                                {renderAudioWaveform()}
                              </div>
                            ) : (
                              <p className="text-xs font-bold leading-normal whitespace-pre-wrap">{message.mensagem}</p>
                            )}
                            <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-wider">
                              <span className={isMine ? 'text-cyan-200' : 'text-slate-500'}>
                                {message.remetente || selectedConversation.nome_contato}
                              </span>
                              <span className={isMine ? 'text-cyan-200' : 'text-slate-500'}>
                                {formatHour(message.created_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-3">
                      <MessageSquare className="text-cyan-400" size={32} />
                      <h3 className="text-xs font-black text-white uppercase tracking-wider">Atendimento Pronto</h3>
                      <p className="text-2xs text-slate-500 font-bold max-w-xs leading-relaxed">
                        Escreva uma mensagem no rodapé para iniciar a comunicação pelo WhatsApp.
                      </p>
                    </div>
                  )}
                </div>

                {/* Rodapé de envio de mensagens */}
                <div className="orion-inbox-composer p-4 border-t border-white/5 bg-slate-900/30 shrink-0">
                  
                  {/* Visualizadores de Anexos */}
                  {filePreview && (
                    <div className="mb-3 flex items-center justify-between rounded-2xl border border-cyan-500/10 bg-cyan-950/20 p-3 shadow-md animate-in fade-in-50">
                      <div className="flex items-center gap-3">
                        {selectedFile?.type.startsWith('image/') ? (
                          <img src={filePreview} alt="Preview" className="h-10 w-10 rounded-xl object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-cyan-400 border border-white/5">
                            <Paperclip size={16} />
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-black text-white truncate max-w-[200px]">{selectedFile?.name}</p>
                          <p className="text-[9px] font-bold text-slate-500 uppercase">
                            {selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(2) + ' MB' : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedFile(null); setFilePreview(null); }}
                        className="p-1 bg-white/5 hover:bg-rose-500/10 hover:text-rose-400 rounded-full text-slate-400 transition-all cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {isRecording ? (
                    /* ESTADO DE GRAVAÇÃO DE ÁUDIO (Estilo Screenshot 4) */
                    <div className="flex items-center justify-between bg-slate-950 border border-cyan-500/20 px-4 py-3 rounded-2xl animate-in slide-in-from-bottom-2 duration-150 shrink-0">
                      <div className="flex items-center gap-3">
                        {/* Timer animado */}
                        <div className="flex items-center gap-2 text-rose-500 font-mono font-black text-xs">
                          <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                          <span>
                            {Math.floor(recordSeconds / 60).toString().padStart(2, '0')}:
                            {(recordSeconds % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                        {/* Waveform animado */}
                        {renderAudioWaveform()}
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={cancelRecording}
                          className="h-9 w-9 bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-xl flex items-center justify-center transition-all cursor-pointer"
                          title="Excluir gravação"
                        >
                          <Trash2 size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={stopAndSendRecording}
                          className="h-9 w-9 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl flex items-center justify-center shadow-lg transition-all cursor-pointer"
                          title="Enviar áudio"
                        >
                          <Check size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ENTRADA DE TEXTO COMUM */
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Media/Tools Icons */}
                      <div className="flex items-center gap-1">
                        <label className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 cursor-pointer flex items-center justify-center shrink-0">
                          <Paperclip size={16} />
                          <input
                            type="file"
                            onChange={handleFileChange}
                            className="hidden"
                            accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => alert('Seletor de Emoji!')}
                          className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 cursor-pointer shrink-0"
                        >
                          <Smile size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowTemplateModal(true)}
                          className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 cursor-pointer shrink-0"
                          title="Mensagens Rápidas"
                        >
                          <FileText size={16} />
                        </button>
                      </div>

                      {/* Text Input */}
                      <textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void sendMessage();
                          }
                        }}
                        rows={1}
                        placeholder='Digite "/" para respostas rápidas ou escreva uma'
                        className="flex-1 bg-slate-950 border border-white/5 rounded-2xl px-4 py-3 text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 resize-none min-h-[44px] max-h-[44px] transition-colors"
                      />

                      {/* Record Mic */}
                      <button
                        type="button"
                        onClick={startRecording}
                        className="p-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl border border-white/5 flex items-center justify-center cursor-pointer shrink-0 transition-all active:scale-95"
                        title="Gravar áudio"
                      >
                        <Mic size={16} />
                      </button>

                      {/* Send Button */}
                      <button
                        onClick={() => sendMessage()}
                        disabled={sendingMessage || (!messageText.trim() && !filePreview)}
                        className="p-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-2xl flex items-center justify-center cursor-pointer shrink-0 shadow-lg shadow-cyan-950/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                      >
                        {sendingMessage ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </button>
                    </div>
                  )}

                  {sendError && (
                    <div className="mt-2 text-2xs font-bold text-rose-400">
                      {sendError}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <MessageSquare className="text-slate-600 mb-3" size={32} />
                <h3 className="text-xs font-black text-white uppercase tracking-wider">Inbox Vazio</h3>
                <p className="text-2xs text-slate-500 mt-1 max-w-xs font-bold">Selecione um contato na barra lateral esquerda para iniciar o atendimento.</p>
              </div>
            )}
          </div>

          {/* COLUMN 3: RIGHT SIDEBAR - LEAD DETAILS PANEL */}
          <div className="orion-inbox-details bg-slate-900/20 flex flex-col p-5 space-y-6 overflow-y-auto">
            {selectedConversation ? (
              <>
                {/* Convert Opportunity Button */}
                <button
                  type="button"
                  onClick={() => alert('Lead convertido em Oportunidade com sucesso!')}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-black uppercase text-white py-3.5 rounded-2xl shadow-xl shadow-cyan-950/20 active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  <Sparkles size={14} />
                  Converter em Oportunidade
                </button>

                {/* Tags manager */}
                <div className="space-y-2 shrink-0">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Etiquetas</label>
                  <select
                    value={selectedTag}
                    onChange={(e) => {
                      handleAddTag(e.target.value);
                      setSelectedTag('');
                    }}
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="">Selecione uma etiqueta...</option>
                    <option value="Lead Quente">Lead Quente 🔥</option>
                    <option value="Aguardando Retorno">Aguardando Retorno ⏳</option>
                    <option value="Sem Interesse">Sem Interesse ❄️</option>
                    <option value="Documentação Enviada">Documentação Enviada 📋</option>
                  </select>

                  {/* Render current tags */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedConversation.tags?.map((t, idx) => (
                      <span
                        key={idx}
                        className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 text-[9px] font-extrabold text-cyan-400 flex items-center gap-1"
                      >
                        {t}
                        <button onClick={() => handleRemoveTag(t)} className="text-[8px] hover:text-white">✕</button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Lead Source */}
                <div className="space-y-2 shrink-0">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Origem do Lead</label>
                  <div className="bg-slate-950 border border-white/5 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Origem Cadastrada</span>
                      <span className="text-xs font-black text-white block mt-0.5">{selectedConversation.source || 'Instagram Organico'}</span>
                    </div>
                    <button
                      onClick={() => alert('Origem removida!')}
                      className="p-1.5 bg-white/5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-xl transition-all cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Internal Notes */}
                <div className="space-y-2 flex-1 flex flex-col min-h-[160px]">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Anotações Internas</label>
                  
                  {/* Notes input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="digitar..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddNote(); }}
                      className="flex-1 bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs text-white focus:outline-none focus:border-cyan-500/50"
                    />
                    <button
                      type="button"
                      onClick={handleAddNote}
                      className="h-8 w-8 bg-cyan-600/20 border border-cyan-500/20 hover:bg-cyan-600 hover:text-white text-cyan-400 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {/* Notes list */}
                  <div className="flex-1 overflow-y-auto bg-slate-950/40 border border-white/5 p-3 rounded-2xl space-y-2 max-h-[140px]">
                    {selectedConversation.notes && selectedConversation.notes.length > 0 ? (
                      selectedConversation.notes.map((note, idx) => (
                        <div key={idx} className="bg-slate-950 p-2.5 rounded-xl border border-white/2 text-[10px] font-bold text-slate-300 leading-normal">
                          {note}
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex items-center justify-center text-center text-[10px] text-slate-500 uppercase tracking-widest font-black py-4">
                        Nenhuma anotação
                      </div>
                    )}
                  </div>
                </div>

                {/* Custom attributes dropdown */}
                <div className="space-y-2 shrink-0">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Campos Personalizados</label>
                  <select
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none"
                    onChange={(e) => alert(`Campo customizado selecionado: ${e.target.value}`)}
                  >
                    <option value="">Selecione...</option>
                    <option value="tipo_saude">Tipo de Plano Pretendido</option>
                    <option value="vidas_cotadas">Número Total de Vidas</option>
                    <option value="faixa_etaria">Faixa Etária Predominante</option>
                  </select>
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-center text-2xs text-slate-500 uppercase tracking-widest font-black">
                Nenhum lead selecionado
              </div>
            )}
          </div>

        </div>

      </div>

      {/* ================= MODAL: SELETOR DE TEMPLATES DE MENSAGEM ================= */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-cyan-400" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">Modelos de Mensagem (Templates)</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Selecione uma resposta rápida pronta</p>
                </div>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="h-9 w-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3.5 max-h-[400px]">
              {TEMPLATES_PADRAO.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => {
                    setMessageText(tmpl.text);
                    setShowTemplateModal(false);
                  }}
                  className="w-full text-left bg-slate-950/50 border border-white/5 hover:border-cyan-500/30 hover:bg-slate-950 p-4 rounded-2xl flex flex-col gap-2 transition-all cursor-pointer"
                >
                  <span className="text-xs font-black text-cyan-400 uppercase tracking-wider">{tmpl.title}</span>
                  <p className="text-2xs text-slate-300 font-bold leading-normal">{tmpl.text}</p>
                </button>
              ))}
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowTemplateModal(false)}
                className="px-5 py-2.5 rounded-xl bg-white/5 text-xs font-bold text-slate-400 hover:bg-white/10 transition-all cursor-pointer"
              >
                Fechar
              </button>
            </div>

          </div>
        </div>
      )}

    </InternalLayout>
  );
}
