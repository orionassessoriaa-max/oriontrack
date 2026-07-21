'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GripVertical, Plus, RefreshCw, Search, UserRound, X } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import CommercialLeadModal from '@/components/commercial/CommercialLeadModal';
import { COMMERCIAL_STAGES, currency, type CommercialLead, type CommercialStage } from '@/lib/comercial';

export default function CommercialKanbanPage() {
  const { api, members, role, canViewCommercialFinancials } = useCommercial();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [stages, setStages] = useState<CommercialStage[]>(COMMERCIAL_STAGES);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [initialStatus, setInitialStatus] = useState('Oportunidade');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [stageDragging, setStageDragging] = useState<string | null>(null);
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageSaving, setStageSaving] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { const payload = await api('/api/comercial/leads'); setLeads(payload.leads || []); } finally { setLoading(false); } }, [api]);
  const loadStages = useCallback(async () => { try { const payload = await api('/api/comercial/stages'); if (payload.stages?.length) setStages(payload.stages); } catch { /* fallback ate a migration ser aplicada */ } }, [api]);
  useEffect(() => { void load(); void loadStages(); }, [load, loadStages]);

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
    setMovingId(id);
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, status } : lead));
    try { await api('/api/comercial/leads', { method: 'PATCH', body: JSON.stringify({ id, status }) }); } catch { await load(); } finally { setMovingId(null); }
  }
  async function saveStages(next: CommercialStage[]) {
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

  return (
    <div className={`kh-kanban-page ${canViewCommercialFinancials ? '' : 'kh-hide-commercial-financials'}`}>
      <header className="kh-page-head"><div><div className="kh-eyebrow">Pipeline de vendas</div><h1>Kanban</h1><p>Acompanhe a passagem do SDR para o closer e o avanco de cada negociacao.</p></div><div className="kh-actions"><div className="kh-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead..." /></div><input className="kh-input kh-date-filter" type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} aria-label="Data inicial" /><input className="kh-input kh-date-filter" type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} aria-label="Data final" /><button className="kh-icon-button" onClick={() => void load()} aria-label="Atualizar"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button><button className="kh-button primary" onClick={() => { setInitialStatus('Oportunidade'); setModalOpen(true); }}><Plus size={17} /> Novo lead</button></div></header>
      {stageError && <div className="kh-inline-error kh-stage-error">{stageError}<button type="button" aria-label="Fechar aviso" onClick={() => setStageError(null)}><X size={15} /></button></div>}
      {role === 'coordenador' && <div className="kh-kanban-toolbar"><span>Arraste uma coluna para reorganizar o funil.</span><button type="button" className="kh-button" onClick={() => setNewStageOpen(true)} disabled={stageSaving}>{stageSaving ? <RefreshCw size={16} className="kh-spin" /> : <Plus size={16} />} {stageSaving ? 'Salvando...' : 'Adicionar etapa'}</button></div>}
      {role === 'coordenador' && newStageOpen && <form className="kh-stage-add" onSubmit={addStage}><input autoFocus className="kh-input" value={newStageName} onChange={(event) => setNewStageName(event.target.value)} placeholder="Nome da nova etapa" maxLength={60} required /><button className="kh-button primary">Criar etapa</button><button type="button" className="kh-button" onClick={() => setNewStageOpen(false)}>Cancelar</button></form>}
      <div className="kh-kanban" aria-label="Pipeline comercial">
        {stages.map((stage, index) => {
          const statusLeads = grouped[stage.id] || [];
          const total = statusLeads.reduce((sum, lead) => sum + Number(lead.valor_negociacao || 0), 0);
          return <section key={stage.id} className={`kh-kanban-column ${dropStage === stage.id ? 'drop-target' : ''}`} onDragOver={(event) => event.preventDefault()} onDragEnter={() => dragging && setDropStage(stage.id)} onDragLeave={() => setDropStage(null)} onDrop={() => { if (dragging) void moveLead(dragging, stage.id); setDragging(null); setDropStage(null); }}>
            <header className={stageDragging === stage.id ? 'stage-dragging' : ''} draggable={role === 'coordenador'} onDragStart={() => role === 'coordenador' && setStageDragging(stage.id)} onDragEnd={() => setStageDragging(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); if (role === 'coordenador') reorderStages(stage.id); }} style={{ '--stage-hue': `${205 + (index * 7) % 105}` } as React.CSSProperties}><div><GripVertical size={14} className="kh-stage-grip" /><strong>{stage.label}</strong><b>{statusLeads.length}</b></div>{canViewCommercialFinancials && <small>{currency(total)}</small>}{role === 'coordenador' && <div className="kh-stage-actions">{stage.protected && <em>fixa</em>}{!stage.protected && <button type="button" aria-label={`Remover ${stage.label}`} onClick={() => void removeStage(stage)}><X size={12} /></button>}</div>}</header>
            <div className="kh-kanban-cards">{statusLeads.map((lead) => <article key={lead.id} draggable onDragStart={() => setDragging(lead.id)} onDragEnd={() => { setDragging(null); setDropStage(null); }} className={`${dragging === lead.id ? 'dragging' : ''} ${movingId === lead.id ? 'moving' : ''}`}><div className="kh-card-top"><span className={`kh-dot ${lead.lead_qualificado ? 'qualified' : ''}`} /><small>{lead.lead_qualificado ? 'MQL' : 'Lead'}</small></div><h3>{lead.nome}</h3><p>{lead.empresa || lead.telefone || 'Sem empresa informada'}</p><div className="kh-card-owner"><UserRound size={13} /><span>{memberMap.get(lead.closer_id || lead.sdr_id || '')?.nome || 'Sem responsavel'}</span></div><footer><strong>{currency(lead.valor_negociacao)}</strong><select aria-label="Mover etapa" value={lead.status} onChange={(event) => void moveLead(lead.id, event.target.value)} disabled={movingId === lead.id}>{stages.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></footer></article>)}{!statusLeads.length && <div className="kh-column-empty"><img src="/brand-logo.png" alt="ORION TRACK" className="kh-empty-logo" /><span>Sem leads</span></div>}<button type="button" className="kh-add-lead-column" onClick={() => { setInitialStatus(stage.id); setModalOpen(true); }}><Plus size={16} /> Adicionar lead</button></div>
          </section>;
        })}
      </div>
      <CommercialLeadModal open={modalOpen} members={members} stages={stages} initialStatus={initialStatus} canViewFinancials={canViewCommercialFinancials} onClose={() => setModalOpen(false)} onSave={async (data) => { await api('/api/comercial/leads', { method: 'POST', body: JSON.stringify(data) }); await load(); }} />
    </div>
  );
}
