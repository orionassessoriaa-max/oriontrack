'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, CalendarPlus, ChevronDown, ChevronUp, GripVertical, MessageSquare, Paperclip, Plus, RefreshCw, Search, Trash2, UserRound, X } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import CommercialLeadModal from '@/components/commercial/CommercialLeadModal';
import CommercialLeadDetailsModal from '@/components/commercial/CommercialLeadDetailsModal';
import { COMMERCIAL_STAGES, currency, type CommercialLead, type CommercialStage } from '@/lib/comercial';

type DatePreset = 'todos' | 'hoje' | 'ontem' | '7dias' | '30dias' | 'mes' | 'personalizado';
type LeadInteraction = { id: string; comentario: string | null; anexo_url: string | null; anexo_nome: string | null; autor_nome: string; created_at: string };

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPresetRange(preset: DatePreset) {
  const today = new Date();
  const end = new Date(today);
  const start = new Date(today);
  if (preset === 'ontem') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (preset === '7dias') start.setDate(start.getDate() - 6);
  if (preset === '30dias') start.setDate(start.getDate() - 29);
  if (preset === 'mes') start.setDate(1);
  return preset === 'todos' ? { start: '', end: '' } : { start: localDateValue(start), end: localDateValue(end) };
}

export default function CommercialKanbanPage() {
  const { api, members, role, canViewCommercialFinancials } = useCommercial();
  const router = useRouter();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [stages, setStages] = useState<CommercialStage[]>(COMMERCIAL_STAGES);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('todos');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<CommercialLead | null>(null);
  const [initialStatus, setInitialStatus] = useState('Oportunidade');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [stageDragging, setStageDragging] = useState<string | null>(null);
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageSaving, setStageSaving] = useState(false);
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ titulo: '', responsavel_id: '', vencimento: '', prioridade: 'normal', descricao: '' });
  const [taskSaving, setTaskSaving] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<LeadInteraction[]>([]);
  const [interactionText, setInteractionText] = useState('');
  const [interactionFile, setInteractionFile] = useState<File | null>(null);
  const [interactionSaving, setInteractionSaving] = useState(false);
  const [meetingMove, setMeetingMove] = useState<{ leadId: string; status: string } | null>(null);
  const [meetingAt, setMeetingAt] = useState('');
  const [meetingSaving, setMeetingSaving] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { const payload = await api('/api/comercial/leads'); setLeads(payload.leads || []); } finally { setLoading(false); } }, [api]);
  const loadStages = useCallback(async () => { try { const payload = await api('/api/comercial/stages'); if (payload.stages?.length) setStages(payload.stages); } catch { /* fallback ate a migration ser aplicada */ } }, [api]);
  useEffect(() => { void load(); void loadStages(); }, [load, loadStages]);
  useEffect(() => { if (!expandedLeadId) { setInteractions([]); return; } void api(`/api/comercial/leads/${expandedLeadId}/interactions`).then((payload) => setInteractions(payload.interactions || [])).catch(() => setInteractions([])); }, [api, expandedLeadId]);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.profile_id, member])), [members]);
  const visible = useMemo(() => leads.filter((lead) => {
    const matchesSearch = [lead.nome, lead.empresa, lead.telefone].join(' ').toLowerCase().includes(search.toLowerCase());
    const date = new Date(lead.data_entrada).getTime();
    const matchesStart = !dateStart || date >= new Date(`${dateStart}T00:00:00`).getTime();
    const matchesEnd = !dateEnd || date <= new Date(`${dateEnd}T23:59:59`).getTime();
    return matchesSearch && matchesStart && matchesEnd;
  }), [leads, search, dateStart, dateEnd]);
  const grouped = useMemo(() => Object.fromEntries(stages.map((stage) => [stage.id, visible.filter((lead) => lead.status === stage.id)])), [stages, visible]);

  async function moveLead(id: string, status: string) {
    const normalizedStatus = status.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (normalizedStatus.includes('reunio') && normalizedStatus.includes('agend')) {
      setMeetingMove({ leadId: id, status });
      setMeetingAt('');
      return;
    }
    setMovingId(id);
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, status } : lead));
    try { await api('/api/comercial/leads', { method: 'PATCH', body: JSON.stringify({ id, status }) }); } catch { await load(); } finally { setMovingId(null); }
  }
  async function confirmMeetingMove(event: React.FormEvent) {
    event.preventDefault();
    if (!meetingMove || !meetingAt) return;
    setMeetingSaving(true);
    setMovingId(meetingMove.leadId);
    try {
      const scheduledAt = new Date(meetingAt).toISOString();
      await api('/api/comercial/leads', { method: 'PATCH', body: JSON.stringify({ id: meetingMove.leadId, status: meetingMove.status, reuniao_agendada_at: scheduledAt }) });
      setLeads((current) => current.map((lead) => lead.id === meetingMove.leadId ? { ...lead, status: meetingMove.status, reuniao_agendada_at: scheduledAt } : lead));
      setMeetingMove(null);
    } catch (error) {
      setStageError(error instanceof Error ? error.message : 'Nao foi possivel agendar a reuniao.');
    } finally {
      setMeetingSaving(false);
      setMovingId(null);
    }
  }
  async function saveStages(next: CommercialStage[]) {
    setStages(next);
    setStageSaving(true); setStageError(null);
    try { const payload = await api('/api/comercial/stages', { method: 'PUT', body: JSON.stringify({ stages: next }) }); setStages(payload.stages || next); }
    catch (error) { setStageError(error instanceof Error ? error.message : 'Nao foi possivel salvar as etapas.'); }
    finally { setStageSaving(false); }
  }
  function reorderStages(targetId: string) {
    if (!stageDragging || stageDragging === targetId) return;
    const next = [...stages]; const from = next.findIndex((stage) => stage.id === stageDragging); const to = next.findIndex((stage) => stage.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = next.splice(from, 1); next.splice(to, 0, item); setStageDragging(null); void saveStages(next);
  }
  function addStage(event: React.FormEvent) {
    event.preventDefault(); const label = newStageName.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
    if (!label || stages.some((stage) => stage.label.toLowerCase() === label.toLowerCase())) return;
    setNewStageName(''); setNewStageOpen(false); void saveStages([...stages, { id: label, label, desc: 'Etapa personalizada', protected: false }]);
  }
  async function removeStage(stage: CommercialStage) {
    if (stage.protected) return;
    if (grouped[stage.id]?.length) { setStageError('Mova os leads desta etapa antes de remove-la.'); return; }
    await saveStages(stages.filter((item) => item.id !== stage.id));
  }
  function openLeadInbox(event: React.MouseEvent, lead: CommercialLead) {
    event.stopPropagation();
    const params = new URLSearchParams({ lead: lead.id, telefone: lead.telefone || '' });
    router.push(`/comercial/inbox?${params.toString()}`);
  }

  function toggleLeadDetails(lead: CommercialLead) {
    const nextId = expandedLeadId === lead.id ? null : lead.id;
    setExpandedLeadId(nextId);
    if (nextId) {
      setTaskForm({ titulo: '', responsavel_id: lead.closer_id || lead.sdr_id || members.find((member) => member.ativo)?.profile_id || '', vencimento: '', prioridade: 'normal', descricao: '' });
    }
  }
  async function createLeadTask(event: React.FormEvent, lead: CommercialLead) {
    event.preventDefault();
    if (!taskForm.titulo.trim()) return;
    setTaskSaving(lead.id);
    try {
      await api('/api/comercial/tasks', { method: 'POST', body: JSON.stringify({ ...taskForm, lead_id: lead.id }) });
      setTaskForm((current) => ({ ...current, titulo: '', vencimento: '', descricao: '' }));
    } finally {
      setTaskSaving(null);
    }
  }
  async function addInteraction(event: React.FormEvent, leadId: string) {
    event.preventDefault();
    if (!interactionText.trim() && !interactionFile) return;
    setInteractionSaving(true);
    try {
      const form = new FormData();
      if (interactionText.trim()) form.append('comentario', interactionText.trim());
      if (interactionFile) form.append('anexo', interactionFile);
      const payload = await api(`/api/comercial/leads/${leadId}/interactions`, { method: 'POST', body: form });
      setInteractions((current) => [{ ...payload.interaction, autor_nome: 'Você' }, ...current]);
      setInteractionText(''); setInteractionFile(null);
      const input = document.getElementById('lead-attachment') as HTMLInputElement | null; if (input) input.value = '';
    } finally { setInteractionSaving(false); }
  }

  function changeDatePreset(next: DatePreset) {
    setDatePreset(next);
    if (next !== 'personalizado') {
      const range = getPresetRange(next);
      setDateStart(range.start);
      setDateEnd(range.end);
    }
  }

  return (
    <div className={`kh-kanban-page ${canViewCommercialFinancials ? '' : 'kh-hide-commercial-financials'}`}>
      <header className="kh-page-head"><div><div className="kh-eyebrow">Pipeline de vendas</div><h1>Kanban</h1><p>Acompanhe a passagem do SDR para o closer e o avanco de cada negociacao.</p></div><div className="kh-actions"><div className="kh-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead..." /></div><label className="kh-date-preset"><CalendarDays size={15} /><select value={datePreset} onChange={(event) => changeDatePreset(event.target.value as DatePreset)} aria-label="Período"><option value="todos">Todo o período</option><option value="hoje">Hoje</option><option value="ontem">Ontem</option><option value="7dias">Últimos 7 dias</option><option value="30dias">Últimos 30 dias</option><option value="mes">Este mês</option><option value="personalizado">Personalizado</option></select></label>{datePreset === 'personalizado' && <><input className="kh-input kh-date-filter" type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} aria-label="Data inicial" /><input className="kh-input kh-date-filter" type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} aria-label="Data final" /></>}<button className="kh-icon-button" onClick={() => void load()} aria-label="Atualizar"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button><button className="kh-button primary" onClick={() => { setInitialStatus('Oportunidade'); setModalOpen(true); }}><Plus size={17} /> Novo lead</button></div></header>
      {stageError && <div className="kh-inline-error kh-stage-error">{stageError}<button type="button" aria-label="Fechar aviso" onClick={() => setStageError(null)}><X size={15} /></button></div>}
      {role === 'coordenador' && <div className="kh-kanban-toolbar"><span>Arraste uma coluna para reorganizar o funil.</span><button type="button" className="kh-button" onClick={() => setNewStageOpen(true)} disabled={stageSaving}>{stageSaving ? <RefreshCw size={16} className="kh-spin" /> : <Plus size={16} />} {stageSaving ? 'Salvando...' : 'Adicionar etapa'}</button></div>}
      {role === 'coordenador' && newStageOpen && <form className="kh-stage-add" onSubmit={addStage}><input autoFocus className="kh-input" value={newStageName} onChange={(event) => setNewStageName(event.target.value)} placeholder="Nome da nova etapa" maxLength={60} required /><button className="kh-button primary">Criar etapa</button><button type="button" className="kh-button" onClick={() => setNewStageOpen(false)}>Cancelar</button></form>}
      <div className="kh-kanban" aria-label="Pipeline comercial">
        {stages.map((stage, index) => {
          const statusLeads = grouped[stage.id] || [];
          const total = statusLeads.reduce((sum, lead) => sum + Number(lead.valor_negociacao || 0), 0);
          return <section key={stage.id} className={`kh-kanban-column ${dropStage === stage.id ? 'drop-target' : ''} ${stageDragging === stage.id ? 'stage-dragging' : ''}`} draggable={role === 'coordenador'} onDragStart={(event) => { event.stopPropagation(); if (role === 'coordenador') setStageDragging(stage.id); }} onDragEnd={() => setStageDragging(null)} onDragOver={(event) => { event.preventDefault(); if (dragging) setDropStage(stage.id); }} onDragEnter={() => dragging && setDropStage(stage.id)} onDragLeave={() => setDropStage(null)} onDrop={(event) => { event.stopPropagation(); if (stageDragging && role === 'coordenador') reorderStages(stage.id); else if (dragging) void moveLead(dragging, stage.id); setDragging(null); setStageDragging(null); setDropStage(null); }}>
            <header style={{ '--stage-hue': `${205 + (index * 7) % 105}` } as React.CSSProperties}><div><GripVertical size={14} className="kh-stage-grip" /><strong>{stage.label}</strong><b>{statusLeads.length}</b></div>{canViewCommercialFinancials && <small>{currency(total)}</small>}{role === 'coordenador' && stage.protected && <div className="kh-stage-actions"><em>fixa</em></div>}</header>
            <div className="kh-kanban-cards">{statusLeads.map((lead) => { const ownerId = lead.closer_id || lead.sdr_id || ''; return <article key={lead.id} draggable onDragStart={(event) => { event.stopPropagation(); setDragging(lead.id); }} onDragEnd={() => { setDragging(null); setDropStage(null); }} onClick={() => toggleLeadDetails(lead)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleLeadDetails(lead); } }} tabIndex={0} role="button" className={`${dragging === lead.id ? 'dragging' : ''}`}><div className="kh-card-top"><span className={`kh-dot ${lead.lead_qualificado ? 'qualified' : ''}`} /><small>{lead.lead_qualificado ? 'MQL' : 'Lead'}</small><span className="kh-card-expand"><ChevronDown size={14} /></span></div><h3>{lead.nome}</h3><p>{lead.empresa || lead.telefone || 'Sem empresa informada'}</p><div className="kh-card-owner"><UserRound size={13} /><span>{memberMap.get(ownerId)?.nome || 'Sem responsavel'}</span></div><footer><strong>{currency(lead.valor_negociacao)}</strong><span className="kh-card-stage">{lead.status}</span></footer><button type="button" className="kh-card-inbox" onClick={(event) => openLeadInbox(event, lead)}><MessageSquare size={13} /> Abrir no Inbox</button></article>; })}{!statusLeads.length && <div className="kh-column-empty"><img src="/brand-logo.png" alt="ORION TRACK" className="kh-empty-logo" /><span>Sem leads</span></div>}<button type="button" className="kh-add-lead-column" onClick={() => { setInitialStatus(stage.id); setModalOpen(true); }}><Plus size={16} /> Adicionar lead</button>{role === 'coordenador' && !stage.protected && <button type="button" className="kh-remove-stage" onClick={() => { if (window.confirm(`Excluir a etapa \"${stage.label}\"?`)) void removeStage(stage); }}><Trash2 size={13} /> Excluir etapa</button>}</div>
          </section>;
        })}
      </div>
      {expandedLeadId && (() => { const lead = leads.find((item) => item.id === expandedLeadId); if (!lead) return null; const ownerId = lead.closer_id || lead.sdr_id || ''; return <div className="kh-lead-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedLeadId(null); }}><section className="kh-lead-modal" role="dialog" aria-modal="true" aria-label={`Detalhes de ${lead.nome}`}><header><div><span className="kh-eyebrow">Lead comercial</span><h2>{lead.nome}</h2><p>{lead.empresa || 'Sem empresa informada'} · {memberMap.get(ownerId)?.nome || 'Sem responsavel'}</p></div><button type="button" className="kh-icon-button" aria-label="Fechar detalhes" onClick={() => setExpandedLeadId(null)}><X size={18} /></button></header><div className="kh-lead-modal-grid"><div><small>Telefone</small><strong>{lead.telefone || 'Não informado'}</strong></div><div><small>E-mail</small><strong>{lead.email || 'Não informado'}</strong></div><div><small>Origem</small><strong>{lead.origem || 'Não informado'}</strong></div><div><small>Status</small><strong>{lead.status}</strong></div><div><small>Entrada</small><strong>{lead.data_entrada ? new Date(lead.data_entrada).toLocaleString('pt-BR') : 'Não informado'}</strong></div><div><small>Prioridade</small><strong>{lead.prioridade || 'Não informada'}</strong></div></div><section className="kh-interactions"><div className="kh-card-task-title"><MessageSquare size={15} /><strong>Comentários e prints</strong></div><form className="kh-interaction-form" onSubmit={(event) => void addInteraction(event, lead.id)}><textarea className="kh-textarea" value={interactionText} onChange={(event) => setInteractionText(event.target.value)} placeholder="Registrar comentário sobre este lead..." /><div><label className="kh-file-button" htmlFor="lead-attachment"><Paperclip size={14} /> {interactionFile ? interactionFile.name : 'Anexar print'}</label><input id="lead-attachment" type="file" accept="image/*" onChange={(event) => setInteractionFile(event.target.files?.[0] || null)} /><button className="kh-button primary" disabled={interactionSaving}>{interactionSaving ? 'Salvando...' : 'Adicionar'}</button></div></form><div className="kh-interaction-list">{interactions.map((item) => <article key={item.id}><div><strong>{item.autor_nome}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></div>{item.comentario && <p>{item.comentario}</p>}{item.anexo_url && <a href={item.anexo_url} target="_blank" rel="noreferrer"><img src={item.anexo_url} alt={item.anexo_nome || 'Print anexado'} /></a>}</article>)}{!interactions.length && <span>Nenhum comentário ou print registrado.</span>}</div></section><form className="kh-card-task-form" onSubmit={(event) => void createLeadTask(event, lead)}><div className="kh-card-task-title"><CalendarPlus size={15} /><strong>Criar tarefa</strong></div><input className="kh-input" value={taskForm.titulo} onChange={(event) => setTaskForm((current) => ({ ...current, titulo: event.target.value }))} placeholder="Ex: Ligar para o lead" required /><div className="kh-card-task-fields"><select className="kh-select" value={taskForm.responsavel_id} onChange={(event) => setTaskForm((current) => ({ ...current, responsavel_id: event.target.value }))} disabled={role !== 'coordenador'} aria-label="Responsável">{members.filter((member) => member.ativo).map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}</select><input className="kh-input" type="datetime-local" value={taskForm.vencimento} onChange={(event) => setTaskForm((current) => ({ ...current, vencimento: event.target.value }))} aria-label="Prazo" /><select className="kh-select" value={taskForm.prioridade} onChange={(event) => setTaskForm((current) => ({ ...current, prioridade: event.target.value }))} aria-label="Prioridade"><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></div><textarea className="kh-textarea" value={taskForm.descricao} onChange={(event) => setTaskForm((current) => ({ ...current, descricao: event.target.value }))} placeholder="Observação opcional" /><button className="kh-button primary" disabled={taskSaving === lead.id}><CalendarPlus size={14} />{taskSaving === lead.id ? 'Salvando...' : 'Criar tarefa'}</button></form></section></div>; })()}
      {meetingMove && <div className="kh-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-modal-title"><button type="button" className="kh-modal-scrim" aria-label="Fechar" onClick={() => setMeetingMove(null)} /><form className="kh-modal-sheet kh-meeting-modal" onSubmit={(event) => void confirmMeetingMove(event)}><header><div><span>Reunião agendada</span><h2 id="meeting-modal-title">Informe data e horário</h2></div><button type="button" aria-label="Fechar" onClick={() => setMeetingMove(null)}><X size={18} /></button></header><div className="kh-meeting-form"><p>Informe quando a reunião acontecerá. O lead só será movido para esta etapa depois que o agendamento for registrado.</p><label><span>Data e horário da reunião</span><input className="kh-input" type="datetime-local" value={meetingAt} onChange={(event) => setMeetingAt(event.target.value)} required autoFocus /></label></div><footer><button type="button" className="kh-button" onClick={() => setMeetingMove(null)}>Cancelar</button><button type="submit" className="kh-button primary" disabled={meetingSaving}>{meetingSaving ? <RefreshCw size={15} className="kh-spin" /> : <CalendarPlus size={15} />} {meetingSaving ? 'Salvando...' : 'Confirmar agendamento'}</button></footer></form></div>}
      <CommercialLeadDetailsModal lead={expandedLeadId ? leads.find((lead) => lead.id === expandedLeadId) || null : null} members={members} canViewFinancials={canViewCommercialFinancials} onClose={() => setExpandedLeadId(null)} onEdit={() => { const lead = leads.find((item) => item.id === expandedLeadId); if (lead) { setExpandedLeadId(null); setEditingLead(lead); setModalOpen(true); } }} />
      <CommercialLeadModal open={modalOpen} members={members} stages={stages} initialStatus={initialStatus} lead={editingLead} canViewFinancials={canViewCommercialFinancials} onClose={() => { setModalOpen(false); setEditingLead(null); }} onSave={async (data) => { await api('/api/comercial/leads', { method: data.id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); await load(); }} />
    </div>
  );
}
