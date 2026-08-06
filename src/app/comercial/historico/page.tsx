'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, FileText, Image, Loader2, MessageSquare, RefreshCw, Search, UserRound } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';

type Lead = { id: string; nome: string; telefone: string | null; email: string | null; status: string; empresa: string | null; data_entrada: string; updated_at: string; sdr_id: string | null; closer_id: string | null; observacoes: string | null; utm_source: string | null; utm_campaign: string | null };
type Interaction = { id: string; lead_id: string; autor_id: string | null; comentario: string | null; anexo_url: string | null; anexo_nome: string | null; created_at: string };
type Task = { id: string; lead_id: string | null; responsavel_id: string; titulo: string; descricao: string | null; vencimento: string | null; status: string; prioridade: string; created_at: string };
type Profile = { id: string; nome: string | null; email: string | null };

function dateTime(value?: string | null) { return value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'; }

export default function CommercialHistoryPage() {
  const { api } = useCommercial();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const payload = await api('/api/comercial/historico');
      setLeads(payload.leads || []); setInteractions(payload.interactions || []); setTasks(payload.tasks || []); setProfiles(payload.profiles || []);
      const requestedLeadId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lead_id') : null;
      setSelectedId((current: string | null) => requestedLeadId && (payload.leads || []).some((lead: Lead) => lead.id === requestedLeadId)
        ? requestedLeadId
        : current && (payload.leads || []).some((lead: Lead) => lead.id === current) ? current : payload.leads?.[0]?.id || null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Nao foi possivel carregar o historico.'); }
    finally { setLoading(false); }
  }, [api]);

  // The request hydrates this screen from the API after the commercial shell is ready.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const statuses = useMemo(() => Array.from(new Set(leads.map((lead) => lead.status).filter(Boolean))), [leads]);
  const visible = useMemo(() => leads.filter((lead) => {
    const text = [lead.nome, lead.telefone, lead.email, lead.empresa, lead.status, lead.utm_source, lead.utm_campaign].join(' ').toLowerCase();
    return (!search || text.includes(search.toLowerCase())) && (status === 'todos' || lead.status === status);
  }), [leads, search, status]);
  const selected = visible.find((lead) => lead.id === selectedId) || visible[0] || null;
  const selectedInteractions = selected ? interactions.filter((item) => item.lead_id === selected.id) : [];
  const selectedTasks = selected ? tasks.filter((item) => item.lead_id === selected.id) : [];
  const profileName = (id: string | null) => profiles.find((profile) => profile.id === id)?.nome || 'Equipe comercial';

  return <div>
    <header className="kh-page-head"><div><div className="kh-eyebrow">Comercial</div><h1>Historico dos leads</h1><p>Conversas internas, tarefas, comentarios e movimentacoes do time comercial.</p></div><button className="kh-icon-button" type="button" onClick={() => void load()} aria-label="Atualizar historico"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button></header>
    <section className="kh-history-toolbar"><div className="kh-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead, empresa ou contato..." /></div><select className="kh-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos os status</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select><span>{visible.length} leads</span></section>
    {error && <div className="kh-inline-error">{error}</div>}
    {loading ? <div className="kh-history-empty"><Loader2 className="kh-spin" size={28} /> Carregando historico...</div> : <section className="kh-history-layout">
      <aside className="kh-history-list">{visible.map((lead) => <button type="button" key={lead.id} className={lead.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(lead.id)}><div><strong>{lead.nome}</strong><small>{lead.empresa || lead.email || lead.telefone || 'Sem contato'}</small></div><time>{dateTime(lead.updated_at).slice(0, 5)}</time><em>{lead.status}</em></button>)}{!visible.length && <div className="kh-history-empty">Nenhum lead encontrado.</div>}</aside>
      <article className="kh-history-detail">{selected ? <><div className="kh-history-lead-head"><div><div className="kh-eyebrow">Linha do tempo</div><h2>{selected.nome}</h2><p>{selected.email || selected.telefone || 'Contato nao informado'} · {selected.status}</p></div><span><UserRound size={14} /> SDR: {profileName(selected.sdr_id)}</span></div><div className="kh-history-meta"><span><CalendarDays size={14} /> Entrada: {dateTime(selected.data_entrada)}</span><span>Closer: {profileName(selected.closer_id)}</span>{selected.utm_campaign && <span>Campanha: {selected.utm_campaign}</span>}</div><div className="kh-history-events">{[...selectedInteractions.map((item) => ({ id: item.id, date: item.created_at, icon: item.anexo_url ? Image : MessageSquare, title: item.comentario || item.anexo_nome || 'Anexo adicionado', detail: `${profileName(item.autor_id)}${item.anexo_url ? ' · imagem anexada' : ''}`, link: item.anexo_url })), ...selectedTasks.map((task) => ({ id: `task-${task.id}`, date: task.created_at, icon: CheckCircle2, title: task.titulo, detail: `Tarefa ${task.status} · ${profileName(task.responsavel_id)}`, link: null }))].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((event) => { const Icon = event.icon; return <div className="kh-history-event" key={event.id}><div className="kh-history-event-icon"><Icon size={15} /></div><div><strong>{event.title}</strong><small>{event.detail} · {dateTime(event.date)}</small>{event.link && <a href={event.link} target="_blank" rel="noreferrer">Abrir anexo</a>}</div></div>; })}{!selectedInteractions.length && !selectedTasks.length && <div className="kh-history-empty"><FileText size={24} /> Nenhuma interacao registrada para este lead.</div>}</div></> : <div className="kh-history-empty">Selecione um lead para ver o historico.</div>}</article>
    </section>}
  </div>;
}
