'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckSquare2, Download, Edit3, Plus, RefreshCw, Search, Square, X } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import CommercialLeadModal from '@/components/commercial/CommercialLeadModal';
import { COMMERCIAL_STATUSES, type CommercialLead } from '@/lib/comercial';

function formatDate(value: string) { return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

export default function CommercialLeadsPage() {
  const { api, members, canViewCommercialFinancials } = useCommercial();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('todos');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CommercialLead | null>(null);
  const load = useCallback(async () => { setLoading(true); try { const payload = await api('/api/comercial/leads'); setLeads(payload.leads || []); } finally { setLoading(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => leads.filter((lead) => { const values = [lead.nome, lead.telefone, lead.email, lead.ja_investiu_trafego, lead.faturamento_mensal, lead.prioridade, lead.investimento, lead.vidas, lead.status, lead.negocio_etapa, lead.utm_source, lead.utm_medium, lead.utm_campaign, lead.utm_term, lead.utm_content]; const haystack = values.map((value) => String(value || '')).join(' ').toLowerCase(); return (!search || haystack.includes(search.toLowerCase())) && (status === 'todos' || lead.status === status); }), [leads, search, status]);
  const columnCount = canViewCommercialFinancials ? 19 : 16;
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAll() { setSelected((current) => current.size === visible.length ? new Set() : new Set(visible.map((lead) => lead.id))); }
  async function updateLead(id: string, changes: Record<string, unknown>) { setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, ...changes } : lead)); try { await api('/api/comercial/leads', { method: 'PATCH', body: JSON.stringify({ id, ...changes }) }); } catch (error) { await load(); throw error; } }
  async function bulkStatus(nextStatus: string) { await Promise.all(Array.from(selected).map((id) => updateLead(id, { status: nextStatus }))); setSelected(new Set()); }
  function exportCsv() {
    const headers = ['DATA', 'NOME', 'TELEFONE', 'EMAIL', ...(canViewCommercialFinancials ? ['JÁ INVESTIU EM TRÁFEGO?', 'FATURAMENTO MENSAL'] : []), 'PRIORIDADE', ...(canViewCommercialFinancials ? ['INVESTIMENTO'] : []), 'VIDAS', 'STATUS', 'ETAPA', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    const rows = visible.map((lead) => [formatDate(lead.data_entrada), lead.nome, lead.telefone || '', lead.email || '', ...(canViewCommercialFinancials ? [lead.ja_investiu_trafego || '', lead.faturamento_mensal || ''] : []), lead.prioridade || '', ...(canViewCommercialFinancials ? [lead.investimento || ''] : []), lead.vidas || '', lead.status, lead.negocio_etapa || '', lead.utm_source || '', lead.utm_medium || '', lead.utm_campaign || '', lead.utm_term || '', lead.utm_content || '']);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })); link.download = `leads-comercial-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }

  return <div>
    <header className="kh-page-head"><div><div className="kh-eyebrow">Central de leads</div><h1>Leads</h1><p>Planilha comercial com os dados de qualificação, origem e acompanhamento.</p></div><div className="kh-actions"><button className="kh-button" onClick={exportCsv}><Download size={16} /> Exportar</button><button className="kh-icon-button" onClick={() => void load()} aria-label="Atualizar"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button><button className="kh-button primary" onClick={() => { setEditing(null); setModalOpen(true); }}><Plus size={17} /> Adicionar lead</button></div></header>
    <section className="kh-sheet-filters"><div className="kh-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, telefone ou e-mail..." /></div><select className="kh-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todas as etapas</option>{COMMERCIAL_STATUSES.map((item) => <option key={item}>{item}</option>)}</select><span>{visible.length} de {leads.length} leads</span></section>
    <section className="kh-sheet-wrap"><table className="kh-sheet-table"><thead><tr><th className="select"><button onClick={toggleAll} aria-label="Selecionar todos">{selected.size === visible.length && visible.length ? <CheckSquare2 size={16} /> : <Square size={16} />}</button></th><th>#</th><th>DATA</th><th>NOME</th><th>TELEFONE</th><th>EMAIL</th>{canViewCommercialFinancials && <><th>JÁ INVESTIU EM TRÁFEGO?</th><th>FATURAMENTO MENSAL</th></>}<th>PRIORIDADE</th>{canViewCommercialFinancials && <th>INVESTIMENTO</th>}<th>VIDAS</th><th>STATUS</th><th>ETAPA</th><th>utm_source</th><th>utm_medium</th><th>utm_campaign</th><th>utm_term</th><th>utm_content</th><th aria-label="Ações" /></tr></thead><tbody>{visible.map((lead, index) => <tr key={lead.id} className={selected.has(lead.id) ? 'selected' : ''}><td className="select"><button onClick={() => toggle(lead.id)} aria-label={`Selecionar ${lead.nome}`}>{selected.has(lead.id) ? <CheckSquare2 size={15} /> : <Square size={15} />}</button></td><td>{index + 1}</td><td>{formatDate(lead.data_entrada)}</td><td className="name">{lead.nome}</td><td>{lead.telefone || '-'}</td><td>{lead.email || '-'}</td>{canViewCommercialFinancials && <><td>{lead.ja_investiu_trafego || '-'}</td><td>{lead.faturamento_mensal || '-'}</td></>}<td>{lead.prioridade || '-'}</td>{canViewCommercialFinancials && <td>{lead.investimento || '-'}</td>}<td>{lead.vidas || '-'}</td><td><select value={lead.status} onChange={(event) => void updateLead(lead.id, { status: event.target.value })}>{COMMERCIAL_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></td><td>{lead.negocio_etapa || '-'}</td><td>{lead.utm_source || '-'}</td><td>{lead.utm_medium || '-'}</td><td>{lead.utm_campaign || '-'}</td><td>{lead.utm_term || '-'}</td><td>{lead.utm_content || '-'}</td><td><button className="kh-row-action" aria-label={`Editar ${lead.nome}`} onClick={() => { setEditing(lead); setModalOpen(true); }}><Edit3 size={15} /></button></td></tr>)}{!visible.length && <tr><td colSpan={columnCount} className="kh-table-empty">{loading ? 'Carregando leads...' : 'Nenhum lead encontrado com esses filtros.'}</td></tr>}</tbody></table></section>
    {selected.size > 0 && <div className="kh-bulk-bar"><strong>{selected.size} selecionado{selected.size > 1 ? 's' : ''}</strong><select className="kh-select" defaultValue="" onChange={(event) => { if (event.target.value) void bulkStatus(event.target.value); }}><option value="" disabled>Mover para etapa...</option>{COMMERCIAL_STATUSES.map((item) => <option key={item}>{item}</option>)}</select><button aria-label="Limpar seleção" onClick={() => setSelected(new Set())}><X size={17} /></button></div>}
    <CommercialLeadModal open={modalOpen} members={members} canViewFinancials={canViewCommercialFinancials} lead={editing} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={async (data) => { if (editing) await updateLead(editing.id, data); else await api('/api/comercial/leads', { method: 'POST', body: JSON.stringify(data) }); await load(); }} />
  </div>;
}
