'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, CheckCircle2, Circle, Clock3, Edit3, Plus, RefreshCw, UserRound, X } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import type { CommercialLead, CommercialTask } from '@/lib/comercial';

function dueState(task: CommercialTask) {
  if (task.status === 'concluida') return 'done';
  if (!task.vencimento) return 'later';
  const due = new Date(task.vencimento);
  const now = new Date();
  if (due.getTime() < now.getTime()) return 'late';
  if (due.toDateString() === now.toDateString()) return 'today';
  return 'later';
}

export default function CommercialTasksPage() {
  const { api, members, currentProfileId, role } = useCommercial();
  const [tasks, setTasks] = useState<CommercialTask[]>([]);
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<CommercialTask | null>(null);
  const [form, setForm] = useState({ titulo: '', descricao: '', vencimento: '', prioridade: 'normal', responsavel_id: currentProfileId || '', lead_id: '' });
  const [saving, setSaving] = useState(false);
  const [prefillHandled, setPrefillHandled] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const [taskPayload, leadPayload] = await Promise.all([api('/api/comercial/tasks'), api('/api/comercial/leads')]); setTasks(taskPayload.tasks || []); setLeads(leadPayload.leads || []); } finally { setLoading(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!form.responsavel_id && currentProfileId) setForm((value) => ({ ...value, responsavel_id: currentProfileId })); }, [currentProfileId, form.responsavel_id]);
  useEffect(() => {
    if (prefillHandled || !leads.length || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('novo') !== '1') { setPrefillHandled(true); return; }
    const leadId = params.get('lead_id') || '';
    const lead = leads.find((item) => item.id === leadId);
    const requestedResponsible = params.get('responsavel_id') || currentProfileId || '';
    setEditingTask(null);
    setForm({
      titulo: lead ? `Retorno com ${lead.nome}` : 'Retorno comercial',
      descricao: lead ? `Dar continuidade ao atendimento de ${lead.nome}.` : '',
      vencimento: '',
      prioridade: 'normal',
      responsavel_id: role === 'coordenador' ? requestedResponsible : currentProfileId || '',
      lead_id: lead?.id || '',
    });
    setOpen(true);
    setPrefillHandled(true);
    window.history.replaceState({}, '', '/comercial/tarefas');
  }, [currentProfileId, leads, prefillHandled, role]);
  const memberMap = useMemo(() => new Map(members.map((member) => [member.profile_id, member])), [members]);
  const groups = useMemo(() => ({ late: tasks.filter((task) => dueState(task) === 'late'), today: tasks.filter((task) => dueState(task) === 'today'), later: tasks.filter((task) => dueState(task) === 'later'), done: tasks.filter((task) => dueState(task) === 'done') }), [tasks]);
  async function complete(task: CommercialTask) { setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: task.status === 'concluida' ? 'pendente' : 'concluida' } : item)); await api('/api/comercial/tasks', { method: 'PATCH', body: JSON.stringify({ id: task.id, status: task.status === 'concluida' ? 'pendente' : 'concluida' }) }); }
  function openNewTask() { setEditingTask(null); setForm({ titulo: '', descricao: '', vencimento: '', prioridade: 'normal', responsavel_id: currentProfileId || '', lead_id: '' }); setOpen(true); }
  function openTaskEditor(task: CommercialTask) {
    const due = task.vencimento ? new Date(task.vencimento) : null;
    const vencimento = due && !Number.isNaN(due.getTime())
      ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}T${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`
      : '';
    setEditingTask(task);
    setForm({ titulo: task.titulo, descricao: task.descricao || '', vencimento, prioridade: task.prioridade || 'normal', responsavel_id: task.responsavel_id || currentProfileId || '', lead_id: task.lead_id || '' });
    setOpen(true);
  }
  async function create(event: React.FormEvent) { event.preventDefault(); setSaving(true); try { await api('/api/comercial/tasks', { method: editingTask ? 'PATCH' : 'POST', body: JSON.stringify({ ...(editingTask ? { id: editingTask.id } : {}), ...form, vencimento: form.vencimento ? new Date(form.vencimento).toISOString() : null }) }); setOpen(false); setEditingTask(null); setForm({ titulo: '', descricao: '', vencimento: '', prioridade: 'normal', responsavel_id: currentProfileId || '', lead_id: '' }); await load(); } finally { setSaving(false); } }
  const sections = [{ key: 'late', title: 'Atrasadas', icon: Clock3, tone: 'red' }, { key: 'today', title: 'Hoje', icon: CalendarClock, tone: 'yellow' }, { key: 'later', title: 'Próximas', icon: Circle, tone: 'blue' }, { key: 'done', title: 'Concluídas', icon: CheckCircle2, tone: 'green' }] as const;
  return (
    <div>
      <header className="kh-page-head"><div><div className="kh-eyebrow">Rotina comercial</div><h1>Tarefas</h1><p>{role === 'coordenador' ? 'Acompanhe as entregas do Léo, do Renan e da coordenação.' : 'Organize seus contatos, reuniões e próximos passos.'}</p></div><div className="kh-actions"><button className="kh-icon-button" onClick={() => void load()} aria-label="Atualizar"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button><button className="kh-button primary" onClick={openNewTask}><Plus size={17} /> Nova tarefa</button></div></header>
      <section className="kh-task-summary">{sections.map((section) => <div key={section.key} className={section.tone}><section.icon size={17} /><span>{section.title}</span><strong>{groups[section.key].length}</strong></div>)}</section>
      <section className="kh-task-board">{sections.map((section) => <article key={section.key} className={`kh-task-section ${section.tone}`}><header><div><span className="kh-task-section-icon"><section.icon size={16} /></span><h2>{section.title}</h2></div><span>{groups[section.key].length}</span></header><div>{groups[section.key].map((task) => <div key={task.id} className="kh-task-row" role="button" tabIndex={0} onClick={() => void complete(task)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void complete(task); }}><span className={`kh-task-check ${task.status === 'concluida' ? 'done' : ''}`}>{task.status === 'concluida' && <Check size={13} />}</span><div><strong>{task.titulo}</strong><p>{task.lead?.nome || task.descricao || 'Tarefa interna'}</p></div><div className="kh-task-owner"><UserRound size={13} /><span>{memberMap.get(task.responsavel_id)?.nome || 'Responsável'}</span></div><time>{task.vencimento ? new Date(task.vencimento).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sem prazo'}</time><span className={`kh-priority ${task.prioridade}`}>{task.prioridade}</span><button type="button" className="kh-icon-button" title="Editar tarefa" aria-label={`Editar ${task.titulo}`} onClick={(event) => { event.stopPropagation(); openTaskEditor(task); }}><Edit3 size={14} /></button></div>)}{!groups[section.key].length && <div className="kh-task-empty">Nenhuma tarefa nesta seção.</div>}</div></article>)}</section>
      {open && <div className="kh-modal" role="dialog" aria-modal="true"><button className="kh-modal-scrim" onClick={() => { setOpen(false); setEditingTask(null); }} aria-label="Fechar" /><form className="kh-modal-sheet kh-task-modal" onSubmit={create}><header><div><span>Rotina comercial</span><h2>{editingTask ? 'Editar tarefa' : 'Nova tarefa'}</h2></div><button type="button" onClick={() => { setOpen(false); setEditingTask(null); }} aria-label="Fechar"><X size={20} /></button></header><div className="kh-form-grid"><label className="wide"><span>Título</span><input className="kh-input" value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} required /></label><label><span>Responsável</span><select className="kh-select" value={form.responsavel_id} onChange={(event) => setForm({ ...form, responsavel_id: event.target.value })} disabled={role !== 'coordenador'}>{members.filter((member) => member.ativo).map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}</select></label><label><span>Lead relacionado</span><select className="kh-select" value={form.lead_id} onChange={(event) => setForm({ ...form, lead_id: event.target.value })}><option value="">Tarefa interna</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.nome}</option>)}</select></label><label><span>Prazo</span><input className="kh-input" type="datetime-local" value={form.vencimento} onChange={(event) => setForm({ ...form, vencimento: event.target.value })} /></label><label><span>Prioridade</span><select className="kh-select" value={form.prioridade} onChange={(event) => setForm({ ...form, prioridade: event.target.value })}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></label><label className="wide"><span>Descrição</span><textarea className="kh-textarea" value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} /></label></div><footer><button type="button" className="kh-button" onClick={() => { setOpen(false); setEditingTask(null); }}>Cancelar</button><button className="kh-button primary" disabled={saving}>{saving ? 'Salvando...' : editingTask ? 'Salvar alterações' : 'Criar tarefa'}</button></footer></form></div>}
    </div>
  );
}
