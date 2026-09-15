'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { PROPOSTA_KRIPTO_IDS } from '@/lib/propostaKripto';

export default function PropostaKriptoPage() {
  const { isDevOps, currentProfileId, loading } = useCommercial();
  const liberado = isDevOps || Boolean(currentProfileId && PROPOSTA_KRIPTO_IDS.has(currentProfileId));
  const proposalId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('proposal_id');
  const href = `/proposta${proposalId ? `?proposal_id=${encodeURIComponent(proposalId)}` : ''}`;

  if (loading) return <div className="kh-panel"><p style={{ opacity: 0.65 }}>Carregando...</p></div>;
  if (!liberado) return <div className="kh-panel"><div className="kh-inline-error">Esta proposta é restrita ao Léo e aos administradores.</div></div>;

  return <div className="kh-panel" style={{ maxWidth: 680, margin: '48px auto', textAlign: 'center', padding: 40 }}>
    <FileText size={28} aria-hidden style={{ color: '#00b8df', marginBottom: 12 }} />
    <h1 style={{ margin: '0 0 10px' }}>Proposta comercial</h1>
    <p style={{ margin: '0 0 24px', opacity: 0.7 }}>A apresentação abre em uma nova aba, sem a navegação do CRM.</p>
    <a href={href} target="_blank" rel="noopener noreferrer" className="kh-button kh-button-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
      <ExternalLink size={16} aria-hidden /> Abrir proposta
    </a>
  </div>;
}
