'use client';

import { Download, Maximize2, Minimize2, Pencil, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type ScheduledLead = { id: string; nome: string; empresa: string | null };
type ProposalState = { client?: string; texts?: Record<string, string>; mod?: string; prices?: unknown };
type ProposalFrameWindow = Window & { __ORION_COLLECT__?: () => ProposalState };
type SaveMode = 'update' | 'copy';

const buttonStyle = {
  minHeight: 44,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  borderRadius: 9, border: '1px solid rgba(255,255,255,.18)',
  background: 'rgba(9,18,30,.88)', color: '#edf1f8', padding: '9px 13px',
  fontFamily: 'Outfit, Segoe UI, sans-serif', fontSize: 13, cursor: 'pointer',
  backdropFilter: 'blur(10px)',
} as const;

export default function PropostaApresentacaoPage() {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [nomeCliente, setNomeCliente] = useState('');
  const [leadId, setLeadId] = useState('');
  const [currentProposalId, setCurrentProposalId] = useState<string | null>(null);
  const [leads, setLeads] = useState<ScheduledLead[]>([]);
  const [salvarAberto, setSalvarAberto] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const urlRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoDownloadStartedRef = useRef(false);

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
        const search = proposalId ? `?proposal_id=${encodeURIComponent(proposalId)}` : initialLeadId ? `?lead_id=${encodeURIComponent(initialLeadId)}` : '';
        const response = await fetch(`/api/comercial/proposta${search}`, { headers: { Authorization: `Bearer ${await token()}` } });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Não foi possível abrir a proposta.');

        const loadedProposalId = response.headers.get('X-Orion-Proposal-Id');
        const loadedLeadId = response.headers.get('X-Orion-Lead-Id');
        const encodedName = response.headers.get('X-Orion-Client-Name');
        setCurrentProposalId(loadedProposalId);
        if (loadedLeadId) setLeadId(loadedLeadId);
        if (encodedName) {
          try { setNomeCliente(decodeURIComponent(encodedName)); } catch { setNomeCliente(encodedName); }
        }

        const next = URL.createObjectURL(new Blob([await response.text()], { type: 'text/html' }));
        urlRef.current = next;
        setUrl(next);
      } catch (error) {
        setErro(error instanceof Error ? error.message : 'Não foi possível abrir a proposta.');
      }
    }
    void load();
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [token]);

  const loadLeads = useCallback(async (includeLeadId?: string) => {
    try {
      const suffix = includeLeadId ? `?mode=leads&include_lead_id=${encodeURIComponent(includeLeadId)}` : '?mode=leads';
      const response = await fetch(`/api/comercial/proposta${suffix}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os leads agendados.');
      setLeads(payload.leads || []);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível carregar os leads agendados.');
    }
  }, [token]);

  const collectSnapshot = useCallback(() => {
    const documentFrame = iframeRef.current?.contentDocument;
    const windowFrame = iframeRef.current?.contentWindow as ProposalFrameWindow | null;
    if (!documentFrame || !windowFrame) return null;
    const state = windowFrame.__ORION_COLLECT__?.() || {};
    const serializedState = JSON.stringify(state).replace(/<\/script/gi, '<\\/script');
    const clone = documentFrame.documentElement.cloneNode(true) as HTMLElement;
    const body = clone.querySelector('body');
    body?.classList.remove('editing', 'idle', 'library', 'parent-fullscreen');
    clone.querySelector('#viewport')?.removeAttribute('style');
    clone.querySelector('#stage')?.removeAttribute('style');
    clone.querySelectorAll('[contenteditable]').forEach((element) => element.removeAttribute('contenteditable'));
    clone.querySelectorAll('.zone.open').forEach((element) => element.classList.remove('open'));
    const slides = Array.from(clone.querySelectorAll('.slide'));
    slides.forEach((slide, index) => {
      slide.classList.remove('is-active', 'is-out');
      slide.removeAttribute('style');
      if (index === 0) slide.classList.add('is-active');
    });
    const dots = clone.querySelector('#dots');
    if (dots) dots.innerHTML = '';
    const counter = clone.querySelector('#counter');
    if (counter) counter.textContent = `01 / ${String(slides.length).padStart(2, '0')}`;
    clone.querySelectorAll('#orionProposalBridge,#orionProposalPreflight,#orionProposalInitialState,#orionProposalHostStyle,#orion-pdf-capture-style').forEach((element) => element.remove());
    clone.querySelectorAll('script:not(#pageScript)').forEach((script) => {
      if (script.textContent?.includes('window.__ORION_BAKED__')) script.remove();
    });
    const pageScript = clone.querySelector('#pageScript');
    if (!pageScript?.parentNode) return null;
    const stateScript = documentFrame.createElement('script');
    stateScript.id = 'orionProposalState';
    stateScript.textContent = `window.__ORION_BAKED__=true;window.__ORION_STATE__=${serializedState};`;
    pageScript.parentNode.insertBefore(stateScript, pageScript);
    return `<!doctype html>${clone.outerHTML}`;
  }, []);

  const requestSnapshot = useCallback(() => {
    setSnapshot(null);
    const currentSnapshot = collectSnapshot();
    if (currentSnapshot) setSnapshot(currentSnapshot);
    else iframeRef.current?.contentWindow?.postMessage({ type: 'orion-proposal-snapshot-request' }, '*');
  }, [collectSnapshot]);

  const finishEditing = useCallback(() => {
    const documentFrame = iframeRef.current?.contentDocument;
    const clientInput = documentFrame?.getElementById('clientName') as HTMLInputElement | null;
    const coverName = documentFrame?.querySelector('[data-proposal-client]')?.textContent?.trim();
    const clientName = clientInput?.value.trim() || coverName || '';
    setEditing(false);
    if (clientName) setNomeCliente(clientName);
    setSalvarAberto(true);
    requestSnapshot();
    void loadLeads(leadId || undefined);
  }, [leadId, loadLeads, requestSnapshot]);

  const configureProposalFrame = useCallback(() => {
    const documentFrame = iframeRef.current?.contentDocument;
    const windowFrame = iframeRef.current?.contentWindow;
    if (!documentFrame || !windowFrame) return;
    const editButton = documentFrame.getElementById('editBtn') as HTMLButtonElement | null;
    const fullscreenButton = documentFrame.getElementById('fsBtn') as HTMLButtonElement | null;
    const doneButton = documentFrame.getElementById('doneBtn') as HTMLButtonElement | null;
    if (editButton) editButton.style.display = 'none';
    if (fullscreenButton) fullscreenButton.style.display = 'none';
    doneButton?.addEventListener('click', finishEditing);
    documentFrame.body.classList.toggle('parent-fullscreen', fullscreen);
    windowFrame.dispatchEvent(new Event('resize'));
    setFrameReady(true);
  }, [finishEditing, fullscreen]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'orion-proposal-client-updated' && event.data.clientName) setNomeCliente(String(event.data.clientName));
      if (event.data.type === 'orion-proposal-edit-state') setEditing(Boolean(event.data.editing));
      if (event.data.type === 'orion-proposal-edit-finished' && event.data.clientName && !iframeRef.current?.contentDocument) {
        setEditing(false);
        setNomeCliente(String(event.data.clientName));
        setSalvarAberto(true);
        requestSnapshot();
        void loadLeads(leadId || undefined);
      }
      if (event.data.type === 'orion-proposal-snapshot' && event.data.html) setSnapshot(String(event.data.html));
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [leadId, loadLeads, requestSnapshot]);

  useEffect(() => {
    const documentFrame = iframeRef.current?.contentDocument;
    documentFrame?.body.classList.toggle('parent-fullscreen', fullscreen);
    iframeRef.current?.contentWindow?.postMessage({ type: 'orion-proposal-fullscreen-state', active: fullscreen }, '*');
    iframeRef.current?.contentWindow?.dispatchEvent(new Event('resize'));
  }, [fullscreen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape' && fullscreen) setFullscreen(false); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!sucesso) return;
    const timeout = window.setTimeout(() => setSucesso(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [sucesso]);

  function toggleEditing() {
    const documentFrame = iframeRef.current?.contentDocument;
    const editButton = documentFrame?.getElementById('editBtn') as HTMLButtonElement | null;
    if (!documentFrame || !editButton) {
      setErro('A apresentação ainda está carregando. Aguarde um instante e tente novamente.');
      return;
    }
    setErro(null);
    const wasEditing = documentFrame.body.classList.contains('editing');
    editButton.click();
    if (wasEditing) finishEditing(); else setEditing(true);
  }

  const downloadPdf = useCallback(async () => {
    const documentFrame = iframeRef.current?.contentDocument;
    const windowFrame = iframeRef.current?.contentWindow;
    const stage = documentFrame?.getElementById('stage') as HTMLElement | null;
    if (!documentFrame || !windowFrame || !stage) {
      setErro('A apresentação ainda está carregando. Aguarde um instante e tente novamente.');
      return;
    }
    const slides = Array.from(documentFrame.querySelectorAll<HTMLElement>('.slide')).filter((slide) => slide.getAttribute('aria-label') !== 'Condição de fechamento');
    if (!slides.length) { setErro('Não foi possível localizar as páginas da proposta.'); return; }

    setErro(null);
    setExportando(true);
    setExportProgress({ current: 0, total: slides.length });
    const stageStyle = stage.getAttribute('style');
    const slideStates = slides.map((slide) => ({
      slide, className: slide.className, style: slide.getAttribute('style'),
      zones: Array.from(slide.querySelectorAll<HTMLElement>('.zone')).map((zone) => ({ zone, className: zone.className })),
    }));
    const captureStyle = documentFrame.createElement('style');
    captureStyle.id = 'orion-pdf-capture-style';
    captureStyle.textContent = '*{animation:none!important;transition:none!important}#chrome{display:none!important}';

    try {
      documentFrame.head.appendChild(captureStyle);
      await documentFrame.fonts?.ready;
      await Promise.all(Array.from(documentFrame.images).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
        try { await image.decode?.(); } catch { /* imagem já disponível */ }
      }));
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1600, 900], compress: true, hotfixes: ['px_scaling'] });
      stage.style.cssText = `${stage.style.cssText};position:relative!important;left:0!important;top:0!important;margin:0!important;transform:none!important;width:1600px!important;height:900px!important;`;

      for (let index = 0; index < slideStates.length; index += 1) {
        const current = slideStates[index];
        current.slide.classList.remove('is-out');
        current.slide.classList.add('is-active');
        current.slide.style.cssText = `${current.slide.style.cssText};display:flex!important;visibility:visible!important;opacity:1!important;transform:none!important;`;
        current.zones.forEach(({ zone }) => zone.classList.add('open'));
        setExportProgress({ current: index + 1, total: slides.length });
        const canvas = await html2canvas(current.slide, { backgroundColor: '#02050a', width: 1600, height: 900, windowWidth: 1600, windowHeight: 900, scale: 1, useCORS: true, logging: false });
        if (index > 0) pdf.addPage([1600, 900], 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 1600, 900, undefined, 'FAST');
        current.slide.className = current.className;
        if (current.style === null) current.slide.removeAttribute('style'); else current.slide.setAttribute('style', current.style);
        current.zones.forEach(({ zone, className }) => { zone.className = className; });
      }

      const safeName = (nomeCliente || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      pdf.save(`proposta-orion-${safeName || 'cliente'}.pdf`);
      setSucesso('PDF gerado sem a página de condição de fechamento.');
    } catch (error) {
      setErro(error instanceof Error ? `Não foi possível gerar o PDF: ${error.message}` : 'Não foi possível gerar o PDF.');
    } finally {
      captureStyle.remove();
      if (stageStyle === null) stage.removeAttribute('style'); else stage.setAttribute('style', stageStyle);
      slideStates.forEach(({ slide, className, style, zones }) => {
        slide.className = className;
        if (style === null) slide.removeAttribute('style'); else slide.setAttribute('style', style);
        zones.forEach(({ zone, className: zoneClassName }) => { zone.className = zoneClassName; });
      });
      windowFrame.dispatchEvent(new Event('resize'));
      setExportando(false);
    }
  }, [nomeCliente]);

  useEffect(() => {
    if (!frameReady || autoDownloadStartedRef.current) return;
    if (new URLSearchParams(window.location.search).get('download') !== 'pdf') return;
    autoDownloadStartedRef.current = true;
    const timeout = window.setTimeout(() => { void downloadPdf(); }, 350);
    return () => window.clearTimeout(timeout);
  }, [downloadPdf, frameReady]);

  async function save(mode: SaveMode) {
    if (!nomeCliente.trim() || !leadId) { setErro('Informe o cliente e selecione o lead agendado.'); return; }
    if (mode === 'update' && !currentProposalId) { setErro('Esta proposta ainda não foi salva. Use Salvar proposta.'); return; }

    const documentFrame = iframeRef.current?.contentDocument;
    const normalizedName = nomeCliente.trim();
    const clientInput = documentFrame?.getElementById('clientName') as HTMLInputElement | null;
    if (clientInput) clientInput.value = normalizedName;
    documentFrame?.querySelectorAll<HTMLElement>('[data-proposal-client]').forEach((element) => { element.textContent = normalizedName; });
    const currentSnapshot = collectSnapshot() || snapshot;
    if (!currentSnapshot) {
      requestSnapshot();
      setErro('A proposta ainda está sendo preparada. Tente salvar novamente em um instante.');
      return;
    }

    setErro(null);
    setSalvando(true);
    try {
      const response = await fetch('/api/comercial/proposta', {
        method: mode === 'update' ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal_id: mode === 'update' ? currentProposalId : undefined,
          source_proposal_id: mode === 'copy' ? currentProposalId : undefined,
          lead_id: leadId,
          nome_cliente: normalizedName,
          html_snapshot: currentSnapshot,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar a proposta.');
      if (payload.proposal?.id) setCurrentProposalId(String(payload.proposal.id));
      setSnapshot(null);
      setSalvarAberto(false);
      setSucesso(mode === 'update' ? 'Proposta atualizada.' : 'Nova proposta salva.');
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível salvar a proposta.');
    } finally { setSalvando(false); }
  }

  if (erro && !url) return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#05080f', color: '#f7f9fc', padding: 24 }}>{erro}</main>;

  return <main style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#05080f' }}>
    {url && <iframe ref={iframeRef} src={url} onLoad={configureProposalFrame} title="Proposta comercial Orion" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />}

    {url && <div style={{ position: 'fixed', right: 18, bottom: 14, zIndex: 15, display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 }}>
      {!fullscreen && <button type="button" onClick={toggleEditing} style={buttonStyle} title={editing ? 'Voltar para a apresentação' : 'Editar esta proposta'}>{editing ? <Save size={16} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}{editing ? 'Concluir edição' : 'Editar'}</button>}
      {!fullscreen && <button type="button" onClick={() => void downloadPdf()} disabled={exportando} style={{ ...buttonStyle, opacity: exportando ? .6 : 1 }} title="Baixar PDF sem a página de condição de fechamento"><Download size={16} aria-hidden="true" />{exportando ? 'Gerando PDF' : 'Baixar PDF'}</button>}
      <button type="button" onClick={() => setFullscreen((active) => !active)} style={buttonStyle} title="Ocupa somente esta janela, mantendo o Meet visível na tela dividida">{fullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}{fullscreen ? 'Sair da apresentação' : 'Tela cheia'}</button>
    </div>}

    {erro && <div role="alert" style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 30, maxWidth: 520, border: '1px solid rgba(255,110,110,.4)', borderRadius: 9, background: 'rgba(55,10,15,.94)', color: '#ffd2d2', padding: '11px 14px' }}>{erro}</div>}
    {sucesso && !erro && <div role="status" onClick={() => setSucesso(null)} style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 30, border: '1px solid rgba(45,218,167,.4)', borderRadius: 9, background: 'rgba(5,45,38,.94)', color: '#c8fff0', padding: '11px 14px', cursor: 'pointer' }}>{sucesso}</div>}

    {exportando && <div role="status" aria-live="polite" style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center', background: 'rgba(1,5,10,.76)', color: '#f7f9fc', backdropFilter: 'blur(5px)' }}><div style={{ width: 'min(360px,calc(100% - 40px))', border: '1px solid rgba(65,180,255,.3)', borderRadius: 14, background: '#091421', padding: 22, boxShadow: '0 24px 80px rgba(0,0,0,.5)' }}><strong style={{ display: 'block', marginBottom: 8 }}>Gerando PDF</strong><span style={{ color: '#9fb2c8' }}>Página {exportProgress.current} de {exportProgress.total}</span><div style={{ height: 5, marginTop: 14, overflow: 'hidden', borderRadius: 99, background: '#17283b' }}><div style={{ width: `${exportProgress.total ? (exportProgress.current / exportProgress.total) * 100 : 0}%`, height: '100%', background: '#08aeea', transition: 'width .2s ease' }} /></div></div></div>}

    {salvarAberto && <div onMouseDown={() => !salvando && setSalvarAberto(false)} style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.72)', padding: 20 }}><section role="dialog" aria-modal="true" aria-labelledby="save-proposal-title" onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(500px,100%)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 24, background: '#0b1422', color: '#f7f9fc', boxShadow: '0 20px 80px rgba(0,0,0,.5)' }}>
      <h1 id="save-proposal-title" style={{ margin: 0, fontSize: 21 }}>{currentProposalId ? 'Salvar alterações' : 'Salvar proposta'}</h1>
      <p style={{ margin: '8px 0 20px', color: '#a9b8cb', lineHeight: 1.5 }}>{currentProposalId ? 'Atualize esta proposta ou salve uma nova cópia.' : 'Selecione o lead que está em Reuniões agendadas.'}</p>
      <label htmlFor="proposal-client-name" style={{ display: 'block', marginBottom: 7, fontSize: 13, color: '#c7d3e2' }}>Nome do cliente</label>
      <input id="proposal-client-name" value={nomeCliente} onChange={(event) => { setNomeCliente(event.target.value); setSnapshot(null); }} placeholder="Nome do cliente" style={{ width: '100%', minHeight: 44, boxSizing: 'border-box', marginBottom: 15, padding: '11px 12px', borderRadius: 9, border: '1px solid #31465d', background: '#07101c', color: 'white' }} />
      <label htmlFor="proposal-lead" style={{ display: 'block', marginBottom: 7, fontSize: 13, color: '#c7d3e2' }}>Lead vinculado</label>
      <select id="proposal-lead" value={leadId} onChange={(event) => setLeadId(event.target.value)} style={{ width: '100%', minHeight: 44, boxSizing: 'border-box', marginBottom: 22, padding: '11px 12px', borderRadius: 9, border: '1px solid #31465d', background: '#07101c', color: 'white' }}><option value="">Selecione o lead</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.nome}{lead.empresa ? ` - ${lead.empresa}` : ''}</option>)}</select>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 }}>
        <button type="button" onClick={() => setSalvarAberto(false)} disabled={salvando} style={{ ...buttonStyle, background: 'transparent', opacity: salvando ? .5 : 1, cursor: salvando ? 'not-allowed' : 'pointer' }}>Cancelar</button>
        {currentProposalId && <button type="button" onClick={() => void save('copy')} disabled={salvando} style={{ ...buttonStyle, opacity: salvando ? .5 : 1, cursor: salvando ? 'not-allowed' : 'pointer' }}>{salvando ? 'Salvando...' : 'Salvar como nova'}</button>}
        <button type="button" onClick={() => void save(currentProposalId ? 'update' : 'copy')} disabled={salvando} style={{ ...buttonStyle, borderColor: '#0da8df', background: '#087dab', opacity: salvando ? .5 : 1, cursor: salvando ? 'not-allowed' : 'pointer' }}>{salvando ? 'Salvando...' : currentProposalId ? 'Atualizar proposta' : 'Salvar proposta'}</button>
      </div>
    </section></div>}
  </main>;
}
