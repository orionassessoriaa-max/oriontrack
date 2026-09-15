'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, RefreshCw, Save, X } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { PROPOSTA_KRIPTO_IDS } from '@/lib/propostaKripto';

/**
 * Proposta comercial do Kripto.
 *
 * O HTML vem da rota /api/comercial/proposta, que exige token e checa o acesso.
 * Como a autenticacao do projeto viaja no cabecalho Authorization, um iframe
 * apontando direto para a rota entraria sem token e tomaria 401: por isso a
 * pagina busca o HTML, embrulha num blob e so entao entrega para o iframe.
 *
 * Iframe, e nao innerHTML, porque a proposta tem tema escuro e CSS global
 * proprio. Solta na pagina, ela reescreveria o visual do CRM inteiro.
 */
export default function PropostaKriptoPage() {
  const { isDevOps, currentProfileId, loading } = useCommercial();
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [nomeCliente, setNomeCliente] = useState('');
  const [leadsAgendados, setLeadsAgendados] = useState<Array<{ id: string; nome: string; empresa: string | null; reuniao_agendada_at: string | null }>>([]);
  const [leadId, setLeadId] = useState('');
  const [salvarAberto, setSalvarAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  // Trava de vitrine. A trava que vale e a da rota; esta so evita mostrar a
  // tela para quem tomaria 403 ao abrir.
  const liberado =
    isDevOps || Boolean(currentProfileId && PROPOSTA_KRIPTO_IDS.has(currentProfileId));

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { supabase } = await import('@/lib/supabase/client');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');

      const proposalId = new URLSearchParams(window.location.search).get('proposal_id');
      const resposta = await fetch(`/api/comercial/proposta${proposalId ? `?proposal_id=${encodeURIComponent(proposalId)}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resposta.ok) {
        const payload = await resposta.json().catch(() => ({}));
        throw new Error(payload.error || 'Não foi possível abrir a proposta.');
      }

      const html = await resposta.text();
      // Blob em vez de srcdoc: 1,6 MB dentro de um atributo trava o inspetor.
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const nova = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      urlRef.current = nova;
      setUrl(nova);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a proposta.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!liberado) {
      setCarregando(false);
      return;
    }
    carregar();
  }, [loading, liberado, carregar]);

  // Sem revogar, cada recarga deixa 1,6 MB preso na memoria da aba.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'orion-proposal-client-changed' && event.data.clientName) {
        setNomeCliente(String(event.data.clientName));
        setSalvarAberto(true);
      }
      if (event.data.type === 'orion-proposal-snapshot' && event.data.html) setSnapshot(String(event.data.html));
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const abrirSalvar = useCallback(async () => {
    setSalvarAberto(true);
    if (leadsAgendados.length) return;
    try {
      const { supabase } = await import('@/lib/supabase/client');
      const { data } = await supabase.auth.getSession();
      const response = await fetch('/api/comercial/proposta?mode=leads', { headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os leads agendados.');
      setLeadsAgendados(payload.leads || []);
    } catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível carregar os leads agendados.'); }
  }, [leadsAgendados.length]);

  useEffect(() => {
    if (salvarAberto && !leadsAgendados.length) void abrirSalvar();
  }, [salvarAberto, leadsAgendados.length, abrirSalvar]);

  const salvarProposta = useCallback(async () => {
    if (!nomeCliente || !leadId) { setErro('Informe o cliente e selecione o lead agendado.'); return; }
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Proposta comercial Orion"]');
    if (!snapshot) { frame?.contentWindow?.postMessage({ type: 'orion-proposal-snapshot-request' }, '*'); return; }
    setSalvando(true);
    try {
      const { supabase } = await import('@/lib/supabase/client');
      const { data } = await supabase.auth.getSession();
      const response = await fetch('/api/comercial/proposta', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: leadId, nome_cliente: nomeCliente, html_snapshot: snapshot }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar a proposta.');
      setSalvarAberto(false);
      setSnapshot(null);
    } catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível salvar a proposta.'); }
    finally { setSalvando(false); }
  }, [leadId, nomeCliente, snapshot]);

  if (loading) return <div className="kh-panel"><p style={{ opacity: 0.65 }}>Carregando…</p></div>;

  if (!liberado)
    return (
      <div className="kh-panel">
        <div className="kh-inline-error">
          Esta proposta é restrita ao Léo e aos administradores.
        </div>
      </div>
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          borderBottom: '1px solid rgba(0,0,0,.08)', paddingBottom: 12,
        }}
      >
        <FileText size={18} aria-hidden />
        <div style={{ marginRight: 'auto', minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 16 }}>Proposta comercial</strong>
          <span style={{ fontSize: 13, opacity: 0.65 }}>
            Visível apenas para o Léo e para os administradores.
          </span>
        </div>
        <button type="button" onClick={carregar} className="kh-button" disabled={carregando}>
          <RefreshCw size={14} aria-hidden /> {carregando ? 'Carregando…' : 'Recarregar'}
        </button>
        <button
          type="button"
          className="kh-button"
          disabled={!url}
          onClick={() => { if (url) window.open(url, '_blank', 'noopener'); }}
        >
          <ExternalLink size={14} aria-hidden /> Abrir em nova aba
        </button>
        <button type="button" className="kh-button" disabled={!url} onClick={() => void abrirSalvar()}>
          <Save size={14} aria-hidden /> Salvar proposta
        </button>
      </header>

      {erro && <div className="kh-inline-error">{erro}</div>}

      <div style={{ flex: 1, minHeight: 520, border: '1px solid rgba(0,0,0,.10)', borderRadius: 10, overflow: 'hidden', background: '#05080F' }}>
        {url ? (
          <iframe
            src={url}
            title="Proposta comercial Orion"
            // Sem allow-same-origin o conteudo roda numa origem propria e nao
            // alcanca a sessao do CRM. allow-popups deixa os links abrirem.
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            style={{ width: '100%', height: '100%', minHeight: 520, border: 0, display: 'block' }}
          />
        ) : (
          <div style={{ padding: 24, color: '#cfd3cc', fontSize: 14 }}>
            {carregando ? 'Carregando a proposta…' : 'Proposta não carregada.'}
          </div>
        )}
      </div>
      {salvarAberto && (
        <div className="kh-modal-backdrop" role="presentation" onMouseDown={() => !salvando && setSalvarAberto(false)}>
          <section className="kh-modal" role="dialog" aria-modal="true" aria-label="Salvar proposta" onMouseDown={(event) => event.stopPropagation()} style={{ maxWidth: 520 }}>
            <button type="button" className="kh-modal-close" onClick={() => setSalvarAberto(false)} aria-label="Fechar"><X size={18} /></button>
            <h2>Salvar proposta</h2>
            <p>Vincule esta apresentação a um lead que esteja em Reuniões agendadas.</p>
            <label className="kh-field"><span>Nome do cliente</span><input value={nomeCliente} onChange={(event) => { setNomeCliente(event.target.value); setSnapshot(null); }} autoFocus /></label>
            <label className="kh-field"><span>Lead da reunião</span><select value={leadId} onChange={(event) => setLeadId(event.target.value)}><option value="">Selecione o lead</option>{leadsAgendados.map((lead) => <option key={lead.id} value={lead.id}>{lead.nome}{lead.empresa ? ` - ${lead.empresa}` : ''}</option>)}</select></label>
            <div className="kh-modal-actions"><button type="button" className="kh-button" onClick={() => setSalvarAberto(false)} disabled={salvando}>Cancelar</button><button type="button" className="kh-button kh-button-primary" onClick={() => void salvarProposta()} disabled={salvando}>{snapshot ? (salvando ? 'Salvando...' : 'Salvar proposta') : 'Preparar proposta'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
