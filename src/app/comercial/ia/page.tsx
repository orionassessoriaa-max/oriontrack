'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, Clipboard, Clock3, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import type { CommercialLead } from '@/lib/comercial';

export default function CommercialAiPage() {
  const { api } = useCommercial();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [selected, setSelected] = useState<CommercialLead | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const payload = await api('/api/comercial/leads'); setLeads(payload.leads || []); } finally { setLoading(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const queue = useMemo(() => leads.filter((lead) => !['Negócio fechado', 'Perdido', 'Desqualificado', 'Fora do MQL'].includes(lead.status)).sort((a, b) => new Date(a.ultimo_contato_at || a.updated_at).getTime() - new Date(b.ultimo_contato_at || b.updated_at).getTime()), [leads]);
  async function generate(lead: CommercialLead) { setSelected(lead); setGenerating(true); setMessage(''); try { const payload = await api('/api/comercial/ai', { method: 'POST', body: JSON.stringify({ lead_id: lead.id }) }); setMessage(payload.message || ''); } finally { setGenerating(false); } }
  async function markContact() { if (!selected) return; await api('/api/comercial/leads', { method: 'PATCH', body: JSON.stringify({ id: selected.id, ultimo_contato_at: new Date().toISOString() }) }); await load(); }
  return (
    <div>
      <header className="kh-page-head"><div><div className="kh-eyebrow">Assistente comercial</div><h1>IA e follow-up</h1><p>Priorize quem precisa de contato e prepare uma abordagem natural para cada conversa.</p></div><button className="kh-icon-button" onClick={() => void load()} aria-label="Atualizar"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button></header>
      <section className="kh-ai-layout"><article className="kh-panel kh-ai-queue"><div className="kh-panel-header"><div><span>Fila recomendada</span><h2>Próximos contatos</h2></div><span>{queue.length} leads</span></div><div>{queue.map((lead) => { const last = new Date(lead.ultimo_contato_at || lead.updated_at); const hours = Math.max(0, Math.floor((Date.now() - last.getTime()) / 3_600_000)); return <button key={lead.id} className={selected?.id === lead.id ? 'active' : ''} onClick={() => void generate(lead)}><div className="kh-avatar">{lead.nome.split(' ').slice(0, 2).map((part) => part[0]).join('')}</div><div><strong>{lead.nome}</strong><span>{lead.status}</span></div><div><Clock3 size={13} /><span>{hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`} sem contato</span></div></button>; })}{!queue.length && <div className="kh-ai-empty"><Check size={22} /><span>A fila está em dia.</span></div>}</div></article>
        <article className="kh-panel kh-ai-composer"><div className="kh-ai-intro"><div className="kh-ai-mark"><Bot size={24} /></div><div><span>Copiloto de follow-up</span><h2>{selected ? selected.nome : 'Selecione um lead'}</h2><p>{selected ? 'A IA considera a etapa, a origem e as observações cadastradas.' : 'Escolha alguém na fila para gerar uma abordagem personalizada.'}</p></div></div><div className={`kh-ai-message ${generating ? 'loading' : ''}`}>{generating ? <><Sparkles className="kh-spin" size={20} /><span>Preparando abordagem...</span></> : message ? <p>{message}</p> : <><MessageSquareText size={26} /><span>A mensagem aparecerá aqui.</span></>}</div><footer><button className="kh-button" disabled={!message} onClick={async () => { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? 'Copiada' : 'Copiar mensagem'}</button><button className="kh-button primary" disabled={!selected || !message} onClick={() => void markContact()}><Check size={16} /> Marcar contato realizado</button></footer></article>
      </section>
    </div>
  );
}

