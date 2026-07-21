'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Plus, RefreshCw, Search, UserRound } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import CommercialLeadModal from '@/components/commercial/CommercialLeadModal';
import { COMMERCIAL_STATUSES, currency, type CommercialLead } from '@/lib/comercial';

export default function CommercialKanbanPage() {
  const { api, members, canViewCommercialFinancials } = useCommercial();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); try { const payload = await api('/api/comercial/leads'); setLeads(payload.leads || []); } finally { setLoading(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const memberMap = useMemo(() => new Map(members.map((member) => [member.profile_id, member])), [members]);
  const visible = useMemo(() => leads.filter((lead) => [lead.nome, lead.empresa, lead.telefone].join(' ').toLowerCase().includes(search.toLowerCase())), [leads, search]);
  const grouped = useMemo(() => Object.fromEntries(COMMERCIAL_STATUSES.map((status) => [status, visible.filter((lead) => lead.status === status)])), [visible]);
  async function moveLead(id: string, status: string) {
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, status } : lead));
    try { await api('/api/comercial/leads', { method: 'PATCH', body: JSON.stringify({ id, status }) }); }
    catch { await load(); }
  }
  return (
    <div className={`kh-kanban-page ${canViewCommercialFinancials ? '' : 'kh-hide-commercial-financials'}`}>
      <header className="kh-page-head"><div><div className="kh-eyebrow">Pipeline de vendas</div><h1>Kanban</h1><p>Acompanhe a passagem do SDR para o closer e o avanço de cada negociação.</p></div><div className="kh-actions"><div className="kh-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead..." /></div><button className="kh-icon-button" onClick={() => void load()} aria-label="Atualizar"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button><button className="kh-button primary" onClick={() => setModalOpen(true)}><Plus size={17} /> Novo lead</button></div></header>
      <div className="kh-kanban" aria-label="Pipeline comercial">
        {COMMERCIAL_STATUSES.map((status, index) => {
          const statusLeads = grouped[status] || [];
          const total = statusLeads.reduce((sum, lead) => sum + Number(lead.valor_negociacao || 0), 0);
          return <section key={status} className="kh-kanban-column" onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging) void moveLead(dragging, status); setDragging(null); }}>
            <header style={{ '--stage-hue': `${205 + (index * 7) % 105}` } as React.CSSProperties}><div><span>{String(index + 1).padStart(2, '0')}</span><strong>{status}</strong><b>{statusLeads.length}</b></div>{canViewCommercialFinancials && <small>{currency(total)}</small>}</header>
            <div className="kh-kanban-cards">{statusLeads.map((lead) => <article key={lead.id} draggable onDragStart={() => setDragging(lead.id)} onDragEnd={() => setDragging(null)} className={dragging === lead.id ? 'dragging' : ''}><div className="kh-card-top"><span className={`kh-dot ${lead.lead_qualificado ? 'qualified' : ''}`} /><small>{lead.lead_qualificado ? 'MQL' : 'Lead'}</small></div><h3>{lead.nome}</h3><p>{lead.empresa || lead.telefone || 'Sem empresa informada'}</p><div className="kh-card-owner"><UserRound size={13} /><span>{memberMap.get(lead.closer_id || lead.sdr_id || '')?.nome || 'Sem responsável'}</span></div><footer><strong>{currency(lead.valor_negociacao)}</strong><select aria-label="Mover etapa" value={lead.status} onChange={(event) => void moveLead(lead.id, event.target.value)}>{COMMERCIAL_STATUSES.map((option) => <option key={option}>{option}</option>)}</select></footer></article>)}{!statusLeads.length && <div className="kh-column-empty"><BriefcaseBusiness size={18} /><span>Sem leads</span></div>}</div>
          </section>;
        })}
      </div>
      <CommercialLeadModal open={modalOpen} members={members} canViewFinancials={canViewCommercialFinancials} onClose={() => setModalOpen(false)} onSave={async (data) => { await api('/api/comercial/leads', { method: 'POST', body: JSON.stringify(data) }); await load(); }} />
    </div>
  );
}
