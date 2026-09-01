'use client';

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { normalizeWhatsAppMessageId } from '@/lib/whatsappMessageId';
import { getLeadStatusStyle, normalizeLeadStatus } from '@/lib/leadStatus';
import { DEFAULT_KANBAN_STAGES, KanbanStage, getKanbanStageLabel, normalizeKanbanStages } from '@/lib/kanbanStages';
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
  ArrowLeft,
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
  Sparkles,
  Settings,
  Play,
  Pause,
  Image as ImageIcon,
  Video,
  Download,
  PhoneCall,
  Phone,
  ChevronDown,
  PanelRight,
  ExternalLink
} from 'lucide-react';

function WhatsAppGlyph({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M16.02 5.33A10.55 10.55 0 0 0 7.1 21.5L5.33 26.67l5.36-1.7A10.55 10.55 0 1 0 16.02 5.33Zm0 2.1a8.45 8.45 0 0 1 7.1 13.04 8.44 8.44 0 0 1-10.82 2.5l-.42-.23-3.16 1 1.04-3.03-.27-.45A8.45 8.45 0 0 1 16.02 7.43Zm-3.58 4.2c-.2 0-.52.07-.8.38-.28.3-1.05 1.03-1.05 2.5 0 1.48 1.08 2.9 1.23 3.1.15.2 2.1 3.35 5.2 4.56 2.58 1.02 3.1.82 3.66.77.56-.05 1.82-.74 2.08-1.46.26-.72.26-1.34.18-1.46-.08-.13-.28-.2-.59-.36-.3-.15-1.82-.9-2.1-1-.28-.1-.49-.15-.7.15-.2.31-.8 1-.98 1.2-.18.21-.36.23-.67.08-.31-.16-1.3-.48-2.47-1.52-.91-.82-1.53-1.82-1.71-2.13-.18-.31-.02-.48.14-.63.14-.14.3-.36.46-.54.15-.18.2-.31.31-.51.1-.2.05-.38-.03-.54-.08-.15-.69-1.67-.95-2.28-.25-.6-.5-.52-.7-.53h-.6Z"
      />
    </svg>
  );
}

type Conversation = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
  telefone: string;
  nome_contato: string | null;
  status: string;
  ultima_mensagem_at: string | null;
  agentName?: string;
  responsibleProfileId?: string | null;
  leadStatus?: string | null;
  expirationTime?: string;
  protocolNumber?: string;
  tags?: string[];
  notes?: string[];
  source?: string;
  aiActive?: boolean;
  hasOpenFollowUp?: boolean;
  customFields?: Array<{ key: string; value: string }>;
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
  provider_message_id?: string | null;
  metadata?: any;
  reactions?: string[];
};

type MessageMediaKind = 'audio' | 'image' | 'video' | 'file' | 'call' | null;
type InlineMediaPreview = {
  url: string;
  mimeType: string;
  fileName: string;
};
type SelectedAttachment = {
  id: string;
  file: File;
  preview: string;
};

type ConversationBox = 'active' | 'followup' | 'closed';

function conversationBelongsToBox(conversation: Conversation, box: ConversationBox) {
  if (box === 'closed') return conversation.status === 'fechada';
  if (box === 'followup') return conversation.status !== 'fechada' && Boolean(conversation.hasOpenFollowUp);
  return conversation.status !== 'fechada';
}

type LeadTask = {
  id: string;
  titulo: string;
  vencimento: string | null;
  prioridade: string | null;
  status: string | null;
  responsavel_profile_id: string | null;
  created_at: string;
};

function isOpenLeadTask(task: Pick<LeadTask, 'status'>) {
  const status = String(task.status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return status !== 'concluida' && status !== 'concluido' && status !== 'cancelada' && status !== 'cancelado';
}

function cleanInboxDisplayName(value?: string | null, fallback = 'Contato') {
  const text = String(value || '').trim();
  if (!text) return fallback;

  const firstField = text.search(/\s+\*?(?:Telefone|Idades?|CNPJ\/MEI|Cidade|Investimento|Plano Atual|Motivo|Hospital\/Regiao|E-?mail|Agendado|Pendente)\*?\s*:/i);
  const cleaned = firstField >= 0 ? text.slice(0, firstField).trim() : text;

  return cleaned || fallback;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Nao consegui ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function readNestedMedia(message: InboxMessage) {
  const metadata = message.metadata || {};
  const roots = [
    metadata.message,
    metadata.data?.message,
    metadata.message?.message,
    metadata.data?.message?.message,
  ];

  for (const root of roots) {
    if (!root) continue;
    const media =
      root.audioMessage ||
      root.imageMessage ||
      root.videoMessage ||
      root.documentMessage ||
      root.stickerMessage;
    if (media) return media;

    const flatType = String(root.type || root.messageType || root.mediaType || '').toLowerCase();
    if (['audio', 'ptt', 'image', 'video', 'document', 'file', 'sticker'].some((type) => flatType.includes(type))) {
      return root.content && typeof root.content === 'object'
        ? { ...root.content, type: root.type, messageType: root.messageType, mediaType: root.mediaType }
        : root;
    }
  }

  return null;
}

function getMessageMimeType(message: InboxMessage) {
  const metadata = message.metadata || {};
  const media = readNestedMedia(message);
  return String(
    media?.mimetype ||
    media?.mimeType ||
    metadata.media_mimetype ||
    metadata.mediaMimeType ||
    metadata.message?.mimetype ||
    metadata.message?.mimeType ||
    metadata.mimetype ||
    metadata.mimeType ||
    metadata.mediaMimeType ||
    metadata.contentType ||
    ''
  ).toLowerCase();
}

function getMessageFileName(message: InboxMessage) {
  const metadata = message.metadata || {};
  const media = readNestedMedia(message);
  const textFileName = String(message.mensagem || '').match(/^(?:\s*📎\s*)?Arquivo\s*\(([^)]+)\)\s*$/i)?.[1];
  return String(
    media?.fileName ||
    media?.filename ||
    metadata.media_file_name ||
    metadata.mediaFileName ||
    metadata.message?.fileName ||
    metadata.message?.filename ||
    metadata.fileName ||
    metadata.filename ||
    textFileName ||
    ''
  ).trim();
}

function getMessageMediaCaption(message: InboxMessage, fileName: string) {
  const metadata = message.metadata || {};
  const media = readNestedMedia(message);
  const metadataCaption = String(media?.caption || metadata.caption || '').trim();
  const messageCaption = String(message.mensagem || '')
    .replace(/^[\s📎📷🎥🎤]+/u, '')
    .replace(/^(?:Arquivo|Imagem|Video|Vídeo|Mensagem de voz)\s*:?\s*/i, '')
    .replace(/^\((.*)\)$/, '$1')
    .trim();

  // A legenda e conteudo da conversa, nao nome do arquivo. Separar os dois
  // evita que textos longos aumentem o cartao e estourem a largura do chat.
  return [metadataCaption, messageCaption].find((caption) => (
    caption
    && caption !== fileName
    && !/^arquivo (recebido|anexado)$/i.test(caption)
  )) || '';
}

function getMessageMediaKind(message: InboxMessage): MessageMediaKind {
  const metadata = message.metadata || {};
  const text = String(message.mensagem || '').toLowerCase();
  const mime = getMessageMimeType(message);
  const messageType = String(
    metadata.messageType ||
    metadata.message?.type ||
    metadata.message?.messageType ||
    metadata.type ||
    metadata.mediaType ||
    metadata.data?.messageType ||
    ''
  ).toLowerCase();

  if (messageType.includes('call') || text.includes('ligacao de voz') || text.includes('ligação de voz')) return 'call';
  if (message.isAudio || mime.startsWith('audio/') || messageType.includes('audio')) return 'audio';
  if (mime.startsWith('image/') || messageType.includes('image') || text.includes('imagem')) return 'image';
  if (mime.startsWith('video/') || messageType.includes('video') || text.includes('video') || text.includes('vã­deo') || text.includes('vídeo')) return 'video';
  if (mime || messageType.includes('document') || messageType.includes('file') || text.includes('arquivo') || text.includes('documento')) return 'file';
  return null;
}

function getReactionTarget(message: InboxMessage) {
  const metadata = message.metadata || {};
  return String(metadata.message?.reaction || metadata.data?.message?.reaction || metadata.reaction || '').replace(/^.*?:/, '');
}

function isReactionMessage(message: InboxMessage) {
  const metadata = message.metadata || {};
  const type = String(metadata.message?.type || metadata.message?.messageType || metadata.messageType || metadata.type || '').toLowerCase();
  return Boolean(getReactionTarget(message)) || type.includes('reaction');
}

function getMessageExternalIds(message: InboxMessage) {
  const metadata = message.metadata || {};
  return [
    message.provider_message_id,
    metadata.message?.messageid,
    metadata.message?.id,
    metadata.data?.message?.messageid,
    metadata.data?.message?.id,
    metadata.messageid,
    metadata.id,
  ].filter(Boolean).flatMap((value) => {
    const id = String(value);
    return [id, normalizeWhatsAppMessageId(id)];
  });
}

function base64ToObjectUrl(base64: string, mimeType: string) {
  const cleanBase64 = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;
  const byteCharacters = atob(cleanBase64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([new Uint8Array(byteNumbers)], { type: mimeType }));
}

const TEMPLATES_PADRAO = [
  { id: '1', title: 'Boas-vindas Comercial', text: 'Ola! Tudo bem? Como posso te ajudar hoje com a cotacao do seu plano de saude?' },
  { id: '2', title: 'Simulação Pronta', text: 'Tudo bem? Sua simulação de planos de saúde já está pronta. Segue o link com as opções detalhadas para você analisar: [Link]' },
  { id: '3', title: 'Cobrança de Documentos', text: 'Para darmos andamento na contratação do seu plano, preciso que me envie os seguintes documentos: RG, CPF e Comprovante de Residência.' },
  { id: '4', title: 'Pesquisa de Satisfação', text: 'O que achou do nosso atendimento hoje? Sua opinião é muito importante para nós!' }
];

const QUICK_EMOJIS = ['😀', '😊', '🙏', '👍', '✅', '🚀', '📌', '📄', '💬', '📲', '💙', '🔥'];

/**
 * Numero que a central devolve vem cru, tipo 557187229444. Quem tem mais de
 * um chip precisa bater o olho e reconhecer qual esta conectado, entao a tela
 * mostra no formato que a pessoa usa no dia a dia.
 */
function formatarNumeroConectado(bruto: string) {
  const digitos = String(bruto || '').replace(/\D/g, '');
  if (digitos.length < 12) return bruto;
  const pais = digitos.slice(0, 2);
  const ddd = digitos.slice(2, 4);
  const resto = digitos.slice(4);
  return `+${pais} (${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

export default function BrokerInboxPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  
  // Connection states
  const [isWhatsAppConnected, setIsWhatsAppConnected] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<'checking' | 'open' | 'connecting' | 'close'>('checking');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [whatsAppOwnerName, setWhatsAppOwnerName] = useState('');
  const [whatsAppNumero, setWhatsAppNumero] = useState('');

  // Message states
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const sendInFlightRef = useRef(false);

  // File states
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedAttachment[]>([]);

  // Conversation filters
  const [searchTerm, setSearchTerm] = useState('');
  const [responsibleFilter, setResponsibleFilter] = useState('todos');
  const [stageFilter, setStageFilter] = useState('todos');
  const [conversationBox, setConversationBox] = useState<ConversationBox>('active');
  const conversationBoxRef = useRef<ConversationBox>('active');

  // Audio Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedConversationRef = useRef<Conversation | null>(null);
  const visibleConversationIdsRef = useRef<Set<string>>(new Set());
  const inboxCorretorIdsRef = useRef<Set<string>>(new Set());
  const inboxSyncInFlightRef = useRef(false);
  const inboxSyncQueuedRef = useRef(false);
  const inboxRefreshTimerRef = useRef<number | null>(null);
  // Ultimo evento vindo do tempo real. Enquanto ele chega, a pesquisa periodica
  // recua e vira so rede de seguranca; se parar de chegar, ela volta a apertar
  // o passo sozinha. Assim a tela nao depende de a publicacao estar ligada nem
  // de a politica de leitura deixar o evento passar.
  const ultimoEventoRealtimeRef = useRef(0);
  const inboxFetchAbortRef = useRef<AbortController | null>(null);
  const messageSyncInFlightRef = useRef(false);
  const messageFetchRequestRef = useRef(0);
  const messageFetchAbortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Audio Playback States
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, { url: string; mimeType: string; fileName?: string }>>({});
  const [loadingMediaId, setLoadingMediaId] = useState<string | null>(null);
  const midiasEmVooRef = useRef<Set<string>>(new Set());
  const [mediaLoadErrors, setMediaLoadErrors] = useState<Record<string, boolean>>({});
  const [mediaPreview, setMediaPreview] = useState<InlineMediaPreview | null>(null);

  // Template Modal
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Sidebar controls
  const [newNote, setNewNote] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  // Custom Fields & CRM Status States
  const [customFieldName, setCustomFieldName] = useState('');
  const [customFieldValue, setCustomFieldValue] = useState('');
  const [leadStatus, setLeadStatus] = useState<string>('Aguardando atendimento');
  const [loadingLead, setLoadingLead] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [leadActivities, setLeadActivities] = useState<any[]>([]);
  const [leadTasks, setLeadTasks] = useState<LeadTask[]>([]);
  const [leadInfo, setLeadInfo] = useState<any>(null);
  const [leadDetailsOpen, setLeadDetailsOpen] = useState(false);
  const [detailsPanelOpen, setDetailsPanelOpen] = useState(false);
  const [kanbanStages, setKanbanStages] = useState<KanbanStage[]>(DEFAULT_KANBAN_STAGES);

  // Apolo Bot & Close Reason Modal States
  const [showBotConfigModal, setShowBotConfigModal] = useState(false);
  const [showCloseReasonModal, setShowCloseReasonModal] = useState(false);
  const [botName, setBotName] = useState('Apolo Bot');
  const [welcomeMessage, setWelcomeMessage] = useState('Ola! Seja bem-vindo. Sou o seu assistente virtual. Como posso te ajudar hoje?');
  const [flowSteps, setFlowSteps] = useState([
    { id: 'step_welcome', label: 'Mensagem Inicial', text: 'Ola! Seja bem-vindo. Sou o seu assistente virtual. Como posso te ajudar hoje?', buttons: ['Fazer uma simulação', 'Falar com atendente', 'Outros assuntos'] },
    { id: 'step_simulate', label: 'Simulação Selecionada', text: 'Excelente! Para fazermos a cotação ideal para você, quais idades serão incluídas no plano?', buttons: ['Apenas eu', 'Eu e minha família', 'Minha empresa'] },
    { id: 'step_agent', label: 'Falar com Atendente', text: 'Perfeito. Estou repassando sua conversa para um de nossos especialistas. Aguarde um minutinho!', buttons: [] },
    { id: 'step_others', label: 'Outros Assuntos', text: 'Por favor, descreva em uma mensagem o que você precisa para que possamos te direcionar melhor.', buttons: [] }
  ]);
  const [selectedFlowStepId, setSelectedFlowStepId] = useState('step_welcome');
  const [closeReason, setCloseReason] = useState('');
  const [closingConversation, setClosingConversation] = useState(false);

  // Kept internally for backward compatibility; these legacy tools are no
  // longer exposed in the operational Inbox.
  const [showSearchChat, setShowSearchChat] = useState(false);
  const [searchChatQuery, setSearchChatQuery] = useState('');

  // Task scheduling states
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskDueTime, setTaskDueTime] = useState('09:00');
  const [taskPriority, setTaskPriority] = useState('normal');
  const [taskResponsibleProfileId, setTaskResponsibleProfileId] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState(false);

  // History states
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyActivities, setHistoryActivities] = useState<any[]>([]);
  const [historyConversations, setHistoryConversations] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Team forwarding states
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const teamMemberByProfileId = new Map(
    teamMembers
      .filter((member) => member.profile_id)
      .map((member) => [String(member.profile_id), member])
  );
  const canManageTaskResponsible = ['admin', 'dev', 'corretor_admin'].includes(profile?.tipo_usuario || '');
  const taskResponsibleOptions = teamMembers.filter((member) => member.profile_id);

  // Load configuration from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('orion:apolo_bot_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.botName) setBotName(parsed.botName);
        if (parsed.flowSteps) setFlowSteps(parsed.flowSteps);
      } catch (err) {
        console.error('Erro ao carregar configuracao do bot:', err);
      }
    }
  }, []);

  // Normalize phone number
  const normalizePhone = (value: string) => {
    let digits = value.replace(/\D/g, '');
    if (!digits) return '';
    if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
    return digits;
  };

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const expiresSoon = session?.expires_at
      ? session.expires_at * 1000 <= Date.now() + 60_000
      : false;

    if (session?.access_token && !expiresSoon) {
      return session.access_token;
    }

    const refreshed = await supabase.auth.refreshSession();
    return refreshed.data.session?.access_token || session?.access_token || '';
  }

  // Fetch connection status
  async function fetchConnectionStatus() {
    const token = await getToken();
    if (!token) return;

    try {
      const response = await fetch('/api/inbox/uazapi/connect', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.success) {
        setIsWhatsAppConnected(payload.connected);
        setWhatsappStatus(payload.state || 'close');
        setWhatsAppOwnerName(payload.targetProfile?.nome || profile?.nome || '');
        setWhatsAppNumero(String(payload.numero || ''));
        if (payload.connected) {
          setQrCode(null);
          setConnectError(null);
        } else if (typeof payload.qrcode === 'string' && payload.qrcode) {
          setQrCode(payload.qrcode);
          setConnectError(null);
        } else if (payload.state === 'close') {
          setQrCode(null);
          const disconnectReason = String(payload.disconnectReason || '').toLowerCase();
          setConnectError(
            disconnectReason.includes('logged out from another device')
              ? 'A sessao foi encerrada por outro aparelho. Conecte novamente pelo QR Code e confira os aparelhos conectados no WhatsApp.'
              : null
          );
        }
      }
    } catch (err) {
      console.error('Erro ao buscar status da conexao:', err);
    }
  }

  // Fetch team members for lead forwarding
  async function fetchTeamMembers() {
    const targetCorretorId = profile?.corretor_id || selectedConversation?.corretor_id;
    if (!targetCorretorId) return;

    const token = await getToken();
    if (!token) return;

    try {
      const response = await fetch(`/api/corretor/times?corretor_id=${encodeURIComponent(targetCorretorId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setTeamMembers(payload.membros || []);
      }
    } catch (err) {
      console.error('Erro ao buscar integrantes do time:', err);
    }
  }


  // Fetch conversations
  async function fetchInbox(isSilent = false) {
    if (!profile?.corretor_id) {
      setLoading(false);
      return;
    }

    if (inboxSyncInFlightRef.current) {
      inboxSyncQueuedRef.current = true;
      return;
    }
    inboxSyncInFlightRef.current = true;
    inboxSyncQueuedRef.current = false;
    inboxFetchAbortRef.current?.abort();
    const controller = new AbortController();
    inboxFetchAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000);

    try {
      if (!isSilent) {
        setLoading(true);
        setInboxError(null);
      }
    const params = new URLSearchParams(window.location.search);
    const urlPhone = params.get('telefone') || '';

    let idsToFetch = [profile.corretor_id];
    const isTeamMember = profile.tipo_usuario === 'corretor_membro';
    let assignedLeadIds: string[] = [];
    const data: any[] = [];
    let followUpLoadedByApi = false;

    if (isTeamMember) {
      // Integrantes continuam sujeitos ao filtro exclusivo do proprio lead.
      const conversationPageSize = 500;
      for (let from = 0; ; from += conversationPageSize) {
        let conversationsQuery = supabase
          .from('whatsapp_conversas')
          .select('*,leads!inner(id,nome,status,responsavel_profile_id,responsavel_membro:responsavel_membro_id(id,nome))')
          .order('ultima_mensagem_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, from + conversationPageSize - 1)
          .in('corretor_id', idsToFetch);

        conversationsQuery = conversationsQuery.or(`responsavel_profile_id.eq.${profile.id},responsavel_profile_id.is.null`, { referencedTable: 'leads' });

        const { data: page, error } = await conversationsQuery;
        if (error) throw error;
        data.push(...(page || []));
        if (!page || page.length < conversationPageSize) break;
      }
    } else {
      // A listagem passa pelo backend para respeitar a conta visualizada pelo
      // admin e nao depender das politicas RLS da sessao original do navegador.
      const token = await getToken();
      if (!token) throw new Error('Sessao expirada. Entre novamente.');

      const response = await fetch('/api/inbox/conversations', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'x-orion-view-profile-id': profile.id,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Nao foi possivel carregar as conversas.');
      }

      idsToFetch = Array.isArray(payload.corretorIds) && payload.corretorIds.length
        ? payload.corretorIds.map(String)
        : idsToFetch;
      assignedLeadIds = Array.isArray(payload.assignedLeadIds)
        ? payload.assignedLeadIds.map(String)
        : [];
      data.push(...(Array.isArray(payload.conversations) ? payload.conversations : []));
      followUpLoadedByApi = true;
    }
    inboxCorretorIdsRef.current = new Set(idsToFetch);

    const rows = (data || []).map((row: any) => {
      const lead = row.leads as any;
      const responsibleProfileId = lead?.responsavel_profile_id || null;
      const member = responsibleProfileId ? teamMemberByProfileId.get(String(responsibleProfileId)) : null;

      return {
        ...row,
        status: row.status === 'aguardando' ? 'espera' : row.status === 'resolvida' ? 'fechada' : row.status,
        agentName: lead?.responsavel_membro?.nome || member?.nome || (responsibleProfileId && responsibleProfileId === profile?.id ? profile?.nome : null) || 'Fila Geral',
        responsibleProfileId,
        leadStatus: lead?.status || null,
        expirationTime: '03/06 às 23:07',
        protocolNumber: `20260529${Math.floor(10000000 + Math.random() * 90000000)}`,
        tags: row.tags || ['Lead Frio'],
        notes: row.notes || [],
        source: 'Meta',
        aiActive: row.aiActive ?? false,
        customFields: row.customFields || []
      };
    }) as Conversation[];

    // Add temp conversation if URL has lead phone and it's not saved
    let matchedConv = null;
    if (urlPhone) {
      const targetPhone = normalizePhone(urlPhone);
      matchedConv = rows.find((r) => normalizePhone(r.telefone) === targetPhone);

      if (!matchedConv) {
        // The inbox list is intentionally limited. When a lead is opened
        // directly by URL, recover its persisted conversation before using
        // a temporary empty conversation.
        const targetDigits = targetPhone.replace(/\D/g, '');
        const targetLast8 = targetDigits.length >= 8 ? targetDigits.slice(-8) : targetDigits;
        let savedConversationQuery = supabase
          .from('whatsapp_conversas')
          .select(`*, ${isTeamMember ? 'leads!inner' : 'leads'}(id, nome, status, responsavel_profile_id, responsavel_membro:responsavel_membro_id(id, nome))`)
          .or(`telefone.eq.${targetPhone},telefone.ilike.%${targetLast8}`)
          .order('ultima_mensagem_at', { ascending: false })
          .limit(1);

        if (assignedLeadIds.length > 0) {
          savedConversationQuery = savedConversationQuery.or(
            `corretor_id.in.(${idsToFetch.join(',')}),lead_id.in.(${assignedLeadIds.join(',')})`
          );
        } else {
          savedConversationQuery = savedConversationQuery.in('corretor_id', idsToFetch);
        }

        if (isTeamMember) {
          savedConversationQuery = savedConversationQuery.or(`responsavel_profile_id.eq.${profile.id},responsavel_profile_id.is.null`, { referencedTable: 'leads' });
        }

        const { data: savedConversations } = await savedConversationQuery;
        const savedRow = savedConversations?.[0] as any;
        if (savedRow) {
          const savedLead = savedRow.leads as any;
          const savedResponsibleProfileId = savedLead?.responsavel_profile_id || null;
          const savedMember = savedResponsibleProfileId ? teamMemberByProfileId.get(String(savedResponsibleProfileId)) : null;
          matchedConv = {
            ...savedRow,
            status: savedRow.status === 'aguardando' ? 'espera' : savedRow.status === 'resolvida' ? 'fechada' : savedRow.status,
            agentName: savedLead?.responsavel_membro?.nome || savedMember?.nome || (savedResponsibleProfileId && savedResponsibleProfileId === profile?.id ? profile?.nome : null) || 'Fila Geral',
            responsibleProfileId: savedResponsibleProfileId,
            leadStatus: savedLead?.status || null,
            expirationTime: '03/06 Ã s 23:07',
            protocolNumber: `20260529${Math.floor(10000000 + Math.random() * 90000000)}`,
            tags: savedRow.tags || ['Lead Frio'],
            notes: savedRow.notes || [],
            source: 'Meta',
            aiActive: savedRow.aiActive ?? false,
            customFields: savedRow.customFields || [],
          } as Conversation;
          rows.unshift(matchedConv);
        }

        if (!matchedConv) {
        const leadId = params.get('lead');
        let contactName = params.get('nome') ? decodeURIComponent(params.get('nome')!) : 'Novo Contato';

        if (leadId && contactName === 'Novo Contato') {
          const { data: leadData } = await supabase
            .from('leads')
            .select('nome,responsavel_profile_id')
            .eq('id', leadId)
            .maybeSingle();
          if (isTeamMember && leadData?.responsavel_profile_id && leadData.responsavel_profile_id !== profile.id) {
            setConversations(rows);
            setSelectedConversation(rows[0] || null);
            setLoading(false);
            if (!isSilent) void fetchConnectionStatus();
            return;
          }
          if (leadData?.nome) {
            contactName = leadData.nome;
          }
        }

        const tempConv: Conversation = {
          id: 'new-' + targetPhone,
          lead_id: leadId || null,
          corretor_id: profile?.corretor_id || null,
          telefone: targetPhone,
          nome_contato: contactName,
          status: 'espera',
          ultima_mensagem_at: new Date().toISOString(),
          agentName: profile?.nome || 'Bianca Alves',
          expirationTime: '03/06 às 23:07',
          protocolNumber: `20260529${Math.floor(10000000 + Math.random() * 90000000)}`,
          tags: ['Aguardando'],
          notes: [],
          source: 'Meta Ads',
          aiActive: false,
          customFields: []
        };
        rows.unshift(tempConv);
        matchedConv = tempConv;
        }
      }
    }

    let rowsWithFollowUp = rows;
    if (!followUpLoadedByApi) {
      const leadIds = Array.from(new Set(rows.map((row) => row.lead_id).filter(Boolean))) as string[];
      const followUpLeadIds = new Set<string>();
      const followUpBatchSize = 200;
      for (let from = 0; from < leadIds.length; from += followUpBatchSize) {
        const batch = leadIds.slice(from, from + followUpBatchSize);
        const { data: openTasks, error: openTasksError } = await supabase
          .from('lead_tarefas')
          .select('lead_id')
          .in('lead_id', batch)
          .eq('status', 'pendente');
        if (openTasksError) throw openTasksError;
        (openTasks || []).forEach((task) => {
          if (task.lead_id) followUpLeadIds.add(String(task.lead_id));
        });
      }

      rowsWithFollowUp = rows.map((row) => ({
        ...row,
        hasOpenFollowUp: Boolean(row.lead_id && followUpLeadIds.has(String(row.lead_id))),
      }));
    }

    setConversations(rowsWithFollowUp);
    setInboxError(null);
    const previousSelection = selectedConversationRef.current;
    const currentBox = conversationBoxRef.current;
    const rowsInCurrentBox = rowsWithFollowUp.filter((row) => conversationBelongsToBox(row, currentBox));
    const matchedConversationInCurrentBox = matchedConv
      ? rowsInCurrentBox.find((row) => row.id === matchedConv.id) || null
      : null;
    const nextSelection = previousSelection
      ? rowsInCurrentBox.find((row) => row.id === previousSelection.id) || matchedConversationInCurrentBox || rowsInCurrentBox[0] || null
      : matchedConversationInCurrentBox || rowsInCurrentBox[0] || null;
    // O carregamento das mensagens pode terminar antes do React executar o
    // efeito que atualiza a ref. Grave a selecao imediatamente para o
    // historico sincronizado do celular nao ser descartado como conversa antiga.
    selectedConversationRef.current = nextSelection;
    setSelectedConversation(nextSelection);
    setLoading(false);
    if (!isSilent) void fetchConnectionStatus();
    } catch (error) {
      console.error('Erro ao atualizar o Inbox:', error);
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'O Inbox demorou para responder. Tente carregar novamente.'
        : error instanceof Error
          ? error.message
          : 'Nao foi possivel carregar as conversas.';
      setInboxError(message);
      if (!isSilent) setLoading(false);
    } finally {
      window.clearTimeout(timeoutId);
      if (inboxFetchAbortRef.current === controller) {
        inboxFetchAbortRef.current = null;
      }
      inboxSyncInFlightRef.current = false;
      if (inboxSyncQueuedRef.current && document.visibilityState === 'visible') {
        inboxSyncQueuedRef.current = false;
        window.setTimeout(() => void fetchInbox(true), 250);
      }
    }
  }

  function tempoRealAtivo() {
    return Date.now() - ultimoEventoRealtimeRef.current < 120_000;
  }

  function scheduleInboxRefresh(delay = 750) {
    if (document.visibilityState !== 'visible') return;
    if (inboxRefreshTimerRef.current) window.clearTimeout(inboxRefreshTimerRef.current);
    inboxRefreshTimerRef.current = window.setTimeout(() => {
      inboxRefreshTimerRef.current = null;
      void fetchInbox(true);
    }, delay);
  }

  useEffect(() => {
    void fetchInbox();
    if (profile?.tipo_usuario !== 'corretor_membro') {
      void fetchTeamMembers();
    }
  }, [profile?.id, profile?.corretor_id, profile?.nome_empresa]);

  useEffect(() => () => {
    inboxFetchAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const intervalTime = isWhatsAppConnected ? 30000 : 10000;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchConnectionStatus();
    }, intervalTime);

    return () => clearInterval(interval);
  }, [isWhatsAppConnected, qrCode, whatsappStatus, profile?.id]);

  // Fetch team members when forwarding modal opens
  useEffect(() => {
    if (showForwardModal) {
      void fetchTeamMembers();
    }
  }, [showForwardModal]);

  useEffect(() => {
    if (!mediaPreview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMediaPreview(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mediaPreview]);

  // Maintain selectedConversationRef pointing to current selected conversation
  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    conversationBoxRef.current = conversationBox;
  }, [conversationBox]);

  useEffect(() => {
    if (!selectedConversation) return;
    const belongsToCurrentBox = conversationBelongsToBox(selectedConversation, conversationBox);
    if (!belongsToCurrentBox) {
      setSelectedConversation(null);
      setMessages([]);
    }
  }, [conversationBox, selectedConversation]);

  // Setup Supabase Realtime subscription for messages and conversation events
  useEffect(() => {
    if (!profile?.corretor_id) return;

    const channel = supabase
      .channel('realtime:inbox_sync')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_mensagens' },
        (payload) => {
          ultimoEventoRealtimeRef.current = Date.now();
          if (document.visibilityState !== 'visible') return;
          const newMsg = payload.new as InboxMessage;
          // A linha com status "sending" e apenas a reserva idempotente do
          // servidor. Ela ainda nao foi confirmada pelo WhatsApp e nao deve
          // aparecer por um instante para depois sumir quando o envio falhar.
          if (newMsg.direction === 'outbound' && newMsg.metadata?.send_status === 'sending') return;
          const currentSelected = selectedConversationRef.current;
          const belongsToVisibleInbox = visibleConversationIdsRef.current.has(newMsg.conversa_id);

          // O historico exibido pode unir mais de uma conversa do mesmo numero.
          // Atualize em tempo real qualquer parte dessa timeline unificada.
          if (currentSelected && belongsToVisibleInbox) {
            const isAudio = 
              newMsg.mensagem?.includes('[Áudio Gravado]') || 
              newMsg.mensagem?.includes('🎤 Mensagem de voz') || 
              newMsg.mensagem?.includes('🎵 Áudio') || 
              String(newMsg.metadata?.media_mimetype || '').toLowerCase().startsWith('audio/') ||
              Boolean(newMsg.metadata?.message?.audioMessage || newMsg.metadata?.audioMessage || newMsg.metadata?.data?.message?.audioMessage);
            const mappedMsg = {
              ...newMsg,
              isAudio,
            };
            setMessages((prev) => {
              if (prev.some((m) => m.id === mappedMsg.id)) {
                return prev;
              }
              const mappedProviderId = normalizeWhatsAppMessageId(mappedMsg.provider_message_id);
              if (mappedProviderId && prev.some((message) => (
                normalizeWhatsAppMessageId(message.provider_message_id) === mappedProviderId
              ))) {
                return prev;
              }
              const newMessageTime = mappedMsg.created_at ? new Date(mappedMsg.created_at).getTime() : Date.now();
              const hasRecentDuplicate = prev.some((m) => {
                const oldMessageTime = m.created_at ? new Date(m.created_at).getTime() : 0;
                return m.conversa_id === mappedMsg.conversa_id
                  && m.direction === mappedMsg.direction
                  && String(m.remetente || '') === String(mappedMsg.remetente || '')
                  && String(m.mensagem || '').trim() === String(mappedMsg.mensagem || '').trim()
                  && Math.abs(newMessageTime - oldMessageTime) <= 30_000;
              });
              if (hasRecentDuplicate) {
                return prev;
              }
              return [...prev, mappedMsg];
            });
          }

          // Trigger a silent inbox refresh to update the sidebar order/preview
          if (belongsToVisibleInbox) scheduleInboxRefresh();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_conversas' },
        (payload) => {
          ultimoEventoRealtimeRef.current = Date.now();
          // Trigger a silent inbox refresh to update the sidebar when any conversation changes
          const changedConversation = (payload.new || payload.old) as { corretor_id?: string | null };
          if (changedConversation.corretor_id && inboxCorretorIdsRef.current.has(changedConversation.corretor_id)) {
            scheduleInboxRefresh();
          }
        }
      )
      .subscribe();

    return () => {
      if (inboxRefreshTimerRef.current) {
        window.clearTimeout(inboxRefreshTimerRef.current);
        inboxRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [profile?.corretor_id]);

  // Scroll to bottom when messages list changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize composer height
  useEffect(() => {
    const textarea = composerRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const isClaro = typeof document !== 'undefined' && (
        document.documentElement.classList.contains('theme-claro') ||
        document.body.classList.contains('theme-claro') ||
        document.querySelector('.theme-claro') !== null
      );
      const minHeight = isClaro ? 38 : 44;
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(Math.max(scrollHeight, minHeight), 160)}px`;
    }
  }, [messageText]);


  // Fetch Messages for Selected Conversation
  async function fetchMessages(conversationId: string, options: { silent?: boolean } = {}) {
    const requestedConversation = selectedConversationRef.current?.id === conversationId
      ? selectedConversationRef.current
      : null;
    const isNewConversation = conversationId.startsWith('new-');

    if (options.silent && messageSyncInFlightRef.current) return;

    let token = '';
    try {
      token = await getToken();
    } catch (error) {
      console.error('Erro ao recuperar a sessao do Inbox:', error);
    }
    if (!token) {
      if (!options.silent) {
        setLoadingMessages(false);
        setSendError('Sua sessao expirou. Entre novamente para abrir as mensagens.');
      }
      return;
    }

    if (!options.silent) {
      messageFetchAbortRef.current?.abort();
    }
    const controller = new AbortController();
    messageFetchAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
    const requestId = ++messageFetchRequestRef.current;
    messageSyncInFlightRef.current = true;
    if (!options.silent) {
      setMessages([]);
      setLoadingMessages(true);
    }
    try {
      const query = new URLSearchParams({ conversation_id: conversationId });
      if (isNewConversation && requestedConversation) {
        query.set('telefone', requestedConversation.telefone);
        if (requestedConversation.lead_id) query.set('lead_id', requestedConversation.lead_id);
        if (requestedConversation.nome_contato) query.set('nome_contato', requestedConversation.nome_contato);
      }
      const response = await fetch(`/api/inbox/messages?${query.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { 
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      const mapped = (payload.messages || []).map((m: any) => {
        const isAudio = 
          m.mensagem?.includes('[Áudio Gravado]') || 
          m.mensagem?.includes('🎤 Mensagem de voz') || 
          m.mensagem?.includes('🎵 Áudio') || 
          String(m.metadata?.media_mimetype || '').toLowerCase().startsWith('audio/') ||
          Boolean(m.metadata?.message?.audioMessage || m.metadata?.audioMessage || m.metadata?.data?.message?.audioMessage);
        return {
          ...m,
          isAudio,
        };
      });
      if (!response.ok) {
        const errorMessage = typeof payload.error === 'string' ? payload.error : 'Nao foi possivel carregar o historico desta conversa.';
        if (!options.silent) setSendError(errorMessage);
        return;
      }
      const currentConversationId = selectedConversationRef.current?.id;
      if (currentConversationId !== conversationId && currentConversationId !== payload.conversation?.id) return;

      if (isNewConversation && payload.conversation) {
        const resolvedConversation = {
          ...(requestedConversation || {}),
          ...payload.conversation,
          status: payload.conversation.status === 'aguardando'
            ? 'espera'
            : payload.conversation.status === 'resolvida'
              ? 'fechada'
              : payload.conversation.status,
        } as Conversation;
        selectedConversationRef.current = resolvedConversation;
        setSelectedConversation(resolvedConversation);
        setConversations((current) => {
          let replaced = false;
          const next = current
            .filter((item) => item.id !== resolvedConversation.id || item.id === conversationId)
            .map((item) => {
              if (item.id !== conversationId) return item;
              replaced = true;
              return resolvedConversation;
            });
          return replaced ? next : [resolvedConversation, ...next];
        });
      }
      visibleConversationIdsRef.current = new Set(
        Array.isArray(payload.conversation_ids)
          ? payload.conversation_ids.map(String)
          : [conversationId, ...mapped.map((message: InboxMessage) => String(message.conversa_id))],
      );
      setMessages((current) => {
        const unchanged = current.length === mapped.length && current.every((message, index) => {
          const nextMessage = mapped[index];
          return message.id === nextMessage?.id
            && message.mensagem === nextMessage?.mensagem
            && message.direction === nextMessage?.direction
            && message.created_at === nextMessage?.created_at;
        });
        return unchanged ? current : mapped;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (!options.silent && requestId === messageFetchRequestRef.current) {
          setSendError('O historico demorou para responder. Selecione a conversa novamente para tentar outra vez.');
        }
      } else {
        console.error(err);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (messageFetchAbortRef.current === controller) {
        messageFetchAbortRef.current = null;
      }
      if (requestId === messageFetchRequestRef.current) {
        messageSyncInFlightRef.current = false;
        if (!options.silent) setLoadingMessages(false);
      }
    }
  }

  useEffect(() => {
    setSendError(null);
    setLeadDetailsOpen(true);
    setDetailsPanelOpen(false);
    if (selectedConversation?.id) {
      void fetchMessages(selectedConversation.id);
    } else {
      messageFetchAbortRef.current?.abort();
      setMessages([]);
      setLoadingMessages(false);
    }
  }, [selectedConversation?.id]);

  useEffect(() => () => {
    messageFetchAbortRef.current?.abort();
  }, []);

  // O Realtime continua sendo o caminho principal. Mensagens digitadas no
  // celular nem sempre geram webhook no provedor, por isso a conversa aberta
  // reconcilia o historico em uma janela curta, sem exigir F5.
  useEffect(() => {
    const conversationId = selectedConversation?.id;
    if (!conversationId || conversationId.startsWith('new-')) return;

    let timer: number | null = null;
    const syncOpenConversation = () => {
      if (document.visibilityState === 'visible') {
        void fetchMessages(conversationId, { silent: true });
      }
      timer = window.setTimeout(syncOpenConversation, tempoRealAtivo() ? 45_000 : 8_000);
    };
    timer = window.setTimeout(syncOpenConversation, tempoRealAtivo() ? 45_000 : 8_000);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [selectedConversation?.id, profile?.id]);

  // Atualiza a ordem e a previa das conversas separadamente. Assim uma
  // mensagem recuperada do celular tambem move o contato para o topo.
  useEffect(() => {
    if (!profile?.id) return;
    let timer: number | null = null;
    const sincronizarLista = () => {
      if (document.visibilityState === 'visible') void fetchInbox(true);
      timer = window.setTimeout(sincronizarLista, tempoRealAtivo() ? 45_000 : 10_000);
    };
    timer = window.setTimeout(sincronizarLista, tempoRealAtivo() ? 45_000 : 10_000);
    return () => { if (timer) window.clearTimeout(timer); };
  }, [profile?.id, profile?.corretor_id, profile?.nome_empresa]);

  // Ao voltar para a aba/janela, sincroniza novamente a lista completa. Isso
  // evita que o usuario entre no Inbox vendo um snapshot antigo.
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchInbox(true);
      const conversationId = selectedConversationRef.current?.id;
      if (conversationId && !conversationId.startsWith('new-')) {
        void fetchMessages(conversationId, { silent: true });
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [profile?.id, profile?.corretor_id, profile?.nome_empresa]);

  useEffect(() => {
    const corretorId = selectedConversation?.corretor_id || profile?.corretor_id;
    if (!corretorId) {
      setKanbanStages(DEFAULT_KANBAN_STAGES);
      return;
    }
    let active = true;
    void (async () => {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/crm/stages?corretor_id=${encodeURIComponent(corretorId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (active && response.ok) setKanbanStages(normalizeKanbanStages(payload.stages));
    })();
    return () => { active = false; };
  }, [selectedConversation?.corretor_id, profile?.corretor_id]);

  useEffect(() => {
    if (selectedConversation?.lead_id) {
      void fetchLeadDetails(selectedConversation.lead_id);
    } else {
      setLeadStatus('Aguardando atendimento');
      setLeadInfo(null);
    }
  }, [selectedConversation?.id]);

  const fetchLeadDetails = async (leadId: string) => {
    setLoadingLead(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select(`
          status, etiqueta, observacoes, nome, telefone, idades, possui_cnpj, cnpj, responsavel_profile_id,
          tem_plano_ativo, plano_atual, investimento, cidade, operadora, utm_source, email,
          motivo_busca, hospital_preferencia, valor_negociacao, operadora_negociacao
        `)
        .eq('id', leadId)
        .single();
      if (error) throw error;
      if (data) {
        const normalizedLeadInfo = { ...data, origem: data.utm_source || '' };
        setLeadStatus(normalizeLeadStatus(data.status));
        setLeadInfo(normalizedLeadInfo);
        setLeadDetailsOpen(true);
        setSelectedConversation((current) => current?.lead_id === leadId ? {
          ...current,
          tags: data.etiqueta ? [data.etiqueta] : current.tags || [],
        } : current);
    } else {
      setLeadInfo(null);
      setLeadTasks([]);
    }

      const { data: activities } = await supabase
        .from('lead_atividades')
        .select('*, profiles:profile_id(nome)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(80);

      setLeadActivities(activities || []);

      const { data: tasks } = await supabase
        .from('lead_tarefas')
        .select('id, titulo, vencimento, prioridade, status, responsavel_profile_id, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(30);
      setLeadTasks((tasks || []) as LeadTask[]);
    } catch (err) {
      console.error('Erro ao buscar status do lead:', err);
    } finally {
      setLoadingLead(false);
    }
  };

  async function logLeadActivity(input: { tipo?: string; titulo: string; descricao?: string | null }) {
    if (!selectedConversation?.lead_id) return null;
    const { data, error } = await supabase
      .from('lead_atividades')
      .insert([{
        lead_id: selectedConversation.lead_id,
        profile_id: profile?.id,
        tipo: input.tipo || 'sistema',
        titulo: input.titulo,
        descricao: input.descricao || null,
      }])
      .select('*')
      .single();

    if (error) throw error;
    if (data) {
      setLeadActivities((current) => [data, ...current]);
      setHistoryActivities((current) => [data, ...current]);
      return data;
    }
    return null;
  }

  const handleCallClick = async () => {
    if (!selectedConversation?.telefone) return;
    const phone = selectedConversation.telefone.replace(/\D/g, '');
    if (!phone) return;
    
    // 1. Open the phone link
    window.open(`tel:${phone}`, '_self');

    // 2. Log the activity in the database
    if (selectedConversation.lead_id) {
      try {
        await logLeadActivity({
          tipo: 'ligacao',
          titulo: 'Ligação Iniciada',
          descricao: 'Chamada telefônica iniciada pelo corretor através do painel do Inbox.'
        });
      } catch (e) {
        console.error('Erro ao registrar ligação no histórico:', e);
      }
    }
  };

  function formatActivityDate(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const handleUpdateLeadStatus = async (newStatus: string) => {
    if (!selectedConversation?.lead_id) {
      alert('Esta conversa não possui um Lead associado.');
      return;
    }
    
    setUpdatingStatus(true);
    try {
      const token = await getToken();
      const response = await fetch(`/api/crm/leads/${selectedConversation.lead_id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(payload.error || 'Erro ao atualizar status no CRM.');
      
      setLeadStatus(newStatus);
      void fetchLeadDetails(selectedConversation.lead_id);
      alert('Status do Lead atualizado com sucesso no CRM!');
    } catch (err: any) {
      console.error('Erro ao atualizar status do lead:', err);
      alert(err.message || 'Erro ao atualizar status no Supabase.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleUpdateLeadField = async (field: string, rawValue: string) => {
    if (!selectedConversation?.lead_id || !leadInfo) return;
    const dbField = field === 'origem' ? 'utm_source' : field;
    const nextValue = rawValue.trim();
    const currentValue = String(leadInfo[field] || '').trim();
    if (nextValue === currentValue) return;

    const previous = leadInfo;
    setLeadInfo((current: any) => current ? { ...current, [field]: nextValue || null, [dbField]: nextValue || null } : current);

    const { error } = await supabase
      .from('leads')
      .update({
        [dbField]: nextValue || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedConversation.lead_id);

    if (error) {
      setLeadInfo(previous);
      alert('Erro ao atualizar dados do lead: ' + error.message);
      return;
    }

    await logLeadActivity({
      tipo: 'edicao',
      titulo: 'Dados do lead atualizados',
      descricao: `${field}: ${nextValue || '-'}`,
    }).catch(() => null);
  };

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
      const response = await fetch('/api/inbox/uazapi/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        },
        body: JSON.stringify({
          accepted_terms: true,
          terms_version: 'whatsapp-inbox-v1',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      setConnecting(false);

      if (!response.ok) {
        setConnectError(payload.error || 'Nao consegui gerar o QR Code agora.');
        return;
      }

      setWhatsAppOwnerName(payload.targetProfile?.nome || profile?.nome || '');

      if (payload.connected || payload.state === 'open') {
        setIsWhatsAppConnected(true);
        setWhatsappStatus('open');
        setQrCode(null);
        setConnectError(null);
        return;
      }

      setIsWhatsAppConnected(false);
      setWhatsappStatus(payload.state || 'connecting');
      if (payload.qrcode) {
        setQrCode(payload.qrcode);
      } else if (payload.state === 'close') {
        setConnectError('Nao consegui iniciar uma nova conexao agora. Aguarde alguns segundos e tente novamente.');
      }
    } catch (err) {
      console.error(err);
      setConnectError('Erro de conexao ao gerar o QR Code.');
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
      const response = await fetch('/api/inbox/uazapi/connect', {
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
      setWhatsAppOwnerName(profile?.nome || '');
      alert('Instancia limpa e reiniciada no servidor!');
    } catch (err) {
      console.error(err);
      setConnecting(false);
    }
  }

  // Send message
  async function sendMessage(textOverride?: string, isAudio = false, audioDuration = '', audioBase64Override?: string, audioMimeType?: string) {
    if (!selectedConversation) return;
    const finalMsg = textOverride || messageText.trim();
    if (!finalMsg && selectedAttachments.length === 0 && !isAudio) return;
    if (sendInFlightRef.current) return;
    if (!isWhatsAppConnected) {
      setSendError('O WhatsApp esta desconectado. Reconecte a conta pelo QR Code antes de enviar.');
      void fetchConnectionStatus();
      return;
    }

    sendInFlightRef.current = true;

    const token = await getToken().catch(() => null);
    if (!token) {
      setSendError('Sessao expirada. Entre novamente.');
      sendInFlightRef.current = false;
      return;
    }

    const originalText = messageText;
    const originalAttachments = selectedAttachments;

    if (!isAudio) {
      setMessageText('');
      setSelectedAttachments([]);
    }

    setSendingMessage(true);
    setSendError(null);
    const isNew = selectedConversation.id.startsWith('new-');
    const hasAudioData = isAudio && audioBase64Override;
    const clientSendId = crypto.randomUUID();

    try {
      const jobs = hasAudioData
        ? [{ preview: audioBase64Override, file: null as File | null, isAudio: true }]
        : originalAttachments.length
          ? originalAttachments.map((attachment) => ({ preview: attachment.preview, file: attachment.file, isAudio: false }))
          : [{ preview: '', file: null as File | null, isAudio: false }];

      const insertedMessages: InboxMessage[] = [];
      let realConversation: Conversation | null = null;

      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const file = job.file;
        let mediatype = 'document';
        if (file?.type.startsWith('image/')) mediatype = 'image';
        else if (file?.type.startsWith('video/')) mediatype = 'video';
        else if (file?.type.startsWith('audio/')) mediatype = 'audio';

        const response = await fetch('/api/inbox/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
          },
          body: JSON.stringify({
            conversation_id: realConversation?.id || selectedConversation.id,
            client_message_id: `${clientSendId}:${index}`,
            mensagem: job.isAudio ? '[Audio Gravado]' : (index === 0 ? finalMsg : ''),
            ...(isNew && !realConversation ? {
              telefone: selectedConversation.telefone,
              lead_id: selectedConversation.lead_id,
              nome_contato: selectedConversation.nome_contato,
            } : {}),
            ...(job.preview ? {
              media: job.preview,
              mimetype: job.isAudio ? (audioMimeType || 'audio/ogg') : file?.type,
              fileName: job.isAudio ? (audioMimeType?.includes('ogg') ? 'audio.ogg' : 'audio.webm') : file?.name,
              mediatype: job.isAudio ? 'audio' : mediatype,
            } : {}),
          }),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setSendError(payload.error || 'Nao consegui enviar agora.');
          void fetchConnectionStatus();
          if (!isAudio) {
            setMessageText(originalText);
            setSelectedAttachments(originalAttachments);
          }
          return;
        }

        if (payload.message) insertedMessages.push(payload.message);
        if (payload.success && payload.conversation) realConversation = payload.conversation as Conversation;
      }

      // Sem a linha que o servidor gravou nao existe mensagem enviada. Inventar
      // um balao aqui fazia o CRM mostrar como enviada uma mensagem que podia
      // nunca ter chegado ao WhatsApp: agora a conversa e relida do banco.
      if (insertedMessages.length === 0) {
        void fetchMessages(realConversation?.id || selectedConversation.id, { silent: true });
      }

      const localMessages = insertedMessages.map((message) => {
        const isMsgAudio =
          message.mensagem?.includes('[Audio Gravado]') ||
          message.mensagem?.includes('Mensagem de voz') ||
          message.mensagem?.includes('Audio') ||
          Boolean(message.metadata?.message?.audioMessage || message.metadata?.audioMessage || message.metadata?.data?.message?.audioMessage);

        return {
          ...message,
          isAudio: isMsgAudio || isAudio,
          audioDuration: audioDuration || message.audioDuration,
        };
      });

      setMessages((current) => {
        const next = [...current];
        for (const localMsg of localMessages) {
          if (!next.some((message) => message.id === localMsg.id)) next.push(localMsg);
        }
        return next;
      });

      if (selectedConversation.aiActive) {
        setTimeout(() => {
          const aiMsg: InboxMessage = {
            id: `ai_${Date.now()}`,
            conversa_id: selectedConversation.id,
            direction: 'inbound',
            remetente: selectedConversation.nome_contato,
            mensagem: '[Apolo Co-Piloto]: Entendi sua mensagem! Vou simular uma resposta com base nas tabelas de saude que analisamos no Simulador.',
            created_at: new Date().toISOString(),
          };
          setMessages((current) => [...current, aiMsg]);
        }, 1500);
      }

      if (realConversation) {
        setSelectedConversation(realConversation);
      }
    } catch (err) {
      console.error(err);
      setSendError('Nao consegui enviar agora. Tente novamente em instantes.');
      if (!isAudio) {
        setMessageText(originalText);
        setSelectedAttachments(originalAttachments);
      }
    } finally {
      sendInFlightRef.current = false;
      setSendingMessage(false);
    }
  }

  // Audio Recording Toggle
  const startRecording = async () => {
    try {
      setSendError(null);

      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setSendError('Este navegador nao permite gravar audio aqui. Use Chrome/Edge atualizado e confira a permissao do microfone.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      
      const supportedMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ].find((type) => MediaRecorder.isTypeSupported(type));

      const mediaRecorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordSeconds(0);
      
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordSeconds(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não consegui acessar o microfone. Verifique as permissões do seu navegador.');
    }
  };

  const stopAndSendRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);

    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    const recordedMimeType = mediaRecorder.mimeType || 'audio/webm';
    const finalRecordSeconds = Math.max(recordSeconds, 1);

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: recordedMimeType });
      
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
      }

      mediaRecorderRef.current = null;
      if (!audioBlob.size) {
        setSendError('A gravacao ficou vazia. Tente novamente e permita o microfone.');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = String(reader.result || '');
        const base64Audio = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : dataUrl;

        if (!base64Audio) {
          setSendError('Nao consegui preparar o audio gravado. Tente novamente.');
          return;
        }
        
        const mins = Math.floor(finalRecordSeconds / 60).toString().padStart(2, '0');
        const secs = (finalRecordSeconds % 60).toString().padStart(2, '0');
        const durationStr = `${mins}:${secs}`;
        
        void sendMessage(undefined, true, durationStr, base64Audio, recordedMimeType);
      };
      reader.readAsDataURL(audioBlob);
    };

    mediaRecorder.stop();
  };

  const cancelRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordSeconds(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = () => {};
      mediaRecorderRef.current.stop();
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
  };

  const fetchMessageMedia = useCallback(async (message: InboxMessage) => {
    const cached = mediaUrls[message.id];
    if (cached) return cached;
    setMediaLoadErrors(prev => {
      if (!prev[message.id]) return prev;
      const next = { ...prev };
      delete next[message.id];
      return next;
    });

    setLoadingMediaId(message.id);
    try {
      const token = await getToken();
      const response = await fetch(`/api/inbox/messages/media?message_id=${message.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Nao foi possivel carregar este arquivo.');
      }

      const mimeType = data.mimeType || data.mimetype || getMessageMimeType(message) || 'application/octet-stream';
      const fileName = data.fileName || data.filename || getMessageFileName(message) || undefined;
      const url = data.base64 ? base64ToObjectUrl(data.base64, mimeType) : data.url;
      if (!url) throw new Error('Arquivo indisponivel.');

      const media = { url, mimeType, fileName };
      setMediaUrls(prev => ({ ...prev, [message.id]: media }));
      return media;
    } catch (err) {
      setMediaLoadErrors(prev => ({ ...prev, [message.id]: true }));
      throw err;
    } finally {
      setLoadingMediaId(null);
    }
  }, [mediaUrls, profile?.id]);

  const openMessageMedia = async (message: InboxMessage) => {
    try {
      const media = await fetchMessageMedia(message);
      setMediaPreview({
        url: media.url,
        mimeType: media.mimeType,
        fileName: media.fileName || getMessageFileName(message) || 'Arquivo recebido',
      });
    } catch (err: any) {
      console.error('Erro ao abrir arquivo:', err);
      alert(err.message || 'Nao foi possivel abrir o arquivo.');
    }
  };

  const handlePlayAudio = async (messageId: string) => {
    if (audioUrls[messageId]) return;

    setLoadingAudioId(messageId);
    try {
      const token = await getToken();
      const response = await fetch(`/api/inbox/messages/media?message_id=${messageId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
        }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Nao foi possivel carregar este audio.');
      }
      if (data.base64) {
        const url = base64ToObjectUrl(data.base64, data.mimeType || 'audio/ogg');
        setAudioUrls(prev => ({ ...prev, [messageId]: url }));
      } else if (data.url) {
        setAudioUrls(prev => ({ ...prev, [messageId]: data.url }));
      } else {
        alert('Não foi possível obter o arquivo de áudio no momento.');
      }
    } catch (err) {
      console.error('Erro ao baixar áudio:', err);
      alert('Erro ao processar áudio.');
    } finally {
      setLoadingAudioId(null);
    }
  };
 
  // Status conversion toggles
  const handleTogglePause = () => {
    if (!selectedConversation) return;
    const isPaused = selectedConversation.status === 'pausada';
    updateConversationStatus(isPaused ? 'aberta' : 'pausada');
  };

  const handleEndChat = () => {
    setCloseReason('');
    setShowCloseReasonModal(true);
  };

  const updateConversationStatus = async (newStatus: string) => {
    if (!selectedConversation) return false;

    const conversation = selectedConversation;
    const clearConversationSelection = () => {
      setSelectedConversation(null);
      setMessages([]);

      const url = new URL(window.location.href);
      url.searchParams.delete('telefone');
      url.searchParams.delete('lead');
      url.searchParams.delete('nome');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    };

    if (conversation.id.startsWith('new-')) {
      if (newStatus === 'fechada') {
        clearConversationSelection();
      }
      return true;
    }

    const token = await getToken();
    if (!token) return false;
    const response = await fetch('/api/inbox/messages', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversation.id, status: newStatus }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Erro ao salvar status da conversa:', payload.error);
      return false;
    }

    const updated = { ...conversation, status: newStatus };
    const affectedIds = new Set<string>(Array.isArray(payload.conversation_ids)
      ? payload.conversation_ids.map(String)
      : [conversation.id]);
    setConversations((current) => current.map((item) => affectedIds.has(item.id)
      ? { ...item, status: newStatus }
      : item));
    clearConversationSelection();

    return true;
  };

  const handleShare = () => {
    if (!selectedConversation) return;
    const shareUrl = `${window.location.origin}/inbox?telefone=${selectedConversation.telefone}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => alert('Link de atendimento copiado para a área de transferência!'))
      .catch(() => alert('Não foi possível copiar o link.'));
  };

  const handleBlockContact = async () => {
    if (!selectedConversation) return;
    const confirmBlock = window.confirm('Deseja realmente bloquear este contato? Isso irá encerrar o atendimento e marcar o lead como "Sem interesse" no CRM.');
    if (!confirmBlock) return;

    try {
      // 1. Update lead status if exists
      if (selectedConversation.lead_id) {
        const { error: leadErr } = await supabase
          .from('leads')
          .update({ status: 'Sem interesse' })
          .eq('id', selectedConversation.lead_id);
        if (leadErr) throw leadErr;

        // Log block activity
        await supabase.from('lead_atividades').insert([{
          lead_id: selectedConversation.lead_id,
          profile_id: profile?.id,
          tipo: 'sistema',
          titulo: 'Contato bloqueado',
          descricao: 'Conversa encerrada e contato marcado como Sem interesse.'
        }]);
      }

      // 2. Add "Bloqueado" tag
      let currentTags = selectedConversation.tags || [];
      if (!currentTags.includes('Bloqueado')) {
        currentTags = [...currentTags, 'Bloqueado'];
      }

      // 3. Update conversation in DB
      if (!selectedConversation.id.startsWith('new-')) {
        const { error: convErr } = await supabase
          .from('whatsapp_conversas')
          .update({ 
            status: 'resolvida', // DB status for closed
            tags: currentTags,
            updated_at: new Date().toISOString()
          })
          .eq('id', selectedConversation.id);
        if (convErr) throw convErr;
      }

      // Update local state
      const updated = { 
        ...selectedConversation, 
        status: 'fechada', 
        tags: currentTags 
      };
      setSelectedConversation(updated);
      setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));

      alert('Contato bloqueado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao bloquear contato:', err);
      alert('Erro ao bloquear contato: ' + err.message);
    }
  };

  const handleScheduleTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversation?.lead_id) {
      alert('Esta conversa não possui um Lead associado no CRM.');
      return;
    }
    if (!taskTitle.trim()) {
      alert('Por favor, informe o título da tarefa.');
      return;
    }

    let vencimentoDate: Date | null = null;
    if (taskDueDate) {
      const timePart = taskDueTime.trim() || '09:00';
      const parsed = new Date(`${taskDueDate}T${timePart}`);
      if (!isNaN(parsed.getTime())) {
        vencimentoDate = parsed;
      }
    }

    setSavingTask(true);
    try {
      const responsibleProfileId = taskResponsibleProfileId || leadInfo?.responsavel_profile_id || profile?.id || null;
      const taskData = {
        lead_id: selectedConversation.lead_id,
        corretor_id: selectedConversation.corretor_id,
        responsavel_profile_id: responsibleProfileId,
        titulo: taskTitle.trim(),
        vencimento: vencimentoDate ? vencimentoDate.toISOString() : null,
        prioridade: taskPriority,
      };
      // Sem .select() de proposito: pedir a linha de volta faz o PostgREST
      // aplicar a politica de leitura, que barra quando a tarefa fica no nome de
      // outro corretor da mesma empresa. Isso derrubou a criacao de tarefa em
      // producao; o aviso identifica a tarefa pelo lead e pelo responsavel.
      const { error } = editingTaskId
        ? await supabase.from('lead_tarefas').update(taskData).eq('id', editingTaskId)
        : await supabase.from('lead_tarefas').insert([{ ...taskData, status: 'pendente' }]);
      if (error) throw error;

      // Tarefa criada para outra pessoa vira aviso no WhatsApp dela. O servidor
      // decide o envio; aqui so avisamos qual tarefa foi salva.
      if (!editingTaskId && responsibleProfileId && responsibleProfileId !== profile?.id) {
        void (async () => {
          try {
            const { data: sessao } = await supabase.auth.getSession();
            const token = sessao.session?.access_token;
            if (!token) return;
            await fetch('/api/tarefas/notificar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                lead_id: selectedConversation.lead_id,
                responsavel_profile_id: responsibleProfileId,
              }),
            });
          } catch (erro) {
            console.error('[inbox] aviso de tarefa falhou:', erro);
          }
        })();
      }

      await logLeadActivity({
        tipo: 'tarefa',
        titulo: editingTaskId ? 'Tarefa editada' : 'Tarefa criada',
        descricao: `${taskTitle.trim()}${vencimentoDate ? ` | Prazo: ${formatActivityDate(vencimentoDate.toISOString())}` : ''}`,
      });

      alert(editingTaskId ? 'Tarefa atualizada com sucesso!' : 'Tarefa agendada com sucesso!');
      setShowTaskModal(false);
      setEditingTaskId(null);
      setTaskTitle('');
      setTaskDueDate('');
      setTaskDueTime('09:00');
      setTaskPriority('normal');
      setTaskResponsibleProfileId('');
      await fetchLeadDetails(selectedConversation.lead_id);
      await fetchInbox(true);
    } catch (err: any) {
      console.error('Erro ao agendar tarefa:', err);
      alert('Erro ao agendar tarefa: ' + err.message);
    } finally {
      setSavingTask(false);
    }
  };

  const openTaskEditor = (task: LeadTask) => {
    const due = task.vencimento ? new Date(task.vencimento) : null;
    setEditingTaskId(task.id);
    setTaskTitle(task.titulo);
    setTaskDueDate(due && !Number.isNaN(due.getTime()) ? due.toISOString().slice(0, 10) : '');
    setTaskDueTime(due && !Number.isNaN(due.getTime()) ? due.toTimeString().slice(0, 5) : '09:00');
    setTaskPriority(task.prioridade || 'normal');
    setTaskResponsibleProfileId(task.responsavel_profile_id || '');
    setShowTaskModal(true);
  };

  const completeReminder = async (task: LeadTask) => {
    if (!selectedConversation?.lead_id) return;
    setSavingTask(true);
    try {
      const { error } = await supabase
        .from('lead_tarefas')
        .update({ status: 'concluida', updated_at: new Date().toISOString() })
        .eq('id', task.id);
      if (error) throw error;

      await logLeadActivity({
        tipo: 'tarefa',
        titulo: 'Lembrete concluido',
        descricao: task.titulo,
      });
      await fetchLeadDetails(selectedConversation.lead_id);
      await fetchInbox(true);
    } catch (err: any) {
      console.error('Erro ao concluir lembrete:', err);
      alert('Erro ao concluir lembrete: ' + err.message);
    } finally {
      setSavingTask(false);
    }
  };

  const loadHistory = async () => {
    if (!selectedConversation) return;
    setLoadingHistory(true);
    try {
      if (selectedConversation.lead_id) {
        const { data: activities } = await supabase
          .from('lead_atividades')
          .select('*, profiles:profile_id(nome)')
          .eq('lead_id', selectedConversation.lead_id)
          .order('created_at', { ascending: false });
        setHistoryActivities(activities || []);
      } else {
        setHistoryActivities([]);
      }

      const { data: pastConvs } = await supabase
        .from('whatsapp_conversas')
        .select('*')
        .eq('telefone', selectedConversation.telefone)
        .order('ultima_mensagem_at', { ascending: false });
      setHistoryConversations(pastConvs || []);
    } catch (err) {
      console.error('Erro ao buscar histórico:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleForwardLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversation?.lead_id) {
      alert('Esta conversa não possui um Lead associado.');
      return;
    }
    if (!selectedMemberId) {
      alert('Selecione um membro responsável.');
      return;
    }
    setForwarding(true);
    const token = await getToken();
    if (!token) {
      alert('Sessão expirada. Faça login novamente.');
      setForwarding(false);
      return;
    }

    try {
      const response = await fetch('/api/corretor/times', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          action: 'assign_lead', 
          lead_id: selectedConversation.lead_id, 
          member_id: selectedMemberId, 
          corretor_id: profile?.corretor_id || selectedConversation?.corretor_id 
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Erro ao reatribuir lead.');
      }

      // Log assignment activity in CRM timeline
      const member = teamMembers.find((item) => item.id === selectedMemberId);
      await supabase.from('lead_atividades').insert([{
        lead_id: selectedConversation.lead_id,
        profile_id: profile?.id,
        tipo: 'sistema',
        titulo: 'Responsável alterado',
        descricao: member ? `Encaminhado para o responsável: ${member.nome}` : 'Encaminhado para um novo responsável.'
      }]);

      // Update local conversation agentName
      if (member) {
        const updated = { ...selectedConversation, agentName: member.nome };
        setSelectedConversation(updated);
        setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
      }

      alert('Lead encaminhado com sucesso!');
      setShowForwardModal(false);
      setSelectedMemberId('');
    } catch (err: any) {
      console.error('Erro ao encaminhar lead:', err);
      alert('Erro ao encaminhar lead: ' + err.message);
    } finally {
      setForwarding(false);
    }
  };

  const toggleAIActive = () => {
    if (!selectedConversation) return;
    const updated = { ...selectedConversation, aiActive: !selectedConversation.aiActive };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
  };

  const handleSaveStepText = (stepId: string, newText: string) => {
    setFlowSteps(current => current.map(step => step.id === stepId ? { ...step, text: newText } : step));
  };

  // Sidebar notes & tags updates
  const handleAddNote = async () => {
    if (!selectedConversation || !newNote.trim()) return;
    const saved = await logLeadActivity({
      tipo: 'nota',
      titulo: 'Anotacao interna',
      descricao: newNote.trim(),
    });
    const displayNote = saved
      ? `${newNote.trim()} - ${formatActivityDate(saved.created_at)}`
      : `${newNote.trim()} - ${formatActivityDate(new Date().toISOString())}`;
    const updatedNotes = [...(selectedConversation.notes || []), displayNote];
    const updated = { ...selectedConversation, notes: updatedNotes };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
    setNewNote('');
  };
 
  const handleLogManualCall = async () => {
    if (!selectedConversation) return;
    const desc = newNote.trim() || 'Chamada telefônica efetuada pelo corretor.';
    await logLeadActivity({
      tipo: 'ligacao',
      titulo: 'Ligação Efetuada (Manual)',
      descricao: desc,
    });
    setNewNote('');
  };

  const handleDeleteActivity = async (id: string) => {
    if (!window.confirm('Deseja realmente excluir esta anotação/ligação?')) return;
    try {
      const { error } = await supabase
        .from('lead_atividades')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setLeadActivities((current) => current.filter((act) => act.id !== id));
      setHistoryActivities((current) => current.filter((act) => act.id !== id));
    } catch (err) {
      console.error('Erro ao excluir atividade:', err);
      alert('Não foi possível excluir o registro.');
    }
  };

  const handleAddTag = async (tag: string) => {
    if (!selectedConversation || !tag) return;
    const nextTag = tag.trim();
    if (!nextTag) return;
    if (selectedConversation.tags?.some((item) => item.toLowerCase() === nextTag.toLowerCase())) return;
    const updatedTags = [...(selectedConversation.tags || []), nextTag];
    const updated = { ...selectedConversation, tags: updatedTags };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));

    if (selectedConversation.lead_id) {
      await supabase
        .from('leads')
        .update({ etiqueta: nextTag, updated_at: new Date().toISOString() })
        .eq('id', selectedConversation.lead_id);
      await logLeadActivity({
        tipo: 'sistema',
        titulo: 'Etiqueta adicionada',
        descricao: nextTag,
      });
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!selectedConversation) return;
    const updatedTags = (selectedConversation.tags || []).filter(t => t !== tag);
    const updated = { ...selectedConversation, tags: updatedTags };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));

    if (selectedConversation.lead_id) {
      await supabase
        .from('leads')
        .update({ etiqueta: updatedTags[0] || null, updated_at: new Date().toISOString() })
        .eq('id', selectedConversation.lead_id);
      await logLeadActivity({
        tipo: 'sistema',
        titulo: 'Etiqueta removida',
        descricao: tag,
      });
    }
  };

  const handleAddCustomField = async () => {
    if (!selectedConversation || !customFieldName.trim() || !customFieldValue.trim()) return;
    
    const currentFields = selectedConversation.customFields || [];
    const newField = { key: customFieldName.trim(), value: customFieldValue.trim() };
    const isUpdate = currentFields.some(f => f.key.toLowerCase() === newField.key.toLowerCase());
    
    let updatedFields;
    if (isUpdate) {
      updatedFields = currentFields.map(f => f.key.toLowerCase() === newField.key.toLowerCase() ? newField : f);
    } else {
      updatedFields = [...currentFields, newField];
    }
    
    const updated = { ...selectedConversation, customFields: updatedFields };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));
    
    setCustomFieldName('');
    setCustomFieldValue('');

    await logLeadActivity({
      tipo: 'sistema',
      titulo: isUpdate ? 'Campo personalizado atualizado' : 'Campo personalizado criado',
      descricao: `${newField.key}: ${newField.value}`,
    });
  };

  const handleRemoveCustomField = async (key: string) => {
    if (!selectedConversation) return;
    const updatedFields = (selectedConversation.customFields || []).filter(f => f.key !== key);
    const updated = { ...selectedConversation, customFields: updatedFields };
    setSelectedConversation(updated);
    setConversations(current => current.map(c => c.id === selectedConversation.id ? updated : c));

    await logLeadActivity({
      tipo: 'sistema',
      titulo: 'Campo personalizado removido',
      descricao: key,
    });
  };

  // Handlers for attachments
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
          file,
          preview: await readFileAsDataUrl(file),
        }))
      );
      setSelectedAttachments((current) => [...current, ...attachments]);
    } catch (err) {
      console.error(err);
      setSendError('Nao consegui carregar um dos arquivos selecionados.');
    }
  };

  // Tab Filtering logic
  const responsibleOptions = Array.from(
    new Map(
      [
        ...teamMembers
          .filter((member) => member.profile_id)
          .map((member) => [
            String(member.profile_id),
            { id: String(member.profile_id), name: member.nome || 'Responsavel' }
          ] as const),
        ...conversations
          .filter((conversation) => conversation.responsibleProfileId)
          .map((conversation) => [
            conversation.responsibleProfileId as string,
            {
              id: conversation.responsibleProfileId as string,
              name: teamMemberByProfileId.get(conversation.responsibleProfileId as string)?.nome || conversation.agentName || 'Responsavel'
            }
          ] as const)
      ]
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));


  const conversationsByResponsible = conversations.filter((conversation) => {
    if (responsibleFilter === 'todos') return true;
    if (responsibleFilter === 'sem_responsavel') return !conversation.responsibleProfileId;
    return conversation.responsibleProfileId === responsibleFilter;
  });

  const filteredConversations = conversationsByResponsible.filter((c) => {
    // Search filter
    if (searchTerm) {
      const matchName = c.nome_contato?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchPhone = c.telefone.includes(searchTerm);
      if (!matchName && !matchPhone) return false;
    }

    if (stageFilter !== 'todos' && normalizeLeadStatus(c.leadStatus) !== stageFilter) return false;

    return conversationBelongsToBox(c, conversationBox);
  });

  const internalNotes = leadActivities
    .filter((activity) => activity.tipo === 'nota')
    .map((activity) => ({
      id: activity.id,
      text: activity.descricao || activity.titulo,
      createdAt: activity.created_at,
      author: activity.profiles?.nome || null,
    }));

  const highlightedTask = useMemo(() => {
    const active = leadTasks
      .filter((task) => !['concluida', 'concluído', 'concluido', 'cancelada', 'cancelado'].includes(String(task.status || '').toLowerCase()))
      .sort((a, b) => new Date(a.vencimento || a.created_at).getTime() - new Date(b.vencimento || b.created_at).getTime());
    return active[0] || leadTasks[0] || null;
  }, [leadTasks]);

  const formatHour = (value: string) => {
    try {
      return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  /**
   * Recibo do WhatsApp para o que saiu pelo CRM.
   *
   * So vale para a mensagem que o proprio CRM enviou: as que o corretor digita
   * no celular chegam aqui pelo webhook e nunca teriam recibo. Sem esse aviso,
   * mensagem entregue e mensagem que nunca saiu ficavam iguais na tela.
   */
  const reciboDaMensagem = (message: InboxMessage) => {
    if (message.direction !== 'outbound') return null;
    const recibo = String(message.metadata?.recibo || '').toLowerCase();
    if (recibo === 'read' || recibo === 'played') return { texto: 'lida', alerta: false };
    if (recibo === 'delivered') return { texto: 'entregue', alerta: false };
    if (recibo === 'sent' || recibo === 'server') return { texto: 'enviada', alerta: false };
    // Sem recibo so acusa o que saiu pelo CRM: mensagem digitada no celular
    // chega aqui pelo webhook e ficaria marcada como duvidosa sem motivo.
    if (message.metadata?.send_status !== 'sent') return null;
    const idade = Date.now() - new Date(message.created_at).getTime();
    if (idade < 5 * 60_000) return { texto: 'enviando', alerta: false };
    return { texto: 'sem confirmacao', alerta: true };
  };

  const messageDayKey = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  };

  const formatMessageDay = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    if (sameDay(date, today)) return 'Hoje';
    if (sameDay(date, yesterday)) return 'Ontem';

    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffMs = todayStart - dateStart;
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays > 1 && diffDays < 7) {
      return date.toLocaleDateString('pt-BR', { weekday: 'long' });
    }

    return date.toLocaleDateString('pt-BR');
  };

  const renderAudioWaveform = (isActive: boolean) => {
    return (
      <div className="flex items-center gap-1">
        <span className={`h-3 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} />
        <span className={`h-5 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} style={isActive ? { animationDelay: '0.1s' } : undefined} />
        <span className={`h-7 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} style={isActive ? { animationDelay: '0.2s' } : undefined} />
        <span className={`h-4 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} style={isActive ? { animationDelay: '0.3s' } : undefined} />
        <span className={`h-6 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} style={isActive ? { animationDelay: '0.4s' } : undefined} />
        <span className={`h-3 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} style={isActive ? { animationDelay: '0.5s' } : undefined} />
        <span className={`h-5 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} style={isActive ? { animationDelay: '0.6s' } : undefined} />
        <span className={`h-2 w-0.5 bg-cyan-400 rounded-full ${isActive ? 'animate-pulse' : 'opacity-40'}`} style={isActive ? { animationDelay: '0.7s' } : undefined} />
      </div>
    );
  };

  const mergedChatMessages = useMemo(() => {
    if (!selectedConversation) return messages;

    const callMessages: InboxMessage[] = leadActivities
      .filter((act) => act.tipo === 'ligacao')
      .map((act) => ({
        id: act.id,
        conversa_id: selectedConversation.id,
        direction: 'outbound',
        remetente: act.profiles?.nome || 'Corretor',
        mensagem: `Ligação de voz iniciada por ${act.profiles?.nome || 'Corretor'}`,
        created_at: act.created_at,
        metadata: {
          messageType: 'call',
          isBrokerCall: true,
          brokerName: act.profiles?.nome || 'Corretor',
          descricao: act.descricao || 'Chamada efetuada.'
        }
      }));

    return [...messages, ...callMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [messages, leadActivities, selectedConversation]);

  const filteredChatMessages = mergedChatMessages;

  const displayChatMessages = useMemo(() => {
    const reactionsByTarget = new Map<string, string[]>();
    filteredChatMessages.forEach((message) => {
      if (!isReactionMessage(message)) return;
      const target = getReactionTarget(message);
      if (!target) return;
      reactionsByTarget.set(target, [...(reactionsByTarget.get(target) || []), message.mensagem]);
    });

    return filteredChatMessages
      .filter((message) => !isReactionMessage(message))
      .map((message) => {
        const reactions = getMessageExternalIds(message).flatMap((id) => reactionsByTarget.get(id) || []);
        return reactions.length ? { ...message, reactions: Array.from(new Set(reactions)) } : message;
      });
  }, [filteredChatMessages]);

  // Carrega sozinho a previa das imagens da conversa aberta.
  //
  // Antes o controle de "ja estou buscando" era um id unico. Disparando dez de
  // uma vez, so o ultimo ficava marcado, e como o proprio id era dependencia do
  // efeito, cada resposta reexecutava tudo e pedia os outros nove de novo. Deu
  // 1.180 chamadas na mesma tela ate o navegador recusar conexao
  // (ERR_INSUFFICIENT_RESOURCES) e o inbox travar. A lista de pedidos em voo
  // vive num ref: muda sem provocar novo render.
  useEffect(() => {
    const emVoo = midiasEmVooRef.current;
    const imageMessages = filteredChatMessages
      .filter((message) => getMessageMediaKind(message) === 'image'
        && !mediaUrls[message.id]
        && !mediaLoadErrors[message.id]
        && !emVoo.has(message.id))
      .slice(0, 10);

    imageMessages.forEach((message) => {
      emVoo.add(message.id);
      void fetchMessageMedia(message)
        .catch(() => {
          setMediaLoadErrors((prev) => ({ ...prev, [message.id]: true }));
        })
        .finally(() => {
          emVoo.delete(message.id);
        });
    });
  }, [filteredChatMessages, mediaUrls, mediaLoadErrors, fetchMessageMedia]);

  return (
    <InternalLayout>
      <div className="orion-inbox-shell h-[calc(100dvh-64px)] sm:h-[calc(100dvh-72px)] min-h-0 flex flex-col gap-0 overflow-hidden">
        
        {/* Connection status header bar */}
        {isWhatsAppConnected ? (
          <div className="orion-inbox-connection orion-inbox-connection-connected bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-2 hidden sm:flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 animate-in fade-in-50">
            <div className="orion-inbox-connection-info flex items-center gap-3">
              <div className="orion-inbox-whatsapp-icon relative flex items-center justify-center shrink-0">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-ping absolute" />
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <WhatsAppGlyph className="orion-inbox-whatsapp-mark" />
              </div>
              <div>
                <p className="text-xs font-black text-emerald-200 uppercase tracking-wider">WhatsApp Conectado</p>
                <p className="text-2xs text-slate-400 font-bold mt-0.5">
                  {whatsAppOwnerName ? `${whatsAppOwnerName} conectado e pronto para enviar e receber mensagens diretamente.` : 'Conta conectada e pronta para enviar e receber mensagens diretamente.'}
                  {whatsAppNumero && (
                    <span className="text-emerald-300"> Numero: {formatarNumeroConectado(whatsAppNumero)}</span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={disconnectWhatsApp}
              disabled={connecting}
              className="orion-inbox-connection-action px-5 py-2.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/40 border border-rose-500/30 text-rose-400 text-2xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
            >
              {connecting ? 'Desconectando...' : 'Desconectar Conta'}
            </button>
          </div>
        ) : (
          <div className="orion-inbox-connection orion-inbox-connection-disconnected bg-amber-500/10 border-b border-amber-500/20 px-3 py-2 sm:px-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 shrink-0 animate-in fade-in-50">
            <div className="orion-inbox-connection-info flex items-center gap-3">
              <QrCode className="text-amber-400 shrink-0" size={20} />
              <div>
                <p className="text-xs font-black text-amber-200 uppercase tracking-wider">
                  {whatsappStatus === 'connecting' ? 'Preparando conexao do WhatsApp' : 'WhatsApp Desconectado'}
                </p>
                <p className="text-2xs text-slate-400 font-bold mt-0.5">
                  {whatsappStatus === 'connecting'
                    ? 'O QR Code esta sendo gerado. Ele aparecera automaticamente nesta tela.'
                    : whatsAppOwnerName
                      ? `${whatsAppOwnerName} ainda nao esta conectado ao Inbox.`
                      : 'Conecte esta conta para poder enviar mensagens reais diretamente por aqui.'}
                </p>
                {connectError && (
                  <p className="mt-2 text-[10px] font-black text-rose-300">{connectError}</p>
                )}
              </div>
            </div>
            <div className="orion-inbox-connection-actions flex flex-wrap items-center gap-2">
              <button
                onClick={disconnectWhatsApp}
                disabled={connecting}
                className="px-4 py-2.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/40 border border-rose-500/30 text-rose-400 text-2xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
              >
                {connecting ? 'Limpando...' : 'Forçar Desconexão'}
              </button>
              <button
                onClick={connectWhatsApp}
                disabled={connecting || whatsappStatus === 'connecting'}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-2xs font-black uppercase text-white shadow-lg shadow-orange-950/20 disabled:opacity-50 cursor-pointer"
              >
                {connecting || whatsappStatus === 'connecting' ? 'Gerando QR...' : 'Conectar Conta'}
              </button>
            </div>
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
        <div className="orion-inbox-panel flex-1 min-h-0 overflow-hidden border-y border-white/5 bg-slate-950/10 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(420px,1fr)_320px] 2xl:grid-cols-[360px_minmax(520px,1fr)_360px]">
          
          {/* COLUMN 1: CONVERSATIONS SIDEBAR */}
          <div className={`orion-inbox-list border-r border-white/5 ${selectedConversation ? 'hidden lg:flex' : 'flex'} flex-col bg-slate-900/20 h-full overflow-hidden`}>
            {/* Conversation box and filters */}
            <div className="p-4 border-b border-white/5 space-y-3.5">
              <div className="orion-inbox-box-tabs" role="tablist" aria-label="Caixas de conversa">
                <button
                  type="button"
                  role="tab"
                  aria-selected={conversationBox === 'active'}
                  aria-label="Conversas ativas"
                  title="Conversas ativas"
                  onClick={() => { setConversationBox('active'); setSelectedConversation(null); }}
                  className="orion-inbox-box-tab"
                >
                  <MessageSquare size={19} strokeWidth={2.2} aria-hidden="true" />
                  <span className="sr-only">Conversas ativas</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={conversationBox === 'followup'}
                  aria-label="Conversas em follow-up"
                  title="Conversas em follow-up"
                  onClick={() => { setConversationBox('followup'); setSelectedConversation(null); }}
                  className="orion-inbox-box-tab"
                >
                  <Clock size={19} strokeWidth={2.2} aria-hidden="true" />
                  <span className="sr-only">Conversas em follow-up</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={conversationBox === 'closed'}
                  aria-label="Conversas encerradas"
                  title="Conversas encerradas"
                  onClick={() => { setConversationBox('closed'); setSelectedConversation(null); }}
                  className="orion-inbox-box-tab"
                >
                  <Archive size={19} strokeWidth={2.2} aria-hidden="true" />
                  <span className="sr-only">Conversas encerradas</span>
                </button>
              </div>

              <p className="px-1 text-[10px] font-semibold text-slate-500">
                {conversationBox === 'active'
                  ? 'Atendimentos em andamento e aguardando resposta.'
                  : conversationBox === 'followup'
                    ? 'Conversas ativas que possuem uma tarefa de retorno pendente.'
                    : 'Histórico preservado. Uma nova resposta do lead reabre a conversa.'}
              </p>

              {profile?.tipo_usuario !== 'corretor_membro' && (responsibleOptions.length > 1 || conversations.some((conversation) => !conversation.responsibleProfileId)) && (
                <select
                  value={responsibleFilter}
                  onChange={(event) => setResponsibleFilter(event.target.value)}
                  className="w-full rounded-xl border border-white/5 bg-slate-950 px-3 py-2 text-2xs font-black text-white outline-none focus:border-cyan-500/50"
                >
                  <option value="todos">Todos responsaveis</option>
                  {responsibleOptions.map((responsible) => (
                    <option key={responsible.id} value={responsible.id}>{responsible.name}</option>
                  ))}
                  {conversations.some((conversation) => !conversation.responsibleProfileId) && (
                    <option value="sem_responsavel">Sem responsavel</option>
                  )}
                </select>
              )}

              <select
                value={stageFilter}
                onChange={(event) => setStageFilter(event.target.value)}
                aria-label="Filtrar conversas por etapa do funil"
                className="w-full rounded-xl border border-white/5 bg-slate-950 px-3 py-2 text-2xs font-black text-white outline-none focus:border-cyan-500/50"
              >
                <option value="todos">Todas as etapas do funil</option>
                {kanbanStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.label}</option>
                ))}
              </select>

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
            <div className="flex-1 overflow-y-auto divide-y divide-white/2">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="animate-spin text-cyan-400" size={24} />
                </div>
              ) : inboxError && conversations.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-3 px-5 text-center">
                  <MessageSquare size={22} className="text-amber-400" />
                  <p className="text-[10px] font-bold leading-relaxed text-slate-400">{inboxError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchInbox()}
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/20"
                  >
                    Carregar novamente
                  </button>
                </div>
              ) : filteredConversations.length > 0 ? (
                filteredConversations.map((c) => {
                  const isActive = selectedConversation?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        selectedConversationRef.current = c;
                        setSelectedConversation(c);
                        setDetailsPanelOpen(false);
                      }}
                      aria-current={isActive ? 'true' : undefined}
                      className={`w-full flex items-start gap-3 p-4 text-left transition-all ${
                        isActive ? 'bg-cyan-600/10 border-l-4 border-cyan-500' : 'hover:bg-white/2'
                      }`}
                    >
                      {/* Avatar */}
                      <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 border border-white/10 flex items-center justify-center text-xs font-black uppercase text-white shrink-0 shadow-lg">
                        {cleanInboxDisplayName(c.nome_contato, c.telefone).slice(0, 2) || 'CT'}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs font-black text-white truncate block">{cleanInboxDisplayName(c.nome_contato, c.telefone)}</span>
                          <span className="orion-inbox-conversation-time text-[9px] font-bold text-slate-500 shrink-0">
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
                          {c.leadStatus && (
                            <span className="ml-auto max-w-[110px] truncate rounded-md border border-cyan-500/15 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] font-black text-cyan-300">
                              {getKanbanStageLabel(kanbanStages, normalizeLeadStatus(c.leadStatus))}
                            </span>
                          )}
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
          <div className={`orion-inbox-chat ${selectedConversation ? 'flex' : 'hidden lg:flex'} min-w-0 flex-col bg-[#050b16] border-r border-white/5 h-full overflow-hidden`}>
            {selectedConversation ? (
              <>
                {/* Header do chat */}
                  <div className="orion-inbox-chat-header border-b border-white/5 bg-slate-900/30 shrink-0 p-3 sm:p-4">
                  <div className="orion-inbox-chat-title space-y-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedConversation(null);
                          setDetailsPanelOpen(false);
                        }}
                        className="lg:hidden -ml-1 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
                        aria-label="Voltar para conversas"
                      >
                        <ArrowLeft size={18} />
                      </button>
                      <h2 className="text-sm font-black text-white">{cleanInboxDisplayName(selectedConversation.nome_contato, selectedConversation.telefone)}</h2>
                      <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[8px] font-black uppercase text-emerald-400 tracking-wider">
                        Expira em {selectedConversation.expirationTime}
                      </span>
                    </div>
                    <div className="hidden sm:flex flex-wrap items-center gap-2 text-[9px] font-bold text-slate-500">
                      <span>Nº PROTOCOLO: {selectedConversation.protocolNumber}</span>
                      <span>•</span>
                      <span>Canal: Comercial | {selectedConversation.agentName}</span>
                    </div>
                  </div>
                  <div className="orion-inbox-chat-actions -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
                    <button
                      type="button"
                      onClick={() => { setLeadDetailsOpen(true); setDetailsPanelOpen(true); }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-500/20 xl:hidden"
                    >
                      <PanelRight size={13} />
                      Dados do lead
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedConversation?.lead_id) {
                          alert('Esta conversa não possui um Lead associado.');
                          return;
                        }
                        setShowForwardModal(true);
                      }}
                      className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 border border-cyan-500/10 text-[9px] font-black uppercase tracking-wider text-white transition-all cursor-pointer"
                    >
                      Encaminhar para Responsável
                    </button>
                    <button
                      onClick={() => selectedConversation.status === 'fechada'
                        ? void updateConversationStatus('aberta')
                        : handleEndChat()}
                      className={`shrink-0 min-h-10 whitespace-nowrap rounded-xl border px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${selectedConversation.status === 'fechada' ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10' : 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10'}`}
                    >
                      {selectedConversation.status === 'fechada' ? 'Reabrir' : 'Encerrar'}
                    </button>
 
                    {/* Header Action Icons Toolbar */}
                    <div className="hidden">
                      <button onClick={handleShare} className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Compartilhar conversa">
                        <Share2 size={13} />
                      </button>
                      <button 
                        onClick={() => {
                          setShowSearchChat(!showSearchChat);
                          if (showSearchChat) setSearchChatQuery('');
                        }} 
                        className={`p-1.5 transition-colors cursor-pointer rounded-lg ${showSearchChat ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20' : 'text-slate-400 hover:text-white'}`}
                        title="Pesquisar mensagens"
                      >
                        <Search size={13} />
                      </button>
                      
                      {(profile?.tipo_usuario === 'admin' || profile?.tipo_usuario === 'corretor' || profile?.tipo_usuario === 'corretor_admin') && (
                        <>
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
                          <button
                            onClick={() => setShowBotConfigModal(true)}
                            className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer rounded-lg hover:bg-white/5"
                            title="Configurar Fluxos do Apolo Bot"
                          >
                            <Settings size={13} />
                          </button>
                        </>
                      )}

                      <button onClick={handleBlockContact} className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer" title="Bloquear contato">
                        <Ban size={13} />
                      </button>
                      <button 
                        onClick={() => {
                          if (!selectedConversation?.lead_id) {
                            alert('Esta conversa não possui um Lead associado no CRM.');
                          } else {
                            setEditingTaskId(null);
                            setTaskTitle('');
                            setTaskDueDate('');
                            setTaskDueTime('09:00');
                            setTaskPriority('normal');
                            setTaskResponsibleProfileId('');
                            setShowTaskModal(true);
                          }
                        }} 
                        className={`p-1.5 transition-colors cursor-pointer rounded-lg ${showTaskModal ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20' : 'text-slate-400 hover:text-white'}`}
                        title="Agendar contato"
                      >
                        <Calendar size={13} />
                      </button>
                      <button onClick={() => setShowHistoryModal(true)} className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Histórico de chamados">
                        <History size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Local search bar if toggled */}
                {showSearchChat && (
                  <div className="bg-slate-900/40 border-b border-white/5 px-4 py-2.5 flex items-center gap-2 animate-in slide-in-from-top-1 duration-100 shrink-0">
                    <Search size={13} className="text-slate-500 shrink-0" />
                    <input
                      type="text"
                      placeholder="Pesquisar nas mensagens deste chat..."
                      value={searchChatQuery}
                      onChange={(e) => setSearchChatQuery(e.target.value)}
                      className="flex-1 bg-transparent border-none text-2xs font-bold text-white placeholder-slate-500 focus:outline-none"
                    />
                    {searchChatQuery && (
                      <button onClick={() => setSearchChatQuery('')} className="text-[10px] text-slate-500 hover:text-white font-bold uppercase tracking-wider">
                        Limpar
                      </button>
                    )}
                  </div>
                )}

                {/* Mensagens list */}
                <div className="orion-inbox-messages flex-1 overflow-y-auto bg-[#050b16] p-3 sm:p-5 space-y-3 sm:space-y-4">
                  {loadingMessages ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="animate-spin text-cyan-400" size={24} />
                    </div>
                  ) : displayChatMessages.length > 0 ? (
                    displayChatMessages.map((message, index) => {
                      const isMine = message.direction === 'outbound';
                      const isPlaying = playingAudioId === message.id;
                      const isLoading = loadingAudioId === message.id;
                      const mediaKind = getMessageMediaKind(message);
                      const media = mediaUrls[message.id];
                      const isMediaLoading = loadingMediaId === message.id;
                      const mediaError = Boolean(mediaLoadErrors[message.id]);
                      const fileName = media?.fileName || getMessageFileName(message) || 'Arquivo anexado';
                      const mediaCaption = getMessageMediaCaption(message, fileName);
                      const previousMessage = displayChatMessages[index - 1];
                      const showDaySeparator = !previousMessage || messageDayKey(previousMessage.created_at) !== messageDayKey(message.created_at);
                      return (
                        <div key={message.id} className="space-y-4">
                          {showDaySeparator && (
                            <div className="flex justify-center">
                              <span className="orion-inbox-day-separator rounded-lg border border-white/10 bg-slate-800/90 px-3 py-1 text-[10px] font-bold text-slate-200 shadow-lg">
                                {formatMessageDay(message.created_at)}
                              </span>
                            </div>
                          )}
                          <div className={`flex min-w-0 max-w-full ${isMine ? 'justify-end' : 'justify-start'} animate-in fade-in-50 duration-200`}>
                          <div className={`orion-inbox-message-bubble relative min-w-0 max-w-[86%] sm:max-w-[75%] rounded-[1.25rem] sm:rounded-[1.5rem] p-3 sm:p-3.5 shadow-lg space-y-1.5 ${
                            mediaKind === 'call'
                              ? isMine
                                ? 'bg-emerald-600 text-white rounded-tr-none'
                                : 'bg-slate-900 border border-emerald-500/30 text-slate-100 rounded-tl-none'
                              : isMine 
                                ? 'bg-cyan-600 text-white rounded-tr-none' 
                                : 'bg-slate-900 border border-white/5 text-slate-100 rounded-tl-none'
                          }`}>
                            {/* Se for áudio */}
                            {mediaKind === 'audio' ? (
                              audioUrls[message.id] ? (
                                <div className="min-w-[260px] max-w-full space-y-1.5">
                                  <span className="block text-[10px] font-black uppercase tracking-wider">Mensagem de voz</span>
                                  <audio
                                    controls
                                    autoPlay
                                    preload="metadata"
                                    src={audioUrls[message.id]}
                                    className="h-10 w-full max-w-[340px] [color-scheme:dark]"
                                    onPlay={() => setPlayingAudioId(message.id)}
                                    onPause={() => setPlayingAudioId((current) => current === message.id ? null : current)}
                                    onEnded={() => setPlayingAudioId((current) => current === message.id ? null : current)}
                                  >
                                    Seu navegador nao suporta audio.
                                  </audio>
                                </div>
                              ) : <div className="flex items-center gap-3">
                                <button
                                  onClick={() => handlePlayAudio(message.id)}
                                  className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all border cursor-pointer ${
                                    isMine 
                                      ? 'bg-white/10 hover:bg-white/20 text-white border-white/10' 
                                      : 'bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-400 border-cyan-500/20'
                                  }`}
                                >
                                  {isLoading ? (
                                    <div className={`h-3 w-3 rounded-full border-2 border-t-transparent animate-spin ${isMine ? 'border-white' : 'border-cyan-400'}`} />
                                  ) : isPlaying ? (
                                    <Pause size={12} fill="currentColor" />
                                  ) : (
                                    <Play size={12} className="ml-0.5" fill="currentColor" />
                                  )}
                                </button>
                                <div className="space-y-0.5">
                                  <span className="text-[10px] font-black uppercase tracking-wider block">Mensagem de Voz</span>
                                  <span className={`text-[8px] font-bold block ${isMine ? 'text-cyan-200' : 'text-slate-400'}`}>
                                    {isPlaying ? 'Tocando...' : (message.audioDuration || '00:00')}
                                  </span>
                                </div>
                                {renderAudioWaveform(isPlaying)}
                              </div>
                            ) : mediaKind === 'call' ? (
                              <div className="flex min-w-56 items-center gap-3">
                                <div className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${
                                  isMine ? 'bg-white text-emerald-700' : 'bg-emerald-500/20 text-emerald-300'
                                }`}>
                                  <PhoneCall size={17} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-black">
                                    {message.mensagem.split('\n')[0] || 'Ligação de voz'}
                                  </p>
                                  {message.metadata?.descricao ? (
                                    <p className={`text-[10px] font-semibold mt-0.5 leading-normal ${isMine ? 'text-emerald-100/95' : 'text-slate-350'}`}>
                                      {message.metadata.descricao}
                                    </p>
                                  ) : message.mensagem.includes('\n') ? (
                                    <p className={`text-[10px] font-bold mt-0.5 leading-normal ${isMine ? 'text-emerald-100/90' : 'text-slate-400'}`}>
                                      {message.mensagem.split('\n').slice(1).join('\n')}
                                    </p>
                                  ) : null}
                                  {message.metadata?.isBrokerCall ? (
                                    <p className={`text-[9px] font-bold leading-normal truncate mt-0.5 ${isMine ? 'text-emerald-100/70' : 'text-slate-500'}`}>
                                      Iniciada por {message.metadata.brokerName}
                                    </p>
                                  ) : !isMine ? (
                                    <p className="text-[9px] font-bold leading-normal mt-0.5 text-slate-500">
                                      Chamada recebida
                                    </p>
                                  ) : (
                                    <p className={`text-[9px] font-bold leading-normal mt-0.5 ${isMine ? 'text-emerald-100/70' : 'text-slate-400'}`}>
                                      Faça ligações com o app para Windows
                                    </p>
                                  )}
                                  <p className={`orion-inbox-message-time text-[8px] font-semibold mt-0.5 ${isMine ? 'text-emerald-200/60' : 'text-slate-500'}`}>
                                    {formatHour(message.created_at)}
                                  </p>
                                </div>
                              </div>
                            ) : mediaKind === 'image' ? (
                              <button
                                type="button"
                                onClick={() => openMessageMedia(message)}
                                className="block w-full text-left"
                              >
                                {media?.url ? (
                                  <img
                                    src={media.url}
                                    alt={fileName}
                                    className="max-h-72 w-full rounded-2xl border border-white/10 bg-black/20 object-cover"
                                  />
                                ) : (
                                  <div className={`flex min-w-48 items-center gap-3 rounded-2xl border p-3 transition ${
                                    isMine ? 'border-white/15 bg-white/10 hover:bg-white/15' : 'border-cyan-500/20 bg-cyan-950/20 hover:bg-cyan-950/35'
                                  }`}>
                                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/20">
                                      {isMediaLoading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                                    </div>
                                    <div>
                                      <p className="text-xs font-black">Imagem</p>
                                      <p className={`text-[9px] font-bold ${isMine ? 'text-cyan-100' : 'text-slate-400'}`}>
                                        {isMediaLoading ? 'Carregando...' : mediaError ? 'Midia indisponivel. Tentar novamente' : 'Clique para visualizar'}
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </button>
                            ) : mediaKind === 'video' ? (
                              <div className="space-y-2">
                                {media?.url ? (
                                  <video controls src={media.url} className="max-h-72 w-full rounded-2xl border border-white/10 bg-black/20" />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openMessageMedia(message)}
                                    className={`flex min-w-48 items-center gap-3 rounded-2xl border p-3 text-left transition ${
                                      isMine ? 'border-white/15 bg-white/10 hover:bg-white/15' : 'border-cyan-500/20 bg-cyan-950/20 hover:bg-cyan-950/35'
                                    }`}
                                  >
                                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/20">
                                      {isMediaLoading ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
                                    </div>
                                    <div>
                                      <p className="text-xs font-black">Video</p>
                                      <p className={`text-[9px] font-bold ${isMine ? 'text-cyan-100' : 'text-slate-400'}`}>
                                        {isMediaLoading ? 'Carregando...' : mediaError ? 'Midia indisponivel. Tentar novamente' : 'Clique para abrir'}
                                      </p>
                                    </div>
                                  </button>
                                )}
                              </div>
                            ) : mediaKind === 'file' ? (
                              <div className="min-w-0 max-w-full space-y-2">
                                <button
                                  type="button"
                                  onClick={() => openMessageMedia(message)}
                                  className={`flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-2xl border p-3 text-left transition ${
                                    isMine ? 'border-white/15 bg-white/10 hover:bg-white/15' : 'border-cyan-500/20 bg-cyan-950/20 hover:bg-cyan-950/35'
                                  }`}
                                >
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/20">
                                    {isMediaLoading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-black" title={fileName}>{fileName}</p>
                                    <p className={`text-[9px] font-bold ${isMine ? 'text-cyan-100' : 'text-slate-400'}`}>
                                      {isMediaLoading ? 'Carregando...' : mediaError ? 'Midia indisponivel. Tentar novamente' : 'Clique para abrir arquivo'}
                                    </p>
                                  </div>
                                  <Download size={14} className="shrink-0 opacity-80" />
                                </button>
                                {mediaCaption ? (
                                  <p className="whitespace-pre-wrap break-words text-xs font-bold leading-normal [overflow-wrap:anywhere]">
                                    {mediaCaption}
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <p className="orion-inbox-message-body whitespace-pre-wrap break-words text-xs font-bold leading-normal [overflow-wrap:anywhere]">{message.mensagem}</p>
                            )}
                            <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-wider">
                              <span className={isMine ? 'text-cyan-200' : 'text-slate-500'}>
                                {cleanInboxDisplayName(message.remetente || selectedConversation.nome_contato, selectedConversation.telefone)}
                              </span>
                              <span className={`orion-inbox-message-time flex items-center gap-1 ${isMine ? 'text-cyan-200' : 'text-slate-500'}`}>
                                {(() => {
                                  const recibo = reciboDaMensagem(message);
                                  if (!recibo) return null;
                                  return (
                                    <span
                                      className={recibo.alerta ? 'text-amber-300' : 'text-cyan-200/80'}
                                      title={recibo.alerta
                                        ? 'O WhatsApp nao confirmou a entrega desta mensagem. Confira a conexao do numero antes de considerar enviada.'
                                        : `WhatsApp confirmou: ${recibo.texto}`}
                                    >
                                      {recibo.alerta ? '! ' : ''}{recibo.texto}
                                    </span>
                                  );
                                })()}
                                {formatHour(message.created_at)}
                              </span>
                            </div>
                            {message.reactions?.length ? (
                              <div className={`absolute -bottom-3 ${isMine ? 'right-3' : 'left-3'} flex items-center rounded-full border border-white/10 bg-slate-800 px-2 py-0.5 text-sm shadow-lg`}>
                                {message.reactions.join(' ')}
                              </div>
                            ) : null}
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
                  <div ref={messagesEndRef} />
                </div>

                {/* Rodapé de envio de mensagens */}
                {selectedConversation.status === 'fechada' ? (
                  <div className="orion-inbox-composer flex items-center justify-between gap-3 border-t border-emerald-500/10 bg-emerald-950/10 p-3 sm:p-4 shrink-0">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Conversa encerrada</p>
                      <p className="mt-1 text-[10px] font-semibold text-slate-500">O histórico está preservado. Reabra para voltar a enviar mensagens.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void updateConversationStatus('aberta')}
                      className="min-h-11 shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      Reabrir conversa
                    </button>
                  </div>
                ) : (
                <div className="orion-inbox-composer p-2.5 sm:p-4 border-t border-white/5 bg-[#050b16] shrink-0">
                  
                  {/* Visualizadores de Anexos */}
                  {selectedAttachments.length > 0 && (
                    <div className="mb-3 grid gap-2">
                      {selectedAttachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center justify-between rounded-2xl border border-cyan-500/10 bg-cyan-950/20 p-3 shadow-md animate-in fade-in-50">
                          <div className="flex min-w-0 items-center gap-3">
                            {attachment.file.type.startsWith('image/') ? (
                              <img src={attachment.preview} alt="Preview" className="h-10 w-10 rounded-xl object-cover" />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-cyan-400 border border-white/5">
                                <Paperclip size={16} />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-black text-white truncate max-w-[260px]">{attachment.file.name}</p>
                              <p className="text-[9px] font-bold text-slate-500 uppercase">
                                {(attachment.file.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                            className="p-1 bg-white/5 hover:bg-rose-500/10 hover:text-rose-400 rounded-full text-slate-400 transition-all cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
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
                        {renderAudioWaveform(true)}
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
                    <div className="relative flex items-end gap-1.5 sm:gap-2 shrink-0 pb-1">
                      {/* Media/Tools Icons */}
                      <div className="flex items-center gap-0.5 sm:gap-1 mb-1">
                        <label className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 cursor-pointer flex items-center justify-center shrink-0">
                          <Paperclip size={16} />
                          <input
                            type="file"
                            multiple
                            onChange={handleFileChange}
                            className="hidden"
                            accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker((current) => !current)}
                          className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 cursor-pointer shrink-0"
                        >
                          <Smile size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowTemplateModal(true)}
                          className="hidden"
                          title="Mensagens Rápidas"
                        >
                          <FileText size={16} />
                        </button>
                      </div>

                      {showEmojiPicker && (
                        <div className="absolute bottom-20 left-16 z-30 grid grid-cols-6 gap-1 rounded-2xl border border-white/10 bg-slate-950 p-2 shadow-2xl">
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                setMessageText((current) => `${current}${emoji}`);
                                setShowEmojiPicker(false);
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-xl text-base hover:bg-white/10"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Text Input */}
                      <textarea
                        ref={composerRef}
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.keyCode === 13) && !e.shiftKey) {
                            e.preventDefault();
                            void sendMessage();
                          }
                        }}
                        rows={1}
                        placeholder='Digite "/" para respostas rápidas ou escreva uma'
                        className="min-w-0 flex-1 bg-slate-950 border border-white/5 rounded-2xl px-3 sm:px-4 py-3 text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 resize-none transition-all duration-100 overflow-y-auto"
                        style={{ height: '44px' }}
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
                        disabled={!isWhatsAppConnected || sendingMessage || (!messageText.trim() && selectedAttachments.length === 0)}
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
                )}
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
          {detailsPanelOpen && <button type="button" aria-label="Fechar dados do lead" onClick={() => setDetailsPanelOpen(false)} className="fixed inset-0 z-[90] bg-slate-950/65 xl:hidden" />}
          <div className={`orion-inbox-details fixed bottom-0 right-0 top-0 sm:top-[72px] z-[100] flex w-[min(380px,100vw)] flex-col space-y-6 overflow-y-auto border-l border-white/10 bg-[#07111f] p-5 shadow-2xl transition-transform duration-200 xl:static xl:z-auto xl:h-full xl:w-auto xl:translate-x-0 xl:border-l-0 xl:bg-slate-900/20 xl:shadow-none ${detailsPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex items-center justify-between border-b border-white/5 pb-3 xl:hidden">
              <span className="text-xs font-black uppercase tracking-wider text-white">Dados do lead</span>
              <button type="button" onClick={() => setDetailsPanelOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Fechar painel"><X size={16} /></button>
            </div>
            {selectedConversation ? (
              <>
                {/* Status do Lead no CRM */}
                <div className="space-y-2 shrink-0 border-b border-white/5 pb-4">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Status no CRM / Leads</label>
                  {loadingLead ? (
                    <div className="flex items-center gap-2 text-2xs text-slate-500">
                      <Loader2 size={12} className="animate-spin text-cyan-400" />
                      <span>Carregando status do CRM...</span>
                    </div>
                  ) : (
                    <select
                      value={normalizeLeadStatus(leadStatus)}
                      onChange={(e) => handleUpdateLeadStatus(e.target.value)}
                      className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white font-black uppercase tracking-wider focus:outline-none focus:border-cyan-500/50"
                    >
                      {leadStatus && !kanbanStages.some((stage) => stage.id === leadStatus) && (
                        <option value={leadStatus}>{leadStatus}</option>
                      )}
                      {kanbanStages.map((stage) => (
                        <option key={stage.id} value={stage.id}>{getKanbanStageLabel(kanbanStages, stage.id)}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Dados do Lead */}
                {leadInfo && (
                  <div className="shrink-0 border-b border-white/5 pb-4">
                    <button
                      type="button"
                      onClick={() => setLeadDetailsOpen((current) => !current)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-950/45 px-3.5 py-3 text-left transition hover:border-cyan-500/25 hover:bg-slate-950/70"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Dados do lead</span>
                          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-cyan-300">
                            {leadDetailsOpen ? 'Editando' : 'Ver dados'}
                          </span>
                        </div>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`shrink-0 text-slate-400 transition-transform ${leadDetailsOpen ? 'rotate-180 text-cyan-300' : ''}`}
                      />
                    </button>

                    {leadDetailsOpen && (
                      <div className="mt-3 grid grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <EditableLeadInfoCard key={`${leadInfo.id}-idades`} label="Idade" field="idades" value={leadInfo.idades || ''} onSave={handleUpdateLeadField} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-tem_plano_ativo`} label="Plano ativo" field="tem_plano_ativo" value={normalizePlanoAtivo(leadInfo.tem_plano_ativo)} onSave={handleUpdateLeadField} options={['Sim', 'Nao', 'Nao informado']} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-possui_cnpj`} label="Possui CNPJ?" field="possui_cnpj" value={normalizeCnpjOwnership(leadInfo.possui_cnpj)} onSave={handleUpdateLeadField} options={['Sim', 'Nao', 'Tenho MEI', 'Nao informado']} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-cnpj`} label="CNPJ" field="cnpj" value={leadInfo.cnpj || ''} onSave={handleUpdateLeadField} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-plano_atual`} label="Plano atual" field="plano_atual" value={leadInfo.plano_atual || ''} onSave={handleUpdateLeadField} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-investimento`} label="Investimento" field="investimento" value={leadInfo.investimento || ''} onSave={handleUpdateLeadField} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-cidade`} label="Cidade" field="cidade" value={leadInfo.cidade || ''} onSave={handleUpdateLeadField} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-operadora`} label="Pagina" field="operadora" value={leadInfo.operadora || ''} onSave={handleUpdateLeadField} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-origem`} label="Origem" field="origem" value={leadInfo.origem || ''} onSave={handleUpdateLeadField} />
                        <EditableLeadInfoCard key={`${leadInfo.id}-email`} label="E-mail" field="email" value={leadInfo.email || ''} onSave={handleUpdateLeadField} className="col-span-2" />
                        <EditableLeadInfoCard key={`${leadInfo.id}-motivo_busca`} label="Motivo da busca" field="motivo_busca" value={leadInfo.motivo_busca || ''} onSave={handleUpdateLeadField} className="col-span-2" multiline />
                        <EditableLeadInfoCard key={`${leadInfo.id}-hospital_preferencia`} label="Hospital/Regiao" field="hospital_preferencia" value={leadInfo.hospital_preferencia || ''} onSave={handleUpdateLeadField} className="col-span-2" multiline />
                        <EditableLeadInfoCard key={`${leadInfo.id}-observacoes`} label="Observacoes" field="observacoes" value={leadInfo.observacoes || ''} onSave={handleUpdateLeadField} className="col-span-2" multiline />
                      </div>
                    )}
                  </div>
                )}


                {/* Follow-up / Tasks */}
                <div className="space-y-3 shrink-0 border-b border-white/5 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Follow-up</label>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedConversation?.lead_id) return;
                          window.location.href = `/tarefas?lead=${encodeURIComponent(selectedConversation.lead_id)}`;
                        }}
                        disabled={!selectedConversation?.lead_id}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <CheckCircle2 size={11} />
                        Ver tarefas
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedConversation?.lead_id) return;
                          window.location.href = `/crm?lead=${encodeURIComponent(selectedConversation.lead_id)}`;
                        }}
                        disabled={!selectedConversation?.lead_id}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ExternalLink size={11} />
                        Abrir no Kanban
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] px-3 py-2.5">
                    {highlightedTask ? (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[8px] font-black uppercase tracking-widest text-cyan-300">
                            {isOpenLeadTask(highlightedTask) ? 'Tarefa ativa' : 'Última tarefa'}
                          </p>
                          <p className="mt-1 truncate text-xs font-black text-white">{highlightedTask.titulo}</p>
                          <p className="mt-1 text-[9px] font-bold text-slate-500">
                            {highlightedTask.vencimento ? formatActivityDate(highlightedTask.vencimento) : 'Sem prazo definido'}
                            {highlightedTask.prioridade ? ` · ${highlightedTask.prioridade}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <button type="button" onClick={() => openTaskEditor(highlightedTask)} className="rounded-lg border border-cyan-500/20 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/10" title="Editar tarefa">Editar</button>
                          {isOpenLeadTask(highlightedTask) && (
                            <button
                              type="button"
                              onClick={() => void completeReminder(highlightedTask)}
                              disabled={savingTask}
                              className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50"
                              title="Concluir tarefa"
                            >
                              {savingTask ? <Loader2 size={9} className="animate-spin" /> : <CheckCircle2 size={9} />}
                              Marcar concluído
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] font-bold text-slate-500">Nenhuma tarefa registrada para este lead.</p>
                    )}
                  </div>

                  <form onSubmit={handleScheduleTask} className="rounded-2xl border border-white/5 bg-slate-950/45 p-3 space-y-2.5">
                    <input
                      type="text"
                      placeholder="Ex: Retornar cotacao"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                    />
                    <div className="grid grid-cols-[1fr_92px] gap-2">
                      <input
                        type="date"
                        value={taskDueDate}
                        onChange={(e) => setTaskDueDate(e.target.value)}
                        className="min-w-0 bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                      />
                      <input
                        type="time"
                        value={taskDueTime}
                        onChange={(e) => setTaskDueTime(e.target.value)}
                        className="min-w-0 bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <select
                        value={taskPriority}
                        onChange={(e) => setTaskPriority(e.target.value)}
                        className="min-w-0 bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                      >
                        <option value="normal">Normal</option>
                        <option value="alta">Alta</option>
                        <option value="baixa">Baixa</option>
                      </select>
                      {canManageTaskResponsible && taskResponsibleOptions.length > 0 && (
                        <select
                          value={taskResponsibleProfileId || leadInfo?.responsavel_profile_id || profile?.id || ''}
                          onChange={(e) => setTaskResponsibleProfileId(e.target.value)}
                          className="min-w-0 bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                        >
                          <option value="">Sem responsavel</option>
                          {taskResponsibleOptions.map((member) => (
                            <option key={member.profile_id} value={member.profile_id}>{member.nome || member.email || 'Sem nome'}</option>
                          ))}
                        </select>
                      )}
                      <button
                        type="submit"
                        disabled={savingTask || !selectedConversation?.lead_id}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-cyan-600 px-3 text-[9px] font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-950/20 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                        title={!selectedConversation?.lead_id ? 'Esta conversa nao possui lead associado' : 'Criar tarefa'}
                      >
                        {savingTask ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                        Criar
                      </button>
                    </div>
                  </form>
                </div>

                {/* Tags manager */}
                <div className="space-y-2 shrink-0">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Etiquetas</label>
                  <select
                    value={selectedTag}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '__nova_etiqueta__') {
                        const novaEtiqueta = window.prompt('Nome da nova etiqueta');
                        if (novaEtiqueta?.trim()) handleAddTag(novaEtiqueta);
                      } else {
                        handleAddTag(value);
                      }
                      setSelectedTag('');
                    }}
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="">Selecione uma etiqueta...</option>
                    <option value="__nova_etiqueta__">+ Adicionar etiqueta</option>
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

                {/* Internal Notes */}
                <div className="space-y-2 flex-1 flex flex-col min-h-[160px]">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Anotações Internas</label>
                  
                  {/* Notes input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Anotar ou registrar ligação..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { 
                        if (e.key === 'Enter') handleAddNote(); 
                      }}
                      className="flex-1 bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs text-white focus:outline-none focus:border-cyan-500/50"
                    />
                    <button
                      type="button"
                      onClick={handleAddNote}
                      title="Salvar como Anotação Interna"
                      className="h-8 w-8 bg-cyan-600/20 border border-cyan-500/20 hover:bg-cyan-600 hover:text-white text-cyan-400 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={handleLogManualCall}
                      title="Registrar Ligação Efetuada"
                      className="h-8 w-8 bg-emerald-600/20 border border-emerald-500/20 hover:bg-emerald-600 hover:text-white text-emerald-400 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0"
                    >
                      <Phone size={13} />
                    </button>
                  </div>

                  {/* Notes list */}
                  <div className="flex-1 overflow-y-auto bg-slate-950/40 border border-white/5 p-3 rounded-2xl space-y-2 max-h-[140px]">
                    {internalNotes.length > 0 ? (
                      internalNotes.map((note) => (
                        <div key={note.id} className="bg-slate-950 p-2.5 rounded-xl border border-white/2 text-[10px] font-bold text-slate-300 leading-normal relative group">
                          <button
                            type="button"
                            onClick={() => handleDeleteActivity(note.id)}
                            className="absolute top-2 right-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            title="Excluir anotação"
                          >
                            <Trash2 size={11} />
                          </button>
                          <p className="pr-4">{note.text}</p>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-[8px] font-black uppercase tracking-widest text-cyan-400">{formatActivityDate(note.createdAt)}</span>
                            {note.author && (
                              <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider">
                                por {note.author}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex items-center justify-center text-center text-[10px] text-slate-500 uppercase tracking-widest font-black py-4">
                        Nenhuma anotação
                      </div>
                    )}
                  </div>
                </div>

                {/* Histórico de Ligações */}
                <div className="space-y-2 flex-1 flex flex-col min-h-[160px] border-t border-white/5 pt-4">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Histórico de Ligações</label>
                  <div className="flex-1 overflow-y-auto bg-slate-950/40 border border-white/5 p-3 rounded-2xl space-y-2 max-h-[140px]">
                    {leadActivities.filter((act) => act.tipo === 'ligacao').length > 0 ? (
                      leadActivities
                        .filter((act) => act.tipo === 'ligacao')
                        .map((act) => (
                          <div key={act.id} className="bg-slate-950 p-2.5 rounded-xl border border-white/2 text-[10px] font-bold text-slate-300 leading-normal space-y-1 relative group">
                            <button
                              type="button"
                              onClick={() => handleDeleteActivity(act.id)}
                              className="absolute top-2.5 right-2.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                              title="Excluir ligação"
                            >
                              <Trash2 size={11} />
                            </button>
                            <div className="flex items-center justify-between gap-2 pr-4">
                              <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">Ligação Efetuada</span>
                              {act.profiles?.nome && (
                                <span className="text-[8px] font-bold text-slate-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  {act.profiles.nome}
                                </span>
                              )}
                            </div>
                            <p className="text-3xs text-slate-400 leading-normal pr-4">{act.descricao || 'Chamada efetuada.'}</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{formatActivityDate(act.created_at)}</p>
                          </div>
                        ))
                    ) : (
                      <div className="h-full flex items-center justify-center text-center text-[10px] text-slate-500 uppercase tracking-widest font-black py-4">
                        Nenhuma ligação registrada
                      </div>
                    )}
                  </div>
                </div>

                {/* Custom attributes editable section */}
                <div className="space-y-3.5 shrink-0 border-t border-white/5 pt-4">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">Campos Personalizados</label>
                  
                  {/* Inputs for custom key-value addition */}
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Nome do campo (Ex: Profissão)"
                      value={customFieldName}
                      onChange={(e) => setCustomFieldName(e.target.value)}
                      className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs text-white focus:outline-none focus:border-cyan-500/50"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Valor do campo (Ex: Médico)"
                        value={customFieldValue}
                        onChange={(e) => setCustomFieldValue(e.target.value)}
                        className="flex-1 bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs text-white focus:outline-none focus:border-cyan-500/50"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomField}
                        className="h-8 w-8 bg-cyan-600/20 border border-cyan-500/20 hover:bg-cyan-600 hover:text-white text-cyan-400 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Custom fields list */}
                  <div className="space-y-2 mt-2">
                    {selectedConversation.customFields && selectedConversation.customFields.length > 0 ? (
                      selectedConversation.customFields.map((field, idx) => (
                        <div key={idx} className="bg-slate-950 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">{field.key}</span>
                            <span className="text-xs font-black text-white block mt-0.5 truncate">{field.value}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveCustomField(field.key)}
                            className="p-1 bg-white/5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-xl transition-all cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-[10px] text-slate-500 uppercase tracking-widest font-black py-2">
                        Nenhum campo personalizado
                      </div>
                    )}
                  </div>
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

      {/* ================= MODAL: CONFIGURAÇÃO DO APOLO BOT (MANYCHAT STYLE) ================= */}
      {showBotConfigModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 text-white">
            
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Bot size={22} className="text-cyan-400 animate-pulse" />
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-white">Configurações do Apolo Bot</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Construa fluxos automáticos de primeiro contato e respostas rápidas</p>
                </div>
              </div>
              <button
                onClick={() => setShowBotConfigModal(false)}
                className="h-9 w-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Sidebar: Configurations */}
              <div className="w-[320px] border-r border-white/5 p-6 space-y-6 overflow-y-auto shrink-0 bg-slate-950/20">
                <div className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Nome do Assistente (Bot)</span>
                  <input
                    type="text"
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                    className="w-full rounded-xl bg-slate-850 border border-white/5 px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-cyan-500 transition"
                    placeholder="Ex: Apolo Bot"
                  />
                </div>

                <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400">Primeiro Contato Ativo</span>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                    </span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 leading-normal">
                    Se ativado, assim que um novo lead entrar na fila "Aguardando", o bot iniciará o fluxo abaixo instantaneamente.
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input type="checkbox" defaultChecked className="h-4.5 w-4.5 rounded border-white/10 bg-slate-800 text-cyan-600 focus:ring-cyan-500" />
                    <span className="text-2xs font-extrabold uppercase text-slate-300">Autocomparador Ligado</span>
                  </label>
                </div>

                <div className="rounded-2xl border border-dashed border-white/5 p-4 space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Dica ManyChat</span>
                  <p className="text-3xs font-medium text-slate-500 leading-relaxed uppercase">
                    Utilize botões de múltipla escolha para direcionar o cliente comercialmente. Fluxos com opções têm 92% mais conversão que textos abertos longos.
                  </p>
                </div>
              </div>

              {/* Right Panel: Interactive Visual Builder */}
              <div className="flex-1 p-6 overflow-auto bg-slate-950 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:16px_16px] flex flex-col border-l border-white/5 relative">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-4 block">Visual Flow Canvas (Estilo ManyChat)</span>
                
                {/* Node Flowchart Rendering */}
                <div className="flex-1 flex flex-col items-center gap-6 select-none relative py-6">
                  
                  {/* Step 1 Card: Welcome message */}
                  <div className={`w-[480px] rounded-3xl border p-5 transition-all shadow-xl backdrop-blur-md ${
                    selectedFlowStepId === 'step_welcome' 
                      ? 'border-cyan-500 bg-slate-900/90 ring-4 ring-cyan-500/10' 
                      : 'border-white/5 bg-slate-950/80 hover:border-white/10'
                  }`}>
                    <div className="flex items-center justify-between gap-3 mb-3 border-b border-white/5 pb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-cyan-500 animate-pulse"></span>
                        <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400">Passo 1: Mensagem Inicial</span>
                      </div>
                      <button 
                        type="button"
                        onClick={() => setSelectedFlowStepId('step_welcome')}
                        className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                      >
                        Selecionar
                      </button>
                    </div>
 
                    <textarea
                      value={flowSteps.find(s => s.id === 'step_welcome')?.text || ''}
                      onChange={(e) => handleSaveStepText('step_welcome', e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-white/5 bg-slate-950 p-3 text-2xs font-semibold leading-relaxed text-slate-100 focus:border-cyan-500 focus:outline-none focus:ring-0 transition-colors"
                    />
 
                    {/* Quick Replies Buttons */}
                    <div className="mt-3 space-y-1.5">
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 block">Botões do Menu (Editar Opções)</span>
                      <div className="grid grid-cols-3 gap-2">
                        {(flowSteps.find(s => s.id === 'step_welcome')?.buttons || []).map((btn, idx) => (
                          <div key={idx} className="space-y-1 bg-slate-950/60 p-1.5 rounded-xl border border-white/5">
                            <input
                              type="text"
                              value={btn}
                              onChange={(e) => {
                                const newButtons = [...(flowSteps.find(s => s.id === 'step_welcome')?.buttons || [])];
                                newButtons[idx] = e.target.value;
                                setFlowSteps(current => current.map(step => step.id === 'step_welcome' ? { ...step, buttons: newButtons } : step));
                              }}
                              className="w-full bg-slate-950 border border-white/10 rounded px-1.5 py-0.5 text-center text-[8px] font-black text-white focus:border-cyan-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (idx === 0) setSelectedFlowStepId('step_simulate');
                                else if (idx === 1) setSelectedFlowStepId('step_agent');
                                else setSelectedFlowStepId('step_others');
                              }}
                              className="w-full block bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 text-cyan-400 rounded py-0.5 text-center text-[7px] font-black uppercase tracking-wide transition cursor-pointer"
                            >
                              Ver Ramo
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
 
                  {/* Visual Connector lines */}
                  <div className="h-6 w-0.5 bg-gradient-to-b from-cyan-500 to-slate-700 shrink-0"></div>
 
                  {/* Step 2 Card: Children flow preview */}
                  <div className="flex gap-4 flex-wrap justify-center">
                    {/* Flow card for Simulation Option */}
                    <div className={`w-[250px] rounded-2xl border p-4 transition-all shadow-lg backdrop-blur-md ${
                      selectedFlowStepId === 'step_simulate' 
                        ? 'border-cyan-500 bg-slate-900/90 ring-4 ring-cyan-500/10' 
                        : 'border-white/5 bg-slate-950/80 hover:border-white/10'
                    }`}>
                      <div className="flex items-center justify-between gap-3 mb-2.5 border-b border-white/5 pb-1.5">
                        <span className="text-[9px] font-black uppercase tracking-wider text-cyan-400">Ramo: Cotação</span>
                        <button 
                          type="button"
                          onClick={() => setSelectedFlowStepId('step_simulate')}
                          className="text-[8px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                        >
                          Selecionar
                        </button>
                      </div>
                      <textarea
                        value={flowSteps.find(s => s.id === 'step_simulate')?.text || ''}
                        onChange={(e) => handleSaveStepText('step_simulate', e.target.value)}
                        rows={2}
                        className="w-full resize-none rounded-lg border border-white/5 bg-slate-950 p-2.5 text-3xs font-bold leading-normal text-slate-100 focus:border-cyan-500 focus:outline-none focus:ring-0 transition-colors"
                      />
                      <div className="mt-2.5 space-y-1">
                        <span className="text-[7px] font-black uppercase tracking-widest text-slate-500 block">Opções Internas</span>
                        {(flowSteps.find(s => s.id === 'step_simulate')?.buttons || []).map((btn, bidx) => (
                          <input
                            key={bidx}
                            type="text"
                            value={btn}
                            onChange={(e) => {
                              const newButtons = [...(flowSteps.find(s => s.id === 'step_simulate')?.buttons || [])];
                              newButtons[bidx] = e.target.value;
                              setFlowSteps(current => current.map(step => step.id === 'step_simulate' ? { ...step, buttons: newButtons } : step));
                            }}
                            className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1 text-center text-[8px] font-bold text-slate-400 focus:border-cyan-500 focus:outline-none"
                          />
                        ))}
                      </div>
                    </div>
 
                    {/* Flow card for Human Agent Option */}
                    <div className={`w-[250px] rounded-2xl border p-4 transition-all shadow-lg backdrop-blur-md ${
                      selectedFlowStepId === 'step_agent' 
                        ? 'border-cyan-500 bg-slate-900/90 ring-4 ring-cyan-500/10' 
                        : 'border-white/5 bg-slate-950/80 hover:border-white/10'
                    }`}>
                      <div className="flex items-center justify-between gap-3 mb-2.5 border-b border-white/5 pb-1.5">
                        <span className="text-[9px] font-black uppercase tracking-wider text-cyan-400">Ramo: Atendente</span>
                        <button 
                          type="button"
                          onClick={() => setSelectedFlowStepId('step_agent')}
                          className="text-[8px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                        >
                          Selecionar
                        </button>
                      </div>
                      <textarea
                        value={flowSteps.find(s => s.id === 'step_agent')?.text || ''}
                        onChange={(e) => handleSaveStepText('step_agent', e.target.value)}
                        rows={2}
                        className="w-full resize-none rounded-lg border border-white/5 bg-slate-950 p-2.5 text-3xs font-bold leading-normal text-slate-100 focus:border-cyan-500 focus:outline-none focus:ring-0 transition-colors"
                      />
                      <div className="mt-2.5 text-center text-[7px] font-bold text-slate-500 uppercase tracking-widest p-1 border border-dashed border-white/5 rounded">
                        Fim de Automação
                      </div>
                    </div>
 
                    {/* Flow card for Others Option */}
                    <div className={`w-[250px] rounded-2xl border p-4 transition-all shadow-lg backdrop-blur-md ${
                      selectedFlowStepId === 'step_others' 
                        ? 'border-cyan-500 bg-slate-900/90 ring-4 ring-cyan-500/10' 
                        : 'border-white/5 bg-slate-950/80 hover:border-white/10'
                    }`}>
                      <div className="flex items-center justify-between gap-3 mb-2.5 border-b border-white/5 pb-1.5">
                        <span className="text-[9px] font-black uppercase tracking-wider text-cyan-400">Ramo: Outros</span>
                        <button 
                          type="button"
                          onClick={() => setSelectedFlowStepId('step_others')}
                          className="text-[8px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                        >
                          Selecionar
                        </button>
                      </div>
                      <textarea
                        value={flowSteps.find(s => s.id === 'step_others')?.text || ''}
                        onChange={(e) => handleSaveStepText('step_others', e.target.value)}
                        rows={2}
                        className="w-full resize-none rounded-lg border border-white/5 bg-slate-950 p-2.5 text-3xs font-bold leading-normal text-slate-100 focus:border-cyan-500 focus:outline-none focus:ring-0 transition-colors"
                      />
                      <div className="mt-2.5 text-center text-[7px] font-bold text-slate-500 uppercase tracking-widest p-1 border border-dashed border-white/5 rounded">
                        Fim de Automação
                      </div>
                    </div>
                  </div>
 
                </div>
              </div>
            </div>
 
            {/* Footer */}
            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex justify-between shrink-0">
              <span className="text-3xs font-bold text-slate-500 uppercase tracking-widest flex items-center">Apolo Bot Flow Builder v1.0.0</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowBotConfigModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-white/5 text-xs font-black uppercase tracking-wider text-slate-400 hover:bg-white/10 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('orion:apolo_bot_config', JSON.stringify({ botName, flowSteps }));
                  alert('Fluxo do Apolo Bot salvo com sucesso!');
                  setShowBotConfigModal(false);
                }}
                className="px-5 py-2.5 rounded-xl bg-cyan-600 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-600/10 hover:-translate-y-0.5 transition-all cursor-pointer"
              >
                Salvar Configuração
              </button>
            </div>
          </div>

        </div>
      </div>
      )}

      {/* ================= MODAL: MOTIVO DE ENCERRAMENTO OBRIGATÓRIO ================= */}
      {showCloseReasonModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 text-white">
            
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="text-amber-500 animate-pulse" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">Encerrar Atendimento</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Informe o motivo da finalização do chat</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <span className="text-2xs font-extrabold uppercase text-slate-400 block tracking-wider">Selecione o motivo:</span>
              <div className="grid gap-2">
                {[
                  'Venda realizada',
                  'Sem interesse / Descartado',
                  'Não atendeu as tentativas',
                  'Fora da área de comercialização',
                  'Outro motivo'
                ].map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setCloseReason(reason)}
                    className={`w-full text-left p-3.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                      closeReason === reason 
                        ? 'bg-cyan-600/10 border-cyan-500 text-cyan-400' 
                        : 'bg-slate-950/30 border-white/5 text-slate-300 hover:border-white/10'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex gap-3 justify-end shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowCloseReasonModal(false);
                  setCloseReason('');
                }}
                className="px-5 py-2.5 rounded-xl bg-white/5 text-xs font-black uppercase tracking-wider text-slate-400 hover:bg-white/10 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!closeReason || closingConversation}
                onClick={async () => {
                  if (!selectedConversation || !closeReason || closingConversation) return;
                  setClosingConversation(true);

                  try {
                    const conversationToClose = selectedConversation;
                    const selectedReason = closeReason;
                    const closed = await updateConversationStatus('fechada');
                    if (!closed) throw new Error('Nao foi possivel salvar o encerramento.');

                    if (conversationToClose.lead_id) {
                      const { error: activityError } = await supabase.from('lead_atividades').insert([{
                        lead_id: conversationToClose.lead_id,
                        profile_id: profile?.id,
                        tipo: 'sistema',
                        titulo: 'Conversa encerrada',
                        descricao: `Finalizada pelo atendente. Motivo: ${selectedReason}`
                      }]);
                      if (activityError) {
                        console.warn('Conversa encerrada, mas o historico nao foi registrado:', activityError);
                      }
                    }

                    setShowCloseReasonModal(false);
                    setCloseReason('');
                    alert('Conversa encerrada e removida da caixa ativa.');
                  } catch (error: unknown) {
                    console.error('Erro ao encerrar conversa:', error);
                    alert(error instanceof Error ? error.message : 'Nao foi possivel encerrar a conversa. Tente novamente.');
                  } finally {
                    setClosingConversation(false);
                  }
                }}
                className="px-5 py-2.5 rounded-xl bg-cyan-600 disabled:opacity-50 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-600/10 hover:-translate-y-0.5 transition-all cursor-pointer"
              >
                {closingConversation ? 'Encerrando...' : 'Confirmar e Encerrar'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= MODAL: AGENDAR TAREFA (CALENDÁRIO) ================= */}
      {showTaskModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <form onSubmit={handleScheduleTask} className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 text-white">
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Calendar size={20} className="text-cyan-400" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">{editingTaskId ? 'Editar tarefa' : 'Agendar Tarefa / Contato'}</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Defina um lembrete para este lead no CRM</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowTaskModal(false); setEditingTaskId(null); }}
                className="h-9 w-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Título da Tarefa</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Retornar cotação de PME"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Data de Vencimento</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    required
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="flex-1 bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                  />
                  <input
                    type="time"
                    required
                    value={taskDueTime}
                    onChange={(e) => setTaskDueTime(e.target.value)}
                    className="w-32 bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Prioridade</label>
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value)}
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-3 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="normal">Normal 🟢</option>
                  <option value="alta">Alta 🔴</option>
                  <option value="baixa">Baixa ⚪</option>
                </select>
              </div>

              {canManageTaskResponsible && taskResponsibleOptions.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Responsavel</label>
                  <select
                    value={taskResponsibleProfileId || leadInfo?.responsavel_profile_id || profile?.id || ''}
                    onChange={(e) => setTaskResponsibleProfileId(e.target.value)}
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-3 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="">Sem responsavel</option>
                    {taskResponsibleOptions.map((member) => (
                      <option key={member.profile_id} value={member.profile_id}>{member.nome || member.email || 'Sem nome'}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex gap-3 justify-end shrink-0">
              <button
                type="button"
                onClick={() => { setShowTaskModal(false); setEditingTaskId(null); }}
                className="px-5 py-2.5 rounded-xl bg-white/5 text-xs font-black uppercase tracking-wider text-slate-400 hover:bg-white/10 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingTask}
                className="px-5 py-2.5 rounded-xl bg-cyan-600 disabled:opacity-50 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-600/10 hover:-translate-y-0.5 transition-all cursor-pointer flex items-center gap-2"
              >
                {savingTask && <Loader2 size={12} className="animate-spin" />}
                {editingTaskId ? 'Salvar alteracoes' : 'Agendar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL: HISTÓRICO DE CHAMADOS & PROTOCOLOS ================= */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 text-white">
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <History size={20} className="text-cyan-400" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">Histórico de Atendimentos</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Logs de atividade e atendimentos anteriores</p>
                </div>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="h-9 w-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-cyan-400" size={24} />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Col 1: CRM Timeline */}
                  <div className="space-y-3">
                    <h4 className="text-2xs font-black uppercase text-slate-400 tracking-wider border-b border-white/5 pb-2">Linha do Tempo CRM</h4>
                    <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                      {historyActivities.length > 0 ? (
                        historyActivities.map((act) => (
                          <div key={act.id} className="bg-slate-950/50 border border-white/5 p-3 rounded-2xl space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[9px] font-black text-cyan-400 uppercase tracking-widest">{act.titulo}</span>
                              {act.profiles?.nome && (
                                <span className="text-[8px] font-bold text-slate-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-full uppercase tracking-wider leading-none">
                                  {act.profiles.nome}
                                </span>
                              )}
                            </div>
                            <p className="text-3xs text-slate-300 font-bold leading-normal">{act.descricao}</p>
                            <span className="text-[8px] font-semibold text-slate-500 block uppercase pt-0.5">
                              {new Date(act.created_at).toLocaleString('pt-BR')}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-3xs text-slate-500 font-black uppercase py-4">Nenhuma atividade registrada.</p>
                      )}
                    </div>
                  </div>

                  {/* Col 2: Closed protocols */}
                  <div className="space-y-3">
                    <h4 className="text-2xs font-black uppercase text-slate-400 tracking-wider border-b border-white/5 pb-2">Atendimentos WhatsApp</h4>
                    <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                      {historyConversations.length > 0 ? (
                        historyConversations.map((conv) => (
                          <div key={conv.id} className="bg-slate-950/50 border border-white/5 p-3 rounded-2xl space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-black text-cyan-400 uppercase tracking-widest">Protocolo</span>
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                                conv.status === 'resolvida' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                              }`}>
                                {conv.status === 'resolvida' ? 'Finalizado' : 'Ativo'}
                              </span>
                            </div>
                            <span className="text-2xs font-bold text-white block mt-1">Contato: {cleanInboxDisplayName(conv.nome_contato, conv.telefone)}</span>
                            <span className="text-[8px] font-semibold text-slate-500 block uppercase pt-0.5">
                              Última Mensagem: {conv.ultima_mensagem_at ? new Date(conv.ultima_mensagem_at).toLocaleString('pt-BR') : 'Sem mensagens'}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-3xs text-slate-500 font-black uppercase py-4">Nenhum atendimento anterior.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="px-5 py-2.5 rounded-xl bg-white/5 text-xs font-black uppercase tracking-wider text-slate-400 hover:bg-white/10 transition-all cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ENCAMINHAR PARA RESPONSÁVEL ================= */}
      {showForwardModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <form onSubmit={handleForwardLead} className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 text-white">
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <User size={20} className="text-cyan-400" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">Encaminhar Lead</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Selecione o corretor responsável por este lead</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForwardModal(false)}
                className="h-9 w-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Selecione o Integrante do Time</label>
                {teamMembers.length > 0 ? (
                  <select
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-3.5 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="">Selecione um corretor...</option>
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.nome} ({member.email})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 px-4 py-3 rounded-2xl text-2xs font-bold uppercase tracking-wider">
                    Não existem integrantes disponíveis para encaminhamento no seu time.
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex gap-3 justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowForwardModal(false)}
                className="px-5 py-2.5 rounded-xl bg-white/5 text-xs font-black uppercase tracking-wider text-slate-400 hover:bg-white/10 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={forwarding || !selectedMemberId}
                className="px-5 py-2.5 rounded-xl bg-cyan-600 disabled:opacity-50 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-600/10 hover:-translate-y-0.5 transition-all cursor-pointer flex items-center gap-2"
              >
                {forwarding && <Loader2 size={12} className="animate-spin" />}
                Encaminhar
              </button>
            </div>
          </form>
        </div>
      )}

      {mediaPreview && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Visualizar ${mediaPreview.fileName}`}>
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
            onClick={() => setMediaPreview(null)}
            aria-label="Fechar visualizacao"
          />
          <div className="relative flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#07111f] shadow-2xl">
            <header className="flex min-h-14 items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">{mediaPreview.fileName}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Visualizacao dentro do Inbox</p>
              </div>
              <button type="button" onClick={() => setMediaPreview(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Fechar visualizacao">
                <X size={17} />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/30 p-3 sm:p-5">
              {mediaPreview.mimeType.startsWith('image/') ? (
                <img src={mediaPreview.url} alt={mediaPreview.fileName} className="max-h-[calc(94dvh-6rem)] max-w-full object-contain" />
              ) : mediaPreview.mimeType.startsWith('video/') ? (
                <video controls autoPlay src={mediaPreview.url} className="max-h-[calc(94dvh-6rem)] max-w-full" />
              ) : mediaPreview.mimeType.startsWith('audio/') ? (
                <audio controls autoPlay src={mediaPreview.url} className="w-full max-w-xl [color-scheme:dark]">Seu navegador nao suporta audio.</audio>
              ) : (
                <iframe src={mediaPreview.url} title={mediaPreview.fileName} className="h-[calc(94dvh-6rem)] w-full rounded-xl bg-white" />
              )}
            </div>
          </div>
        </div>
      )}

    </InternalLayout>
  );
}

function normalizeCnpjOwnership(value?: string | null) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!normalized || normalized.includes('informado')) return 'Nao informado';
  if (normalized.includes('mei')) return 'Tenho MEI';
  if (normalized.includes('sim') || normalized.includes('cnpj')) return 'Sim';
  return 'Nao';
}

function normalizePlanoAtivo(value?: string | null) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (normalized.includes('sim')) return 'Sim';
  if (normalized.includes('nao')) return 'Nao';
  return 'Nao informado';
}

function EditableLeadInfoCard({
  label,
  field,
  value,
  onSave,
  className = '',
  options,
  multiline = false,
}: {
  label: string;
  field: string;
  value: string;
  onSave: (field: string, value: string) => void;
  className?: string;
  options?: string[];
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value || '');

  // O efeito so dispara quando o valor muda. Se o campo estava vazio nos dois
  // leads, o texto digitado e nao salvo continuava na tela do lead seguinte, e
  // ao sair do campo era gravado nele tambem. Por isso cada campo recebe uma
  // chave com o id do lead: trocando de conversa, o componente monta de novo.
  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const save = (nextValue = draft) => {
    onSave(field, nextValue);
  };

  if (options?.length) {
    return (
      <label className={`orion-lead-info-card block rounded-xl border border-white/5 bg-slate-950/40 p-3 ${className}`}>
        <span className="mb-1 block text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</span>
        <select
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            save(event.target.value);
          }}
          className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-500/60"
        >
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className={`orion-lead-info-card block rounded-xl border border-white/5 bg-slate-950/40 p-3 ${className}`}>
      <span className="mb-1 block text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      {multiline ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => save()}
          placeholder="-"
          rows={3}
          className="w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs font-black text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
        />
      ) : (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          placeholder="-"
          className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs font-black text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
        />
      )}
    </label>
  );
}
