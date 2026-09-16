'use client';

import { Download, ExternalLink, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { PROPOSTA_KRIPTO_IDS } from '@/lib/propostaKripto';

export default function PropostaKriptoPage() {
  const { isDevOps, currentProfileId, loading } = useCommercial();
  const liberado = isDevOps || Boolean(currentProfileId && PROPOSTA_KRIPTO_IDS.has(currentProfileId));
  const [propostas, setPropostas] = useState<Array<{ id: string; nome_cliente: string; lead_nome: string; created_at: string; updated_at: string | null }>>([]);
  const [leads, setLeads] = useState<Array<{ id: string; nome: string; empresa: string | null }>>([]);
  const [leadId, setLeadId] = useState('');
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !liberado) return;
    async function load() {
      try {
        const { supabase } = await import('@/lib/supabase/client');
        const { data } = await supabase.auth.getSession();
        const headers = { Authorization: `Bearer ${data.session?.access_token || ''}` };
        const [listResponse, leadsResponse] = await Promise.all([
          fetch('/api/comercial/proposta?mode=list', { headers }),
          fetch('/api/comercial/proposta?mode=leads', { headers }),
        ]);
        const [listPayload, leadsPayload] = await Promise.all([listResponse.json(), leadsResponse.json()]);
        if (!listResponse.ok) throw new Error(listPayload.error || 'Não foi possível carregar as propostas.');
        if (!leadsResponse.ok) throw new Error(leadsPayload.error || 'Não foi possível carregar os leads agendados.');
        setPropostas(listPayload.proposals || []);
        setLeads(leadsPayload.leads || []);
      } catch (error) { setListError(error instanceof Error ? error.message : 'Não foi possível carregar as propostas.'); }
    }
    void load();
  }, [liberado, loading]);

  if (loading) return <div className="kh-panel"><p style={{ opacity: 0.65 }}>Carregando...</p></div>;
  if (!liberado) return <div className="kh-panel"><div className="kh-inline-error">Esta proposta é restrita ao Léo e aos administradores.</div></div>;

  return <div className="kh-panel" style={{ maxWidth: 680, margin: '48px auto', textAlign: 'center', padding: 40 }}>
    <FileText size={28} aria-hidden style={{ color: '#00b8df', marginBottom: 12 }} />
    <h1 style={{ margin: '0 0 10px' }}>Proposta comercial</h1>
    <p style={{ margin: '0 0 20px', opacity: 0.7 }}>Escolha o lead em Reuniões agendadas. A capa já abre com os dados dele.</p>
    <label style={{ display: 'block', maxWidth: 430, margin: '0 auto 16px', textAlign: 'left' }}>
      <span style={{ display: 'block', fontSize: 12, marginBottom: 7, opacity: .7 }}>Lead da proposta</span>
      <select value={leadId} onChange={(event) => setLeadId(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.16)', background: '#07101c', color: 'white' }}>
        <option value="">Selecione o lead</option>
        {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.nome}{lead.empresa ? ` - ${lead.empresa}` : ''}</option>)}
      </select>
    </label>
    <a href={leadId ? `/proposta?lead_id=${encodeURIComponent(leadId)}` : '#'} onClick={(event) => { if (!leadId) event.preventDefault(); }} target="_blank" rel="noopener noreferrer" aria-disabled={!leadId} className="kh-button kh-button-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', opacity: leadId ? 1 : .5, pointerEvents: leadId ? 'auto' : 'none' }}>
      <ExternalLink size={16} aria-hidden /> Abrir nova proposta
    </a>
    <section style={{ marginTop: 36, textAlign: 'left', borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 24 }}>
      <strong>Propostas salvas</strong>
      {listError && <p className="kh-inline-error">{listError}</p>}
      {!listError && !propostas.length && <p style={{ opacity: .65 }}>Nenhuma proposta salva ainda.</p>}
      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {propostas.map((proposal) => (
          <article key={proposal.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', padding: '13px 14px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, color: 'inherit', background: 'rgba(255,255,255,.015)' }}>
            <span style={{ minWidth: 0 }}><strong>{proposal.lead_nome}</strong><small style={{ display: 'block', marginTop: 3, opacity: .65 }}>Cliente: {proposal.nome_cliente}</small></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <small style={{ opacity: .65, whiteSpace: 'nowrap', marginRight: 4 }}>{new Date(proposal.updated_at || proposal.created_at).toLocaleDateString('pt-BR')}</small>
              <a href={`/proposta?proposal_id=${encodeURIComponent(proposal.id)}&download=pdf`} target="_blank" rel="noopener noreferrer" aria-label={`Baixar PDF da proposta de ${proposal.nome_cliente}`} title="Baixar PDF" style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,.14)', borderRadius: 9, color: '#dce8f5', background: 'rgba(255,255,255,.04)' }}><Download size={17} aria-hidden /></a>
              <a href={`/proposta?proposal_id=${encodeURIComponent(proposal.id)}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir proposta de ${proposal.nome_cliente}`} title="Abrir proposta" style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', border: '1px solid rgba(0,184,223,.45)', borderRadius: 9, color: '#dffaff', background: 'rgba(0,184,223,.1)' }}><ExternalLink size={17} aria-hidden /></a>
            </span>
          </article>
        ))}
      </div>
    </section>
  </div>;
}
