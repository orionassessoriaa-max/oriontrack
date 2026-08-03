'use client';

import { useEffect, useState } from 'react';
import { Activity, BadgeCheck, Paperclip, Pencil, UserRound, X } from 'lucide-react';
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
  onInteractionTextChange: (value: string) => void;
  onInteractionFileChange: (file: File | null) => void;
  onAddInteraction: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onEdit: () => void;
};

function date(value: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Nao informado';
}

function value(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '' ? 'Nao informado' : String(value);
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
  onInteractionTextChange,
  onInteractionFileChange,
  onAddInteraction,
  onClose,
  onEdit,
}: Props) {
  const [activeTab, setActiveTab] = useState<'dados' | 'timeline'>('dados');
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!interactionFile) {
      setAttachmentPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(interactionFile);
    setAttachmentPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [interactionFile]);

  if (!lead) return null;

  const memberName = (id: string | null, fallback: string) => members.find((member) => member.profile_id === id)?.nome || fallback;
  const fields: Array<[string, string]> = [
    ['Telefone', value(lead.telefone)], ['E-mail', value(lead.email)], ['Empresa', value(lead.empresa)], ['Estado', value(lead.estado)],
    ['Origem', value(lead.origem)], ['Campanha', value(lead.campanha)], ['Status', value(lead.status)], ['Entrada', date(lead.data_entrada)],
    ['Prioridade', value(lead.prioridade)], ['Vidas', value(lead.vidas)], ['Ja investiu em trafego', value(lead.ja_investiu_trafego)],
    ['Faturamento mensal', value(lead.faturamento_mensal)], ['Negocio / etapa', value(lead.negocio_etapa)], ['SDR', memberName(lead.sdr_id, 'Sem SDR')],
    ['Closer', memberName(lead.closer_id, 'Sem closer')], ['Lead qualificado (MQL)', lead.lead_qualificado ? 'Sim' : 'Nao'],
    ['Reuniao agendada', date(lead.reuniao_agendada_at)], ['Reuniao realizada', date(lead.reuniao_realizada_at)], ['No-show', lead.no_show ? 'Sim' : 'Nao'],
    ['Ultimo contato', date(lead.ultimo_contato_at)], ['UTM source', value(lead.utm_source)], ['UTM medium', value(lead.utm_medium)],
    ['UTM campaign', value(lead.utm_campaign)], ['UTM term', value(lead.utm_term)], ['UTM content', value(lead.utm_content)],
    ['Observacoes', value(lead.observacoes)],
  ];
  if (canViewFinancials) fields.splice(8, 0, ['Investimento', value(lead.investimento)], ['Valor em negociacao', `R$ ${Number(lead.valor_negociacao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`]);

  const sdrName = memberName(lead.sdr_id, 'Sem SDR atribuido');

  return <div className="kh-lead-details-overlay" role="dialog" aria-modal="true" aria-labelledby="kh-lead-details-title">
    <section className="kh-lead-details-modal">
      <header>
        <div><span className="kh-eyebrow">Lead comercial</span><h2 id="kh-lead-details-title">{lead.nome}</h2><p>Informacoes completas do lead</p></div>
        <div className="kh-lead-modal-actions"><button type="button" className="kh-button primary" onClick={onEdit}><Pencil size={14} /> Editar</button><button type="button" className="kh-icon-button" aria-label="Fechar detalhes" onClick={onClose}><X size={18} /></button></div>
      </header>
      <div className="kh-lead-owner-highlight"><div><UserRound size={20} /><span><small>SDR RESPONSAVEL</small><strong>{sdrName}</strong></span></div><div className="kh-lead-badges">{lead.lead_qualificado && <span className="mql"><BadgeCheck size={14} /> Dentro do MQL</span>}<span className={Number(lead.no_show_count || 0) > 0 ? 'no-show' : ''}>No-shows: {Number(lead.no_show_count || 0)}</span></div></div>
      <div className="kh-lead-stage-bar"><label htmlFor="lead-stage-select">Etapa atual</label><select id="lead-stage-select" value={lead.status} onChange={(event) => onMoveStage(event.target.value)}><option value={lead.status}>{lead.status}</option>{stages.filter((stage) => stage.id !== lead.status).map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></div>
      <nav className="kh-lead-detail-tabs" aria-label="Detalhes do lead"><button type="button" className={activeTab === 'dados' ? 'active' : ''} onClick={() => setActiveTab('dados')}>Dados</button><button type="button" className={activeTab === 'timeline' ? 'active' : ''} onClick={() => setActiveTab('timeline')}><Activity size={14} /> Timeline <span>{interactions.length}</span></button></nav>
      {activeTab === 'dados' ? <div className="kh-lead-details-grid">{fields.map(([label, content]) => <div key={label} className={label === 'Observacoes' ? 'wide' : ''}><small>{label}</small><strong>{content}</strong></div>)}</div> : <section className="kh-lead-comments-panel">
        <form className="kh-interaction-form" onSubmit={onAddInteraction}><textarea className="kh-textarea" value={interactionText} onChange={(event) => onInteractionTextChange(event.target.value)} onPaste={(event) => { const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/')); if (image) { event.preventDefault(); onInteractionFileChange(image); } }} placeholder="Escreva um comentario para a equipe... Cole um print com Ctrl+V." />{attachmentPreview && <div className="kh-attachment-preview"><img src={attachmentPreview} alt="Previa do print anexado" /><button type="button" onClick={() => onInteractionFileChange(null)}>Remover print</button></div>}{interactionError && <div className="kh-inline-error" role="alert">{interactionError}</div>}<div><label className="kh-file-button" htmlFor="lead-attachment-modal"><Paperclip size={14} /> {interactionFile ? interactionFile.name : 'Anexar print'}</label><input id="lead-attachment-modal" type="file" accept="image/*" onChange={(event) => onInteractionFileChange(event.target.files?.[0] || null)} /><button className="kh-button primary" disabled={interactionSaving}>{interactionSaving ? 'Salvando...' : 'Comentar'}</button></div></form>
        <div className="kh-interaction-list">{interactions.map((item) => <article key={item.id} className={item.tipo && item.tipo !== 'comentario' ? 'system-event' : ''}><div><strong>{item.tipo && item.tipo !== 'comentario' ? 'Evento do CRM' : item.autor_nome}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></div>{item.tipo && item.tipo !== 'comentario' && <em>{item.autor_nome}</em>}{item.comentario && <p>{item.comentario}</p>}{item.anexo_url && <a href={item.anexo_url} target="_blank" rel="noreferrer"><img src={item.anexo_url} alt={item.anexo_nome || 'Print anexado'} /></a>}</article>)}{!interactions.length && <span>Nenhuma atividade registrada para este lead.</span>}</div>
      </section>}
    </section>
  </div>;
}
