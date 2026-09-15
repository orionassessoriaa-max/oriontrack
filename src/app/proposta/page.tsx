'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ScheduledLead = { id: string; nome: string; empresa: string | null };

export default function PropostaApresentacaoPage() {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nomeCliente, setNomeCliente] = useState('');
  const [leadId, setLeadId] = useState('');
  const [leads, setLeads] = useState<ScheduledLead[]>([]);
  const [salvarAberto, setSalvarAberto] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const urlRef = useRef<string | null>(null);

  const token = useCallback(async () => {
    const { supabase } = await import('@/lib/supabase/client');
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
    return data.session.access_token;
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const query = new URLSearchParams(window.location.search);
        const proposalId = query.get('proposal_id');
        const initialLeadId = query.get('lead_id');
        if (initialLeadId) setLeadId(initialLeadId);
        const search = proposalId
          ? `?proposal_id=${encodeURIComponent(proposalId)}`
          : initialLeadId ? `?lead_id=${encodeURIComponent(initialLeadId)}` : '';
        const response = await fetch(`/api/comercial/proposta${search}`, { headers: { Authorization: `Bearer ${await token()}` } });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Não foi possível abrir a proposta.');
        const next = URL.createObjectURL(new Blob([await response.text()], { type: 'text/html' }));
        urlRef.current = next;
        setUrl(next);
      } catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível abrir a proposta.'); }
    }
    void load();
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [token]);

  const loadLeads = useCallback(async () => {
    if (leads.length) return;
    try {
      const response = await fetch('/api/comercial/proposta?mode=leads', { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os leads agendados.');
      setLeads(payload.leads || []);
    } catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível carregar os leads agendados.'); }
  }, [leads.length, token]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'orion-proposal-client-changed' && event.data.clientName) {
        setNomeCliente(String(event.data.clientName));
        setSalvarAberto(true);
        void loadLeads();
      }
      if (event.data.type === 'orion-proposal-snapshot' && event.data.html) setSnapshot(String(event.data.html));
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [loadLeads]);

  async function save() {
    if (!nomeCliente || !leadId) { setErro('Informe o cliente e selecione o lead agendado.'); return; }
    if (!snapshot) { document.querySelector<HTMLIFrameElement>('iframe')?.contentWindow?.postMessage({ type: 'orion-proposal-snapshot-request' }, '*'); return; }
    setSalvando(true);
    try {
      const response = await fetch('/api/comercial/proposta', { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: leadId, nome_cliente: nomeCliente, html_snapshot: snapshot }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar a proposta.');
      setSnapshot(null); setSalvarAberto(false);
    } catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível salvar a proposta.'); }
    finally { setSalvando(false); }
  }

  if (erro && !url) return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#05080f', color: '#f7f9fc', padding: 24 }}>{erro}</main>;
  return <main style={{ minHeight: '100dvh', background: '#05080f' }}>
    {url && <iframe src={url} title="Proposta comercial Orion" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" style={{ display: 'block', width: '100vw', height: '100dvh', border: 0 }} />}
    {erro && <p style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 10, color: '#ffd2d2' }}>{erro}</p>}
    {salvarAberto && <div onMouseDown={() => !salvando && setSalvarAberto(false)} style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.68)', padding: 20 }}>
      <section onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(460px,100%)', borderRadius: 14, padding: 24, background: '#0b1422', color: '#f7f9fc', boxShadow: '0 20px 80px rgba(0,0,0,.5)' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Salvar proposta</h1><p style={{ color: '#a9b8cb' }}>Selecione o lead que está em Reuniões agendadas.</p>
        <input value={nomeCliente} onChange={(event) => { setNomeCliente(event.target.value); setSnapshot(null); }} placeholder="Nome do cliente" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12, padding: 11, borderRadius: 8, border: '1px solid #31465d', background: '#07101c', color: 'white' }} />
        <select value={leadId} onChange={(event) => setLeadId(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 20, padding: 11, borderRadius: 8, border: '1px solid #31465d', background: '#07101c', color: 'white' }}><option value="">Selecione o lead</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.nome}{lead.empresa ? ` - ${lead.empresa}` : ''}</option>)}</select>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button onClick={() => setSalvarAberto(false)}>Cancelar</button><button onClick={() => void save()} disabled={salvando}>{snapshot ? (salvando ? 'Salvando...' : 'Salvar proposta') : 'Preparar proposta'}</button></div>
      </section>
    </div>}
  </main>;
}
