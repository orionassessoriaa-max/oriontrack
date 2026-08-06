'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquare,
  Mic,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';

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
    data_entrada: string;
    ultimo_contato_at: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
  };
};

type Message = {
  id: string;
  direction: 'inbound' | 'outbound';
  remetente?: string | null;
  mensagem: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

type WhatsappState = {
  configured: boolean;
  connected: boolean;
  state: 'open' | 'connecting' | 'close';
  targetProfile?: { id?: string; nome?: string | null } | null;
};

type AudioMedia = { url: string; objectUrl: boolean };

const time = (value?: string | null) => value
  ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  : '';
const normalizePhone = (value: string) => value.replace(/\D/g, '').replace(/^55/, '');
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

function isAudioMessage(message: Message) {
  const metadata = message.metadata || {};
  const mime = String(metadata.media_mimetype || metadata.mediaMimeType || metadata.mimetype || '').toLowerCase();
  const mediaType = String(metadata.mediaType || metadata.mediatype || '').toLowerCase();
  return mime.startsWith('audio/') || mediaType === 'ptt' || mediaType === 'audio' || /mensagem de voz|\báudio\b|\baudio\b/i.test(message.mensagem || '');
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
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsappState>({ configured: false, connected: false, state: 'close' });
  const [audioMedia, setAudioMedia] = useState<Record<string, AudioMedia>>({});
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const audioMediaRef = useRef<Record<string, AudioMedia>>({});

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
      const payload = await api('/api/comercial/inbox');
      const next = payload.conversations || [];
      setConversations(next);
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
    const timer = window.setInterval(() => void loadWhatsapp(), 15000);
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
    audioMediaRef.current = audioMedia;
  }, [audioMedia]);

  useEffect(() => () => {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    Object.values(audioMediaRef.current).forEach((media) => {
      if (media.objectUrl) URL.revokeObjectURL(media.url);
    });
  }, []);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.profile_id, member])), [members]);
  const funnelStages = useMemo(() => Array.from(new Set(conversations.map((item) => item.commercial_lead.status).filter(Boolean))).sort(), [conversations]);
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

  async function connectWhatsapp() {
    try {
      const payload = await api('/api/comercial/inbox/whatsapp', {
        method: 'POST',
        body: JSON.stringify({ accepted_terms: true, terms_version: 'commercial-inbox-v1' }),
      });
      setQr(payload.qrcode || null);
      setWhatsapp((current) => ({ ...current, configured: true, state: 'connecting', connected: false }));
      setNotice(payload.qrcode ? 'Escaneie o QR Code com o WhatsApp.' : 'Conexão iniciada.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao conectar WhatsApp.');
    }
  }

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

  async function loadAudio(message: Message) {
    if (audioMedia[message.id]) return;
    setLoadingAudioId(message.id);
    try {
      const payload = await api(`/api/inbox/messages/media?message_id=${encodeURIComponent(message.id)}`);
      const mimeType = String(payload.mimeType || payload.mimetype || 'audio/ogg');
      const media = payload.base64
        ? { url: base64ToObjectUrl(payload.base64, mimeType), objectUrl: true }
        : payload.url
          ? { url: String(payload.url), objectUrl: false }
          : null;
      if (!media) throw new Error('O arquivo deste áudio não está disponível.');
      setAudioMedia((current) => ({ ...current, [message.id]: media }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível carregar o áudio.');
    } finally {
      setLoadingAudioId(null);
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
      <header className="kh-page-head">
        <div>
          <div className="kh-eyebrow">Atendimento comercial</div>
          <h1>Inbox</h1>
          <p>{role === 'sdr' ? 'Aqui aparecem somente as conversas dos leads atribuídos a você.' : 'Acompanhe e responda as conversas de todo o time comercial.'}</p>
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

      <div className={`kh-whatsapp-status ${whatsapp.state}`}>
        <span className="kh-whatsapp-status-dot" />
        <strong>{connectionLabel}</strong>
        <span>{whatsapp.state === 'open' ? `${whatsapp.targetProfile?.nome || 'Seu usuário'} está pronto para enviar e receber mensagens.` : whatsapp.state === 'connecting' ? 'Leia o QR Code para ativar seu atendimento.' : 'Conecte o WhatsApp deste usuário para atender seus leads.'}</span>
        {whatsapp.state === 'open' && <CheckCircle2 size={16} />}
      </div>

      {notice && <div className="kh-inline-error">{notice}<button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={14} /></button></div>}
      {qr && (
        <div className="kh-panel kh-whatsapp-qr">
          <div><strong>Conecte o WhatsApp</strong><p>Abra o WhatsApp no celular e escaneie o código.</p></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR Code para conectar WhatsApp" />
          <button className="kh-icon-button" onClick={() => setQr(null)} aria-label="Fechar QR Code"><X size={16} /></button>
        </div>
      )}

      <section className="kh-inbox-layout">
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
            {selected ? <><div className="kh-avatar">{(selected.nome_contato || selected.commercial_lead.nome).slice(0, 2).toUpperCase()}</div><div><strong>{selected.nome_contato || selected.commercial_lead.nome}</strong><span>{selected.telefone} · {selected.commercial_lead.status}</span></div></> : <><MessageSquare size={22} /><div><strong>Selecione uma conversa</strong><span>Admins e closer visualizam e respondem todo o Inbox.</span></div></>}
          </div>
          <div className="kh-chat-messages">
            {messages.map((message) => {
              const audio = isAudioMessage(message);
              const media = audioMedia[message.id];
              const isAiSender = message.metadata?.ai_agent === 'commercial_sdr';
              const senderName = message.remetente?.trim()
                || (message.direction === 'inbound'
                  ? selected?.nome_contato || selected?.commercial_lead.nome || 'Lead'
                  : 'Equipe comercial');
              const senderLabel = isAiSender ? `${senderName} · IA` : senderName;
              return (
                <div key={message.id} className={`kh-chat-bubble ${message.direction === 'outbound' ? 'outbound' : 'inbound'} ${audio ? 'audio' : ''}`}>
                  {audio ? media ? (
                    <div className="kh-audio-message"><Volume2 size={17} aria-hidden="true" /><audio controls preload="metadata" src={media.url}>Seu navegador não suporta áudio.</audio></div>
                  ) : (
                    <button className="kh-audio-load" type="button" onClick={() => void loadAudio(message)} disabled={loadingAudioId === message.id}>
                      {loadingAudioId === message.id ? <Loader2 size={16} className="kh-spin" /> : <Volume2 size={16} />} {loadingAudioId === message.id ? 'Carregando áudio...' : 'Ouvir mensagem de voz'}
                    </button>
                  ) : <p>{message.mensagem}</p>}
                  <div className="kh-chat-message-meta">
                    <strong>{senderLabel}</strong>
                    <time>{time(message.created_at)}</time>
                  </div>
                </div>
              );
            })}
            {selected && !messages.length && <div className="kh-inbox-empty">Nenhuma mensagem registrada.</div>}
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

        <aside className="kh-panel kh-inbox-lead-panel">
          {selected ? (() => {
            const lead = selected.commercial_lead;
            const sdrName = memberMap.get(lead.sdr_id || '')?.nome || 'Sem SDR';
            const closerName = memberMap.get(lead.closer_id || '')?.nome || 'Sem closer';
            return <>
              <header><div><span>Dados do lead</span><h2>{lead.nome}</h2></div><em>{lead.status}</em></header>
              <dl>
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
              </dl>
              <div className="kh-inbox-lead-actions">
                <button type="button" className="kh-button primary" onClick={scheduleLeadReturn}><CalendarClock size={15} /> Agendar retorno</button>
                <button type="button" className="kh-button" onClick={openLeadHistory}><ClipboardList size={15} /> Ver histórico</button>
              </div>
            </>;
          })() : <div className="kh-inbox-empty"><ClipboardList size={24} /> Selecione uma conversa para ver os dados do lead.</div>}
        </aside>
      </section>
      <small className="kh-inbox-role">Acesso atual: {role === 'coordenador' ? 'administrador comercial' : role === 'sdr' ? 'SDR' : 'Closer'}</small>
    </div>
  );
}
