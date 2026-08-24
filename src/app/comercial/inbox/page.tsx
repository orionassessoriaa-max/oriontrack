'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Mic,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Square,
  Save,
  Trash2,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { recebeLeadNoRodizio, type CommercialStage } from '@/lib/comercial';

type Conversation = {
  id: string;
  telefone: string;
  nome_contato: string | null;
  status: string | null;
  ultima_mensagem_at: string | null;
  commercial_lead: {
    id: string;
    nome: string;
    telefone: string | null;
    email: string | null;
    empresa: string | null;
    estado: string | null;
    origem: string | null;
    campanha: string | null;
    status: string;
    sdr_id: string | null;
    closer_id: string | null;
    prioridade: string | null;
    vidas: string | null;
    ja_investiu_trafego: string | null;
    faturamento_mensal: string | null;
    investimento: string | null;
    valor_negociacao: number | null;
    data_entrada: string;
    ultimo_contato_at: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
  };
};

type MessageMetadata = Record<string, unknown> & {
  message?: Record<string, unknown>;
};

type Message = {
  id: string;
  direction: 'inbound' | 'outbound';
  remetente?: string | null;
  mensagem: string;
  created_at: string;
  metadata?: MessageMetadata | null;
};

/** O QR da UAZAPI expira perto dos tres minutos; renovamos antes disso. */
const QR_SEGUNDOS = 100;

type ConexaoDoTime = {
  profile_id: string;
  nome: string;
  papel: string;
  telefone_cadastrado: string | null;
  state: 'open' | 'connecting' | 'close';
  numero: string | null;
  perfil_whatsapp: string | null;
};

type WhatsappState = {
  configured: boolean;
  connected: boolean;
  state: 'open' | 'connecting' | 'close';
  numero?: string | null;
  perfil_whatsapp?: string | null;
  equipe?: ConexaoDoTime[] | null;
  targetProfile?: { id?: string; nome?: string | null } | null;
};

/** 556195754328 vira (61) 9575-4328, do jeito que a pessoa reconhece. */
function numeroLegivel(valor?: string | null) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return null;
  const local = digitos.startsWith('55') ? digitos.slice(2) : digitos;
  if (local.length < 10) return digitos;
  const ddd = local.slice(0, 2);
  const resto = local.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

type LeadDraft = {
  nome: string;
  telefone: string;
  email: string;
  empresa: string;
  estado: string;
  faturamento_mensal: string;
  investimento: string;
  prioridade: string;
  vidas: string;
  origem: string;
  campanha: string;
  sdr_id: string;
  closer_id: string;
};

const emptyLeadDraft: LeadDraft = {
  nome: '', telefone: '', email: '', empresa: '', estado: '', faturamento_mensal: '', investimento: '',
  prioridade: '', vidas: '', origem: '', campanha: '', sdr_id: '', closer_id: '',
};

type MessageMediaKind = 'audio' | 'image' | 'video' | 'file' | null;
type MessageMedia = {
  url: string;
  objectUrl: boolean;
  mimeType: string;
  fileName: string;
};

const time = (value?: string | null) => value
  ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  : '';
const normalizePhone = (value: string) => value.replace(/\D/g, '').replace(/^55/, '');
const calendarDay = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
const whatsappDay = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

function isAudioMessage(message: Message) {
  const metadata = message.metadata || {};
  const mime = String(metadata.media_mimetype || metadata.mediaMimeType || metadata.mimetype || '').toLowerCase();
  const mediaType = String(metadata.mediaType || metadata.mediatype || '').toLowerCase();
  return mime.startsWith('audio/') || mediaType === 'ptt' || mediaType === 'audio' || /mensagem de voz|\báudio\b|\baudio\b/i.test(message.mensagem || '');
}

function getMessageMimeType(message: Message) {
  const metadata = message.metadata || {};
  return String(
    metadata.media_mimetype ||
    metadata.mediaMimeType ||
    metadata.mimetype ||
    metadata.mimeType ||
    metadata.message?.mimetype ||
    metadata.message?.mimeType ||
    ''
  ).toLowerCase();
}

function getMessageMediaKind(message: Message): MessageMediaKind {
  if (isAudioMessage(message)) return 'audio';
  const metadata = message.metadata || {};
  const mime = getMessageMimeType(message);
  const type = String(metadata.mediaType || metadata.mediatype || metadata.messageType || metadata.message?.type || '').toLowerCase();
  const text = String(message.mensagem || '').toLowerCase();
  if (mime.startsWith('image/') || type.includes('image') || text.includes('imagem')) return 'image';
  if (mime.startsWith('video/') || type.includes('video') || text.includes('video') || text.includes('vídeo')) return 'video';
  if (mime || type.includes('document') || type.includes('file') || text.includes('arquivo') || text.includes('documento')) return 'file';
  return null;
}

function getMessageFileName(message: Message) {
  const metadata = message.metadata || {};
  return String(
    metadata.media_file_name ||
    metadata.mediaFileName ||
    metadata.fileName ||
    metadata.filename ||
    metadata.message?.fileName ||
    metadata.message?.filename ||
    message.mensagem ||
    'Arquivo recebido'
  ).replace(/[()]/g, '').trim();
}

function base64ToObjectUrl(base64: string, mimeType: string) {
  const clean = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;
  const binary = window.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || 'audio/ogg' }));
}

export default function CommercialInboxPage() {
  const router = useRouter();
  const { api, role, members } = useCommercial();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('todos');
  const [stageFilter, setStageFilter] = useState('todos');
  const [stages, setStages] = useState<CommercialStage[]>([]);
  const [movingStage, setMovingStage] = useState(false);
  const [meetingStage, setMeetingStage] = useState('');
  const [meetingAt, setMeetingAt] = useState('');
  const [negotiationStage, setNegotiationStage] = useState('');
  const [negotiationValue, setNegotiationValue] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [leadPanelExpanded, setLeadPanelExpanded] = useState(false);
  const [editingLead, setEditingLead] = useState(false);
  const [savingLead, setSavingLead] = useState(false);
  const [leadDraft, setLeadDraft] = useState<LeadDraft>(emptyLeadDraft);
  const [qr, setQr] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsappState>({ configured: false, connected: false, state: 'close' });
  const [qrExpiraEm, setQrExpiraEm] = useState(QR_SEGUNDOS);
  const [messageMedia, setMessageMedia] = useState<Record<string, MessageMedia>>({});
  const [loadingMediaId, setLoadingMediaId] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MessageMedia | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const messageMediaRef = useRef<Record<string, MessageMedia>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadWhatsapp = useCallback(async () => {
    try {
      const payload = await api('/api/comercial/inbox/whatsapp');
      setWhatsapp(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível consultar o WhatsApp.');
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [payload, stagePayload] = await Promise.all([
        api('/api/comercial/inbox'),
        api('/api/comercial/stages'),
      ]);
      const next = payload.conversations || [];
      setConversations(next);
      setStages(stagePayload.stages || []);
      const phone = new URLSearchParams(window.location.search).get('telefone');
      if (phone) {
        setSelected(next.find((item: Conversation) => normalizePhone(item.telefone) === normalizePhone(phone)) || null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível carregar o Inbox.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadMessages = useCallback(async (conversation: Conversation) => {
    try {
      const payload = await api(`/api/inbox/messages?conversation_id=${conversation.id}`);
      setMessages(payload.messages || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível carregar as mensagens.');
    }
  }, [api]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void load();
      void loadWhatsapp();
    }, 0);
    // 15s vezes o numero de abas abertas era varredura demais no banco.
    const timer = window.setInterval(() => void loadWhatsapp(), 45000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load, loadWhatsapp]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => void loadMessages(selected), 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages, selected]);

  useEffect(() => {
    const lead = selected?.commercial_lead;
    setLeadPanelExpanded(false);
    setEditingLead(false);
    setLeadDraft(lead ? {
      nome: lead.nome || '',
      telefone: lead.telefone || selected?.telefone || '',
      email: lead.email || '',
      empresa: lead.empresa || '',
      estado: lead.estado || '',
      faturamento_mensal: lead.faturamento_mensal || '',
      investimento: lead.investimento || '',
      prioridade: lead.prioridade || '',
      vidas: lead.vidas || '',
      origem: lead.origem || lead.utm_source || '',
      campanha: lead.campanha || lead.utm_campaign || '',
      sdr_id: lead.sdr_id || '',
      closer_id: lead.closer_id || '',
    } : emptyLeadDraft);
  }, [selected?.commercial_lead.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    messageMediaRef.current = messageMedia;
  }, [messageMedia]);

  useEffect(() => () => {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    Object.values(messageMediaRef.current).forEach((media) => {
      if (media.objectUrl) URL.revokeObjectURL(media.url);
    });
  }, []);

  useEffect(() => {
    if (!mediaPreview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMediaPreview(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mediaPreview]);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.profile_id, member])), [members]);
  const funnelStages = useMemo(() => stages.length
    ? stages.map((stage) => stage.id)
    : Array.from(new Set(conversations.map((item) => item.commercial_lead.status).filter(Boolean))).sort(), [conversations, stages]);
  const filtered = useMemo(() => conversations.filter((item) => {
    const lead = item.commercial_lead;
    const matchesSearch = `${item.nome_contato || ''} ${item.telefone} ${lead.nome} ${lead.status}`.toLowerCase().includes(search.toLowerCase());
    const matchesOwner = ownerFilter === 'todos' || lead.sdr_id === ownerFilter || lead.closer_id === ownerFilter;
    const matchesStage = stageFilter === 'todos' || lead.status === stageFilter;
    return matchesSearch && matchesOwner && matchesStage;
  }), [conversations, ownerFilter, search, stageFilter]);

  function scheduleLeadReturn() {
    if (!selected) return;
    const lead = selected.commercial_lead;
    const params = new URLSearchParams({ novo: '1', lead_id: lead.id });
    const responsibleId = lead.sdr_id || lead.closer_id;
    if (responsibleId) params.set('responsavel_id', responsibleId);
    router.push(`/comercial/tarefas?${params.toString()}`);
  }

  function openLeadHistory() {
    if (!selected) return;
    router.push(`/comercial/historico?lead_id=${encodeURIComponent(selected.commercial_lead.id)}`);
  }

  function cancelLeadEditing() {
    if (!selected) return;
    const lead = selected.commercial_lead;
    setLeadDraft({
      nome: lead.nome || '', telefone: lead.telefone || selected.telefone || '', email: lead.email || '',
      empresa: lead.empresa || '', estado: lead.estado || '', faturamento_mensal: lead.faturamento_mensal || '',
      investimento: lead.investimento || '', prioridade: lead.prioridade || '', vidas: lead.vidas || '',
      origem: lead.origem || lead.utm_source || '', campanha: lead.campanha || lead.utm_campaign || '',
      sdr_id: lead.sdr_id || '', closer_id: lead.closer_id || '',
    });
    setEditingLead(false);
  }

  async function saveLeadDetails() {
    if (!selected || savingLead || !leadDraft.nome.trim()) return;
    setSavingLead(true);
    setNotice('');
    try {
      const { sdr_id, closer_id, ...details } = leadDraft;
      const payload = await api('/api/comercial/leads', {
        method: 'PATCH',
        body: JSON.stringify({
          id: selected.commercial_lead.id,
          ...details,
          ...(role === 'coordenador' ? { sdr_id, closer_id } : {}),
        }),
      });
      const updatedLead = payload.lead || { ...selected.commercial_lead, ...leadDraft };
      setConversations((current) => current.map((conversation) => conversation.commercial_lead.id === updatedLead.id
        ? { ...conversation, nome_contato: updatedLead.nome, telefone: updatedLead.telefone || conversation.telefone, commercial_lead: { ...conversation.commercial_lead, ...updatedLead } }
        : conversation));
      setSelected((current) => current && current.commercial_lead.id === updatedLead.id
        ? { ...current, nome_contato: updatedLead.nome, telefone: updatedLead.telefone || current.telefone, commercial_lead: { ...current.commercial_lead, ...updatedLead } }
        : current);
      setEditingLead(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível salvar os dados do lead.');
    } finally {
      setSavingLead(false);
    }
  }

  function selectLeadStage(status: string) {
    const normalized = status.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (normalized.includes('reunio') && normalized.includes('agend')) {
      setMeetingStage(status);
      setMeetingAt('');
      return;
    }
    if (normalized.trim() === 'em negociacao') {
      setMeetingStage('');
      setNegotiationStage(status);
      setNegotiationValue(Number(selected?.commercial_lead.valor_negociacao || 0) > 0 ? String(selected?.commercial_lead.valor_negociacao) : '');
      return;
    }
    setMeetingStage('');
    void moveSelectedLead(status);
  }

  async function moveSelectedLead(status: string, scheduledAt?: string, negotiationAmount?: number) {
    if (!selected || !status || status === selected.commercial_lead.status || movingStage) return;
    setMovingStage(true);
    setNotice('');
    try {
      const payload = await api('/api/comercial/leads', {
        method: 'PATCH',
        body: JSON.stringify({
          id: selected.commercial_lead.id,
          status,
          ...(scheduledAt ? { reuniao_agendada_at: new Date(scheduledAt).toISOString() } : {}),
          ...(negotiationAmount ? { valor_negociacao: negotiationAmount } : {}),
        }),
      });
      const updatedLead = payload.lead || { ...selected.commercial_lead, status };
      setConversations((current) => current.map((conversation) => conversation.commercial_lead.id === updatedLead.id
        ? { ...conversation, commercial_lead: { ...conversation.commercial_lead, ...updatedLead } }
        : conversation));
      setSelected((current) => current && current.commercial_lead.id === updatedLead.id
        ? { ...current, commercial_lead: { ...current.commercial_lead, ...updatedLead } }
        : current);
      setMeetingStage('');
      setMeetingAt('');
      setNegotiationStage('');
      setNegotiationValue('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível mover o lead de etapa.');
    } finally {
      setMovingStage(false);
    }
  }

  const connectWhatsapp = useCallback(async (silencioso = false) => {
    try {
      const payload = await api('/api/comercial/inbox/whatsapp', {
        method: 'POST',
        body: JSON.stringify({ accepted_terms: true, terms_version: 'commercial-inbox-v1' }),
      });
      setQr(payload.qrcode || null);
      setQrExpiraEm(QR_SEGUNDOS);
      setWhatsapp((current) => ({ ...current, configured: true, state: 'connecting', connected: false }));
      if (!silencioso) setNotice(payload.qrcode ? 'Escaneie o QR Code com o WhatsApp.' : 'Conexão iniciada.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao conectar WhatsApp.');
    }
  }, [api]);

  // O QR da UAZAPI morre em cerca de tres minutos e a tela continuava mostrando
  // o codigo velho: foi o que aconteceu com o Cadu, com "QR Code timeout" no log
  // da central. Aqui o codigo se renova sozinho e o estado e consultado ate
  // conectar, quando o QR some da tela.
  useEffect(() => {
    if (!qr) return;
    const contador = window.setInterval(() => {
      setQrExpiraEm((restante) => {
        if (restante > 1) return restante - 1;
        void connectWhatsapp(true);
        return QR_SEGUNDOS;
      });
    }, 1000);
    const consulta = window.setInterval(() => {
      void api('/api/comercial/inbox/whatsapp')
        .then((payload) => {
          setWhatsapp(payload);
          // Conectou: o QR sai da tela sozinho, sem a pessoa ficar adivinhando.
          if (payload?.state === 'open') {
            setQr(null);
            setNotice('WhatsApp conectado.');
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => { window.clearInterval(contador); window.clearInterval(consulta); };
  }, [api, connectWhatsapp, qr]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setSending(true);
    try {
      await api('/api/inbox/messages', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: selected.id, mensagem: draft.trim() }),
      });
      setDraft('');
      await loadMessages(selected);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }

  async function loadMessageMedia(message: Message, openPreview = false) {
    const cached = messageMedia[message.id];
    if (cached) {
      if (openPreview) setMediaPreview(cached);
      return cached;
    }
    setLoadingMediaId(message.id);
    try {
      const payload = await api(`/api/inbox/messages/media?message_id=${encodeURIComponent(message.id)}`);
      const kind = getMessageMediaKind(message);
      const mimeType = String(payload.mimeType || payload.mimetype || getMessageMimeType(message) || (kind === 'audio' ? 'audio/ogg' : 'application/octet-stream'));
      const media = payload.base64
        ? { url: base64ToObjectUrl(payload.base64, mimeType), objectUrl: true, mimeType, fileName: String(payload.fileName || payload.filename || getMessageFileName(message)) }
        : payload.url
          ? { url: String(payload.url), objectUrl: false, mimeType, fileName: String(payload.fileName || payload.filename || getMessageFileName(message)) }
          : null;
      if (!media) throw new Error('O arquivo desta mensagem não está disponível.');
      setMessageMedia((current) => ({ ...current, [message.id]: media }));
      if (openPreview) setMediaPreview(media);
      return media;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível carregar a mídia.');
      return null;
    } finally {
      setLoadingMediaId(null);
    }
  }

  function stopAudioStream() {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  }

  async function startRecording() {
    if (!selected || sending) return;
    setNotice('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Este navegador não permite gravar áudio. Use Chrome ou Edge atualizado.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const supportedMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.start(250);
      setRecordSeconds(0);
      setIsRecording(true);
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    } catch (error) {
      stopAudioStream();
      setNotice(error instanceof Error ? error.message : 'Não consegui acessar o microfone. Verifique a permissão do navegador.');
    }
  }

  function cancelRecording() {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    setIsRecording(false);
    setRecordSeconds(0);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    stopAudioStream();
  }

  function stopAndSendRecording() {
    const recorder = mediaRecorderRef.current;
    const conversation = selected;
    if (!recorder || recorder.state === 'inactive' || !conversation) return;
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    setIsRecording(false);
    setSending(true);
    const mimeType = recorder.mimeType || 'audio/webm';
    recorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      stopAudioStream();
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      if (!audioBlob.size) {
        setSending(false);
        setNotice('A gravação ficou vazia. Tente novamente e permita o uso do microfone.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await api('/api/inbox/messages', {
            method: 'POST',
            body: JSON.stringify({
              conversation_id: conversation.id,
              media: String(reader.result || ''),
              mimetype: mimeType,
              fileName: `audio-${Date.now()}.${mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'}`,
              mediatype: 'audio',
            }),
          });
          setRecordSeconds(0);
          await loadMessages(conversation);
          await load();
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Não foi possível enviar o áudio.');
        } finally {
          setSending(false);
        }
      };
      reader.onerror = () => {
        setSending(false);
        setNotice('Não foi possível preparar o áudio gravado.');
      };
      reader.readAsDataURL(audioBlob);
    };
    recorder.stop();
  }

  const connectionLabel = !whatsapp.configured
    ? 'WhatsApp não configurado'
    : whatsapp.state === 'open'
      ? 'WhatsApp conectado'
      : whatsapp.state === 'connecting'
        ? 'WhatsApp aguardando conexão'
        : 'WhatsApp desconectado';

  return (
    <div className="kh-commercial-inbox">
      <header className="kh-inbox-toolbar">
        <div className="kh-inbox-title">
          <MessageSquare size={21} />
          <div><h1>Inbox</h1><span>{filtered.length} conversas · {role === 'coordenador' ? 'administrador comercial' : role === 'sdr' ? 'SDR' : 'Closer'}</span></div>
        </div>
        <div className={`kh-whatsapp-status ${whatsapp.state}`}>
          <span className="kh-whatsapp-status-dot" />
          <div>
            <strong>{connectionLabel}</strong>
            <span>
              {whatsapp.state === 'open'
                ? `${whatsapp.perfil_whatsapp || whatsapp.targetProfile?.nome || 'Seu usuário'}${numeroLegivel(whatsapp.numero) ? ` · ${numeroLegivel(whatsapp.numero)}` : ''}`
                : whatsapp.state === 'connecting' ? 'Leia o QR Code para ativar.' : 'Reconecte para enviar mensagens.'}
            </span>
          </div>
          {whatsapp.state === 'open' && <CheckCircle2 size={16} />}
        </div>
        <div className="kh-actions">
          <button className="kh-button" onClick={() => { void load(); void loadWhatsapp(); }}>
            <RefreshCw size={15} className={loading ? 'kh-spin' : ''} /> Atualizar
          </button>
          <button className="kh-button primary" onClick={() => void connectWhatsapp()} disabled={whatsapp.state === 'open'}>
            <Smartphone size={15} /> {whatsapp.state === 'open' ? 'WhatsApp conectado' : 'Conectar meu WhatsApp'}
          </button>
        </div>
      </header>

      {Boolean(whatsapp.equipe?.length) && (
        <details className="kh-inbox-conexoes">
          <summary>
            Conexoes do time
            <b>{(whatsapp.equipe || []).filter((membro) => membro.state === 'open').length}/{(whatsapp.equipe || []).length} conectados</b>
          </summary>
          <div>
            {(whatsapp.equipe || []).map((membro) => {
              const numero = numeroLegivel(membro.numero);
              const cadastrado = numeroLegivel(membro.telefone_cadastrado);
              // Chip diferente do telefone do cadastro costuma ser aparelho de
              // outra pessoa: foi assim que o Leo apareceu com o chip do Renan.
              const divergente = Boolean(numero && cadastrado && numero !== cadastrado);
              return (
                <div key={membro.profile_id} className={membro.state}>
                  <span className="kh-conexao-dot" />
                  <div>
                    <strong>{membro.nome}</strong>
                    <small>{membro.papel}</small>
                  </div>
                  <span className="kh-conexao-numero">
                    {membro.state === 'open' ? (numero || 'sem numero') : membro.state === 'connecting' ? 'lendo QR' : 'desconectado'}
                    {membro.perfil_whatsapp ? ` · ${membro.perfil_whatsapp}` : ''}
                  </span>
                  {divergente && <em title={`Cadastro: ${cadastrado}`}>numero diferente do cadastro</em>}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {notice && <div className="kh-inline-error">{notice}<button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={14} /></button></div>}
      {qr && (
        <div className="kh-panel kh-whatsapp-qr">
          <div>
            <strong>Conecte o WhatsApp</strong>
            <p>Abra o WhatsApp no celular, em Aparelhos conectados, e escaneie o código.</p>
            <p className="kh-qr-timer">Este código expira em {qrExpiraEm}s e se renova sozinho.</p>
            <button type="button" className="kh-button" onClick={() => void connectWhatsapp()}>Gerar outro código</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR Code para conectar WhatsApp" />
          <button className="kh-icon-button" onClick={() => setQr(null)} aria-label="Fechar QR Code"><X size={16} /></button>
        </div>
      )}

      <section className={`kh-inbox-layout ${selected ? 'has-selection' : ''}`}>
        <aside className="kh-panel kh-conversation-list">
          <div className="kh-inbox-list-head"><strong>Conversas</strong><span>{filtered.length}</span></div>
          <label className="kh-inbox-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome ou telefone..." /></label>
          <div className="kh-inbox-filters">
            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="Filtrar conversas por responsável">
              <option value="todos">Todos os responsáveis</option>
              {members.filter((member) => member.ativo && (member.papel === 'sdr' || member.papel === 'closer')).map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}
            </select>
            <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} aria-label="Filtrar conversas por etapa">
              <option value="todos">Todas as etapas</option>
              {funnelStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </div>
          <div className="kh-conversations">
            {filtered.map((conversation) => (
              <button key={conversation.id} className={selected?.id === conversation.id ? 'active' : ''} onClick={() => setSelected(conversation)}>
                <span className="kh-avatar">{(conversation.nome_contato || conversation.commercial_lead.nome).split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                <span className="kh-conversation-copy"><strong>{conversation.nome_contato || conversation.commercial_lead.nome}</strong><small>{conversation.commercial_lead.status}</small><small>SDR: {memberMap.get(conversation.commercial_lead.sdr_id || '')?.nome || 'Sem responsável'}</small></span>
                <time>{time(conversation.ultima_mensagem_at)}</time>
              </button>
            ))}
            {!filtered.length && <div className="kh-inbox-empty">Nenhuma conversa encontrada.</div>}
          </div>
        </aside>

        <main className="kh-panel kh-chat">
          <div className="kh-chat-head">
            {selected ? <><button type="button" className="kh-chat-back" onClick={() => setSelected(null)} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button><div className="kh-avatar">{(selected.nome_contato || selected.commercial_lead.nome).slice(0, 2).toUpperCase()}</div><div><strong>{selected.nome_contato || selected.commercial_lead.nome}</strong><span>{selected.telefone} · {selected.commercial_lead.status}</span></div></> : <><MessageSquare size={22} /><div><strong>Orion WhatsApp</strong><span>Selecione uma conversa para iniciar o atendimento.</span></div></>}
          </div>
          <div className="kh-chat-messages">
            {messages.map((message, index) => {
              const mediaKind = getMessageMediaKind(message);
              const media = messageMedia[message.id];
              const isMediaLoading = loadingMediaId === message.id;
              const isAiSender = ['commercial_sdr', 'commercial_bot'].includes(String(message.metadata?.ai_agent || ''));
              const senderProfileId = String(message.metadata?.sender_profile_id || '');
              const instanceProfileId = String(message.metadata?.instance || '')
                .replace(/^orion_/, '')
                .replace(/[^a-f0-9]/gi, '');
              const instanceMember = instanceProfileId.length === 32
                ? members.find((member) => member.profile_id.replace(/-/g, '').toLowerCase() === instanceProfileId.toLowerCase())
                : null;
              const senderName = isAiSender
                ? 'Orion'
                : String(message.metadata?.sender_name || '').trim()
                  || memberMap.get(senderProfileId)?.nome
                  || instanceMember?.nome
                  || message.remetente?.trim()
                  || (message.direction === 'inbound'
                    ? selected?.nome_contato || selected?.commercial_lead.nome || 'Lead'
                    : 'Equipe comercial');
              const senderLabel = senderName;
              const showDay = index === 0 || calendarDay(messages[index - 1].created_at) !== calendarDay(message.created_at);
              return (
                <Fragment key={message.id}>
                {showDay && <div className="kh-chat-date-separator"><span>{whatsappDay(message.created_at)}</span></div>}
                <div className={`kh-chat-bubble ${message.direction === 'outbound' ? 'outbound' : 'inbound'} ${mediaKind === 'audio' ? 'audio' : ''}`}>
                  {mediaKind === 'audio' ? media ? (
                    <div className="kh-audio-message"><Volume2 size={17} aria-hidden="true" /><audio controls preload="metadata" src={media.url}>Seu navegador não suporta áudio.</audio></div>
                  ) : (
                    <button className="kh-audio-load" type="button" onClick={() => void loadMessageMedia(message)} disabled={isMediaLoading}>
                      {isMediaLoading ? <Loader2 size={16} className="kh-spin" /> : <Volume2 size={16} />} {isMediaLoading ? 'Carregando áudio...' : 'Ouvir mensagem de voz'}
                    </button>
                  ) : mediaKind === 'image' ? media ? (
                    <button type="button" className="kh-inline-image" onClick={() => setMediaPreview(media)} aria-label={`Visualizar ${media.fileName}`}>
                      <img src={media.url} alt={media.fileName} />
                      <span>Ampliar imagem</span>
                    </button>
                  ) : (
                    <button className="kh-media-load" type="button" onClick={() => void loadMessageMedia(message, true)} disabled={isMediaLoading}>
                      {isMediaLoading ? <Loader2 size={16} className="kh-spin" /> : <ImageIcon size={16} />} {isMediaLoading ? 'Carregando imagem...' : 'Visualizar imagem'}
                    </button>
                  ) : mediaKind === 'video' ? media ? (
                    <video controls preload="metadata" src={media.url} className="kh-inline-video" />
                  ) : (
                    <button className="kh-media-load" type="button" onClick={() => void loadMessageMedia(message, true)} disabled={isMediaLoading}>
                      {isMediaLoading ? <Loader2 size={16} className="kh-spin" /> : <Video size={16} />} {isMediaLoading ? 'Carregando vídeo...' : 'Visualizar vídeo'}
                    </button>
                  ) : mediaKind === 'file' ? (
                    <button className="kh-media-load" type="button" onClick={() => void loadMessageMedia(message, true)} disabled={isMediaLoading}>
                      {isMediaLoading ? <Loader2 size={16} className="kh-spin" /> : <FileText size={16} />} {isMediaLoading ? 'Carregando arquivo...' : getMessageFileName(message)}
                    </button>
                  ) : <p>{message.mensagem}</p>}
                  <div className="kh-chat-message-meta">
                    <strong>{senderLabel}</strong>
                    <time>{time(message.created_at)}</time>
                  </div>
                </div>
                </Fragment>
              );
            })}
            {selected && !messages.length && <div className="kh-inbox-empty">Nenhuma mensagem registrada.</div>}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>

          <form className={`kh-chat-compose ${isRecording ? 'recording' : ''}`} onSubmit={sendMessage}>
            {isRecording ? (
              <div className="kh-recording-state">
                <span className="kh-recording-dot" aria-hidden="true" />
                <strong>Gravando {formatDuration(recordSeconds)}</strong>
                <span>Fale sua mensagem e clique em enviar.</span>
              </div>
            ) : (
              <><Paperclip size={17} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={selected ? 'Digite uma mensagem...' : 'Selecione uma conversa'} disabled={!selected || sending} /></>
            )}
            {isRecording ? (
              <>
                <button className="kh-icon-button danger" type="button" onClick={cancelRecording} aria-label="Cancelar gravação"><Trash2 size={17} /></button>
                <button className="kh-icon-button recording-send" type="button" onClick={stopAndSendRecording} aria-label="Parar e enviar áudio"><Square size={15} /><Send size={14} /></button>
              </>
            ) : (
              <>
                <button className="kh-icon-button" type="button" onClick={() => void startRecording()} disabled={!selected || sending} aria-label="Gravar mensagem de voz"><Mic size={17} /></button>
                <button className="kh-icon-button" disabled={!selected || sending || !draft.trim()} aria-label="Enviar mensagem"><Send size={16} /></button>
              </>
            )}
          </form>
        </main>

        <aside className={`kh-panel kh-inbox-lead-panel ${leadPanelExpanded ? 'expanded' : 'collapsed'}`}>
          {selected ? (() => {
            const lead = selected.commercial_lead;
            const sdrName = memberMap.get(lead.sdr_id || '')?.nome || 'Sem SDR';
            const closerName = memberMap.get(lead.closer_id || '')?.nome || 'Sem closer';
            return <>
              <header>
                <button type="button" className="kh-inbox-lead-toggle" onClick={() => setLeadPanelExpanded((current) => !current)} aria-expanded={leadPanelExpanded}>
                  <div><span>Dados do lead</span><h2>{lead.nome}</h2></div><ChevronDown size={17} />
                </button>
                <em>{lead.status}</em>
              </header>
              {leadPanelExpanded && <div className="kh-inbox-lead-content">
              <div className="kh-inbox-lead-edit-actions">
                {editingLead ? <>
                  <button type="button" className="kh-button" onClick={cancelLeadEditing} disabled={savingLead}><X size={14} /> Cancelar</button>
                  <button type="button" className="kh-button primary" onClick={() => void saveLeadDetails()} disabled={savingLead || !leadDraft.nome.trim()}>{savingLead ? <Loader2 size={14} className="kh-spin" /> : <Save size={14} />} Salvar</button>
                </> : <button type="button" className="kh-button" onClick={() => setEditingLead(true)}><Pencil size={14} /> Editar dados</button>}
              </div>
              <label className="kh-inbox-stage-move"><span>Mover para outra etapa</span><select value={negotiationStage || meetingStage || lead.status} onChange={(event) => selectLeadStage(event.target.value)} disabled={movingStage}>{funnelStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
              {meetingStage && <div className="kh-inbox-meeting-move"><label><span>Data e hora da reunião</span><input type="datetime-local" value={meetingAt} onChange={(event) => setMeetingAt(event.target.value)} /></label><div><button type="button" className="kh-button primary" disabled={!meetingAt || movingStage} onClick={() => void moveSelectedLead(meetingStage, meetingAt)}>Confirmar</button><button type="button" className="kh-button" onClick={() => { setMeetingStage(''); setMeetingAt(''); }}>Cancelar</button></div></div>}
              {editingLead ? <div className="kh-inbox-lead-form">
                <label className="wide"><span>Nome</span><input value={leadDraft.nome} onChange={(event) => setLeadDraft((current) => ({ ...current, nome: event.target.value }))} /></label>
                <label><span>Telefone</span><input value={leadDraft.telefone} onChange={(event) => setLeadDraft((current) => ({ ...current, telefone: event.target.value }))} /></label>
                <label><span>E-mail</span><input type="email" value={leadDraft.email} onChange={(event) => setLeadDraft((current) => ({ ...current, email: event.target.value }))} /></label>
                <label><span>Empresa</span><input value={leadDraft.empresa} onChange={(event) => setLeadDraft((current) => ({ ...current, empresa: event.target.value }))} /></label>
                <label><span>Estado</span><input value={leadDraft.estado} onChange={(event) => setLeadDraft((current) => ({ ...current, estado: event.target.value }))} /></label>
                <label><span>Faturamento</span><input value={leadDraft.faturamento_mensal} onChange={(event) => setLeadDraft((current) => ({ ...current, faturamento_mensal: event.target.value }))} /></label>
                <label><span>Investimento</span><input value={leadDraft.investimento} onChange={(event) => setLeadDraft((current) => ({ ...current, investimento: event.target.value }))} /></label>
                <label><span>Prioridade</span><input value={leadDraft.prioridade} onChange={(event) => setLeadDraft((current) => ({ ...current, prioridade: event.target.value }))} /></label>
                <label><span>Vidas</span><input value={leadDraft.vidas} onChange={(event) => setLeadDraft((current) => ({ ...current, vidas: event.target.value }))} /></label>
                <label><span>Origem</span><input value={leadDraft.origem} onChange={(event) => setLeadDraft((current) => ({ ...current, origem: event.target.value }))} /></label>
                <label><span>Campanha</span><input value={leadDraft.campanha} onChange={(event) => setLeadDraft((current) => ({ ...current, campanha: event.target.value }))} /></label>
                {role === 'coordenador' && <>
                  <label><span>SDR</span><select value={leadDraft.sdr_id} onChange={(event) => setLeadDraft((current) => ({ ...current, sdr_id: event.target.value }))}><option value="">Sem SDR</option>{members.filter(recebeLeadNoRodizio).map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}</select></label>
                  <label><span>Closer</span><select value={leadDraft.closer_id} onChange={(event) => setLeadDraft((current) => ({ ...current, closer_id: event.target.value }))}><option value="">Sem closer</option>{members.filter((member) => member.ativo && member.papel === 'closer').map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}</select></label>
                </>}
              </div> : <dl>
                <div><dt>Responsável atual</dt><dd>{lead.sdr_id ? sdrName : closerName}</dd></div>
                <div><dt>SDR</dt><dd>{sdrName}</dd></div>
                <div><dt>Closer</dt><dd>{closerName}</dd></div>
                <div><dt>Telefone</dt><dd>{lead.telefone || selected.telefone || 'Não informado'}</dd></div>
                <div><dt>E-mail</dt><dd>{lead.email || 'Não informado'}</dd></div>
                <div><dt>Empresa</dt><dd>{lead.empresa || 'Não informada'}</dd></div>
                <div><dt>Faturamento</dt><dd>{lead.faturamento_mensal || 'Não informado'}</dd></div>
                <div><dt>Investimento</dt><dd>{lead.investimento || 'Não informado'}</dd></div>
                <div><dt>Prioridade</dt><dd>{lead.prioridade || 'Não informada'}</dd></div>
                <div><dt>Vidas</dt><dd>{lead.vidas || 'Não informado'}</dd></div>
                <div><dt>Origem</dt><dd>{lead.origem || lead.utm_source || 'Não informada'}</dd></div>
                <div><dt>Campanha</dt><dd>{lead.campanha || lead.utm_campaign || 'Não informada'}</dd></div>
              </dl>}
              <div className="kh-inbox-lead-actions">
                <button type="button" className="kh-button primary" onClick={scheduleLeadReturn}><CalendarClock size={15} /> Agendar retorno</button>
                <button type="button" className="kh-button" onClick={openLeadHistory}><ClipboardList size={15} /> Ver histórico</button>
              </div>
              </div>}
            </>;
          })() : <div className="kh-inbox-empty"><ClipboardList size={24} /> Selecione uma conversa para ver os dados do lead.</div>}
        </aside>
      </section>
      {negotiationStage && selected && (
        <div className="kh-modal" role="dialog" aria-modal="true" aria-labelledby="inbox-negotiation-title">
          <button type="button" className="kh-modal-scrim" onClick={() => setNegotiationStage('')} aria-label="Fechar" />
          <form className="kh-modal-sheet kh-meeting-modal" onSubmit={(event) => { event.preventDefault(); void moveSelectedLead(negotiationStage, undefined, Number(negotiationValue)); }}>
            <header><div><span>Etapa comercial</span><h2 id="inbox-negotiation-title">Informar valor da negociação</h2></div><button type="button" onClick={() => setNegotiationStage('')} aria-label="Fechar"><X size={18} /></button></header>
            <div className="kh-meeting-form"><p>Registre o valor estimado antes de mover este lead para negociação.</p><label><span>Valor da negociação *</span><input className="kh-input" type="number" min="0.01" step="0.01" value={negotiationValue} onChange={(event) => setNegotiationValue(event.target.value)} placeholder="0,00" required autoFocus /></label></div>
            <footer><button type="button" className="kh-button" onClick={() => setNegotiationStage('')}>Cancelar</button><button type="submit" className="kh-button primary" disabled={movingStage || Number(negotiationValue) <= 0}>{movingStage ? 'Salvando...' : 'Confirmar negociação'}</button></footer>
          </form>
        </div>
      )}
      {mediaPreview && (
        <div className="kh-media-viewer" role="dialog" aria-modal="true" aria-label={`Visualizar ${mediaPreview.fileName}`}>
          <button type="button" className="kh-media-viewer-scrim" onClick={() => setMediaPreview(null)} aria-label="Fechar visualização" />
          <section className="kh-media-viewer-panel">
            <header>
              <div><strong>{mediaPreview.fileName}</strong><span>Visualização dentro do Inbox</span></div>
              <button type="button" onClick={() => setMediaPreview(null)} aria-label="Fechar visualização"><X size={18} /></button>
            </header>
            <div className="kh-media-viewer-content">
              {mediaPreview.mimeType.startsWith('image/') ? (
                <img src={mediaPreview.url} alt={mediaPreview.fileName} />
              ) : mediaPreview.mimeType.startsWith('video/') ? (
                <video controls autoPlay src={mediaPreview.url} />
              ) : mediaPreview.mimeType.startsWith('audio/') ? (
                <audio controls autoPlay src={mediaPreview.url}>Seu navegador não suporta áudio.</audio>
              ) : (
                <iframe src={mediaPreview.url} title={mediaPreview.fileName} />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
