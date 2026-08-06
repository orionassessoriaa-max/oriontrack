'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  CircleX,
  Clock3,
  FileText,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Phone,
  RefreshCw,
  X,
} from 'lucide-react';
import type { CommercialLead, CommercialMember, CommercialStage } from '@/lib/comercial';

type LeadInteraction = {
  id: string;
  comentario: string | null;
  anexo_url: string | null;
  anexo_nome: string | null;
  autor_nome: string;
  tipo?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

type TaskForm = {
  titulo: string;
  responsavel_id: string;
  vencimento: string;
  prioridade: string;
  descricao: string;
};

type Props = {
  lead: CommercialLead | null;
  members: CommercialMember[];
  canViewFinancials: boolean;
  stages: CommercialStage[];
  onMoveStage: (status: string) => void;
  interactions: LeadInteraction[];
  interactionText: string;
  interactionFile: File | null;
  interactionSaving: boolean;
  interactionError: string | null;
  taskForm: TaskForm;
  taskSaving: boolean;
  onTaskChange: (field: keyof TaskForm, value: string) => void;
  onCreateTask: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onInteractionTextChange: (value: string) => void;
  onInteractionFileChange: (file: File | null) => void;
  onAddInteraction: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onEdit: () => void;
};

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Não informado';
}

function displayValue(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '' ? 'Não informado' : String(value);
}

function elapsedLabel(value: string | null) {
  if (!value) return 'Sem contato registrado';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 0) return 'Contato hoje';
  return `${days} ${days === 1 ? 'dia' : 'dias'} sem contato`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'LD';
}

function noteKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const structuredNoteLabels = new Set([
  'nome', 'telefone', 'email', 'empresa', 'estado', 'origem', 'campanha', 'status', 'etapa',
  'data entrada', 'ja investiu trafego', 'ja investiu em trafego', 'faturamento mensal', 'faturamento',
  'prioridade', 'investimento', 'vidas', 'quantidade de vidas', 'negocio etapa',
  'utm source', 'utm medium', 'utm campaign', 'utm term', 'utm content',
  'decisor', 'e o decisor', 'tomador de decisao',
]);

function noteParts(notes: string | null) {
  return String(notes || '').split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
}

function noteField(notes: string | null, aliases: string[]) {
  const wanted = new Set(aliases.map(noteKey));
  for (const part of noteParts(notes)) {
    const separator = part.indexOf(':');
    if (separator < 0 || !wanted.has(noteKey(part.slice(0, separator)))) continue;
    const content = part.slice(separator + 1).trim();
    if (content) return content;
  }
  return null;
}

function freeNotes(notes: string | null) {
  return noteParts(notes).filter((part) => {
    const separator = part.indexOf(':');
    return separator < 0 || !structuredNoteLabels.has(noteKey(part.slice(0, separator)));
  }).join(' | ');
}

export default function CommercialLeadDetailsModal({
  lead,
  members,
  canViewFinancials,
  stages,
  onMoveStage,
  interactions,
  interactionText,
  interactionFile,
  interactionSaving,
  interactionError,
  taskForm,
  taskSaving,
  onTaskChange,
  onCreateTask,
  onInteractionTextChange,
  onInteractionFileChange,
  onAddInteraction,
  onClose,
  onEdit,
}: Props) {
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const interactionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!interactionFile) return;
    const objectUrl = URL.createObjectURL(interactionFile);
    const updateId = window.setTimeout(() => setAttachmentPreview(objectUrl), 0);
    return () => {
      window.clearTimeout(updateId);
      URL.revokeObjectURL(objectUrl);
    };
  }, [interactionFile]);

  if (!lead) return null;

  const memberName = (id: string | null, fallback: string) => members.find((member) => member.profile_id === id)?.nome || fallback;
  const leadName = lead.nome;
  const sdrName = memberName(lead.sdr_id, 'Sem SDR');
  const closerName = memberName(lead.closer_id, 'Sem closer');
  const lastActivity = lead.ultimo_contato_at || interactions[0]?.created_at || lead.data_entrada;
  const internalNotes = freeNotes(lead.observacoes);
  const decisionMaker = noteField(lead.observacoes, ['decisor', 'é o decisor', 'tomador de decisão']);
  const nextStep = lead.reuniao_agendada_at
    ? `Reunião agendada para ${dateTime(lead.reuniao_agendada_at)}`
    : lead.status === 'Perdido'
      ? 'Lead marcado como perdido'
      : `Próximo passo: avançar o atendimento na etapa ${lead.status}`;

  function focusInteraction() {
    interactionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => interactionRef.current?.focus(), 250);
  }

  function openSchedule() {
    if (!taskForm.titulo.trim()) onTaskChange('titulo', `Retorno com ${leadName}`);
    setScheduleOpen(true);
  }

  const qualificationRows = [
    ['Vidas', displayValue(lead.vidas)],
    ['Prioridade', displayValue(lead.prioridade)],
    ...(canViewFinancials ? [['Faturamento', displayValue(lead.faturamento_mensal)]] : []),
    ['É o decisor?', displayValue(decisionMaker)],
    ...(canViewFinancials ? [['Já investiu em tráfego?', displayValue(lead.ja_investiu_trafego)]] : []),
  ];
  const contactRows = [
    ['Nome', displayValue(lead.nome)], ['WhatsApp', displayValue(lead.telefone)], ['E-mail', displayValue(lead.email)],
    ['Empresa', displayValue(lead.empresa)], ['Estado', displayValue(lead.estado)], ['SDR', sdrName], ['Closer', closerName],
  ];
  const sourceRows = [
    ['Origem', displayValue(lead.origem)], ['Campanha', displayValue(lead.campanha)], ['UTM source', displayValue(lead.utm_source)],
    ['UTM medium', displayValue(lead.utm_medium)], ['UTM campaign', displayValue(lead.utm_campaign)],
    ['UTM term', displayValue(lead.utm_term)], ['UTM content', displayValue(lead.utm_content)],
  ];
  const controlRows = [
    ['Entrada', dateTime(lead.data_entrada)], ['Último contato', dateTime(lead.ultimo_contato_at)],
    ['Reunião agendada', dateTime(lead.reuniao_agendada_at)], ['Reunião realizada', dateTime(lead.reuniao_realizada_at)],
    ['Negócio / etapa', displayValue(lead.negocio_etapa)], ['No-shows', String(Number(lead.no_show_count || 0))],
  ];

  return <div className="kh-lead-details-overlay" role="dialog" aria-modal="true" aria-labelledby="kh-lead-details-title">
    <section className="kh-lead-details-modal kh-lead-reference">
      <header className="kh-lead-reference-head">
        <div className="kh-lead-identity">
          <span className="kh-lead-avatar" aria-hidden="true">{initials(lead.nome)}</span>
          <div>
            <h2 id="kh-lead-details-title">{lead.nome}</h2>
            <p><Phone size={13} /> {lead.telefone || 'WhatsApp não informado'} <span>•</span> SDR {sdrName} <span>•</span> Closer {closerName}</p>
          </div>
        </div>
        <div className="kh-lead-head-status">
          <span className="stage">{lead.status}</span>
          <span className="elapsed"><Clock3 size={13} /> {elapsedLabel(lastActivity)}</span>
          <button type="button" className="kh-icon-button" aria-label="Editar lead" onClick={onEdit}><Pencil size={17} /></button>
          <button type="button" className="kh-icon-button" aria-label="Fechar detalhes" onClick={onClose}><X size={19} /></button>
        </div>
      </header>

      <div className="kh-lead-next-step"><CalendarClock size={16} /><strong>{nextStep}</strong></div>

      <div className="kh-lead-quick-actions" aria-label="Ações do lead">
        <button type="button" onClick={focusInteraction}><MessageSquarePlus size={16} /> Registrar interação</button>
        <button type="button" onClick={openSchedule}><CalendarClock size={16} /> Agendar retorno</button>
        <label><RefreshCw size={15} /><span>Mudar etapa</span><select value={lead.status} onChange={(event) => onMoveStage(event.target.value)} aria-label="Mudar etapa do lead">{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
        <button type="button" className="danger" onClick={() => onMoveStage('Perdido')} disabled={lead.status === 'Perdido'}><CircleX size={16} /> Marcar perdido</button>
      </div>

      {scheduleOpen && <form className="kh-lead-return-form" onSubmit={(event) => { void onCreateTask(event).then(() => setScheduleOpen(false)).catch(() => undefined); }}>
        <label><span>Próximo retorno</span><input className="kh-input" type="datetime-local" value={taskForm.vencimento} onChange={(event) => onTaskChange('vencimento', event.target.value)} required autoFocus /></label>
        <label className="grow"><span>Título</span><input className="kh-input" value={taskForm.titulo} onChange={(event) => onTaskChange('titulo', event.target.value)} required /></label>
        <button type="submit" className="kh-button primary" disabled={taskSaving}>{taskSaving ? 'Salvando...' : 'Agendar'}</button>
        <button type="button" className="kh-icon-button" aria-label="Cancelar agendamento" onClick={() => setScheduleOpen(false)}><X size={17} /></button>
      </form>}

      <div className="kh-lead-reference-body">
        <section className="kh-lead-history">
          <div className="kh-section-title"><div><FileText size={16} /><h3>Histórico</h3></div><span>{interactions.length} registros</span></div>
          <form className="kh-interaction-form kh-history-compose" onSubmit={onAddInteraction}>
            <textarea ref={interactionRef} className="kh-textarea" value={interactionText} onChange={(event) => onInteractionTextChange(event.target.value)} onPaste={(event) => { const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/')); if (image) { event.preventDefault(); onInteractionFileChange(image); } }} placeholder="Escrever nota rápida..." />
            {interactionFile && attachmentPreview && <div className="kh-attachment-preview"><Image src={attachmentPreview} alt="Prévia do print anexado" width={220} height={130} unoptimized /><button type="button" onClick={() => onInteractionFileChange(null)}>Remover print</button></div>}
            {interactionError && <div className="kh-inline-error" role="alert">{interactionError}</div>}
            <div><label className="kh-file-button" htmlFor="lead-attachment-modal"><Paperclip size={14} /> {interactionFile ? interactionFile.name : 'Anexar'}</label><input id="lead-attachment-modal" type="file" accept="image/*" onChange={(event) => onInteractionFileChange(event.target.files?.[0] || null)} /><button className="kh-button primary" disabled={interactionSaving}>{interactionSaving ? 'Salvando...' : 'Registrar'}</button></div>
          </form>
          {internalNotes && <article className="kh-lead-internal-note"><strong>Observação interna</strong><p>{internalNotes}</p></article>}
          <div className="kh-interaction-list kh-history-list">
            {interactions.map((item) => <article key={item.id} className={item.tipo && item.tipo !== 'comentario' ? 'system-event' : ''}><div><strong>{item.tipo && item.tipo !== 'comentario' ? 'Evento do CRM' : item.autor_nome}</strong><small>{dateTime(item.created_at)}</small></div>{item.tipo && item.tipo !== 'comentario' && <em>{item.autor_nome}</em>}{item.comentario && <p>{item.comentario}</p>}{item.anexo_url && <a href={item.anexo_url} target="_blank" rel="noreferrer"><Image src={item.anexo_url} alt={item.anexo_nome || 'Print anexado'} width={220} height={150} unoptimized /></a>}</article>)}
            {!interactions.length && <span>Nenhuma interação registrada. Use a nota rápida acima para iniciar o histórico.</span>}
          </div>
        </section>

        <aside className="kh-lead-data-stack">
          <section className="kh-lead-qualification">
            <div className="kh-section-title"><div><BadgeCheck size={16} /><h3>Qualificação</h3></div>{lead.lead_qualificado && <span className="mql">Dentro do MQL</span>}</div>
            <dl>{qualificationRows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl>
          </section>
          <details className="kh-lead-accordion" open><summary><span>Contato e empresa</span><ChevronDown size={16} /></summary><dl>{contactRows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl></details>
          <details className="kh-lead-accordion"><summary><span>Origem e mídia <small>({sourceRows.length} campos)</small></span><ChevronDown size={16} /></summary><dl>{sourceRows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl></details>
          <details className="kh-lead-accordion"><summary><span>Datas e controle</span><ChevronDown size={16} /></summary><dl>{controlRows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl></details>
          {canViewFinancials && <details className="kh-lead-accordion"><summary><span>Valores comerciais</span><ChevronDown size={16} /></summary><dl><div><dt>Investimento</dt><dd>{displayValue(lead.investimento)}</dd></div><div><dt>Valor em negociação</dt><dd>R$ {Number(lead.valor_negociacao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</dd></div></dl></details>}
        </aside>
      </div>
    </section>
  </div>;
}
