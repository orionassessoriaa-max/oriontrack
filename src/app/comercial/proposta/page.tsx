'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { PROPOSTA_KRIPTO_IDS } from '@/lib/propostaKripto';

export default function PropostaKriptoPage() {
  const { isDevOps, currentProfileId, loading } = useCommercial();
  const liberado = isDevOps || Boolean(currentProfileId && PROPOSTA_KRIPTO_IDS.has(currentProfileId));
  const proposalId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('proposal_id');
  const href = `/proposta${proposalId ? `?proposal_id=${encodeURIComponent(proposalId)}` : ''}`;
  const [propostas, setPropostas] = useState<Array<{ id: string; nome_cliente: string; lead_nome: string; created_at: string }>>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !liberado) return;
    async function load() {
      try {
        const { supabase } = await import('@/lib/supabase/client');
        const { data } = await supabase.auth.getSession();
        const response = await fetch('/api/comercial/proposta?mode=list', { headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as propostas.');
        setPropostas(payload.proposals || []);
      } catch (error) { setListError(error instanceof Error ? error.message : 'Não foi possível carregar as propostas.'); }
    }
    void load();
  }, [liberado, loading]);

  if (loading) return <div className="kh-panel"><p style={{ opacity: 0.65 }}>Carregando...</p></div>;
  if (!liberado) return <div className="kh-panel"><div className="kh-inline-error">Esta proposta é restrita ao Léo e aos administradores.</div></div>;

  return <div className="kh-panel" style={{ maxWidth: 680, margin: '48px auto', textAlign: 'center', padding: 40 }}>
    <FileText size={28} aria-hidden style={{ color: '#00b8df', marginBottom: 12 }} />
    <h1 style={{ margin: '0 0 10px' }}>Proposta comercial</h1>
    <p style={{ margin: '0 0 24px', opacity: 0.7 }}>A apresentação abre em uma nova aba, sem a navegação do CRM.</p>
    <a href={href} target="_blank" rel="noopener noreferrer" className="kh-button kh-button-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
      <ExternalLink size={16} aria-hidden /> Abrir proposta
    </a>
    <section style={{ marginTop: 36, textAlign: 'left', borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 24 }}>
      <strong>Propostas salvas</strong>
      {listError && <p className="kh-inline-error">{listError}</p>}
      {!listError && !propostas.length && <p style={{ opacity: .65 }}>Nenhuma proposta salva ainda.</p>}
      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {propostas.map((proposal) => (
          <a key={proposal.id} href={`/proposta?proposal_id=${encodeURIComponent(proposal.id)}`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '12px 14px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, color: 'inherit', textDecoration: 'none' }}>
            <span><strong>{proposal.lead_nome}</strong><small style={{ display: 'block', marginTop: 3, opacity: .65 }}>Cliente: {proposal.nome_cliente}</small></span>
            <small style={{ opacity: .65, whiteSpace: 'nowrap' }}>{new Date(proposal.created_at).toLocaleDateString('pt-BR')}</small>
          </a>
        ))}
      </div>
    </section>
  </div>;
}
