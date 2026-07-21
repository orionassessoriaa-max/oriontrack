'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { COMMERCIAL_STATUSES, type CommercialLead, type CommercialMember } from '@/lib/comercial';

type Props = {
  open: boolean;
  members: CommercialMember[];
  canViewFinancials: boolean;
  lead?: CommercialLead | null;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
};

const empty = { nome: '', telefone: '', email: '', empresa: '', origem: '', campanha: '', ja_investiu_trafego: '', faturamento_mensal: '', prioridade: '', investimento: '', vidas: '', negocio_etapa: '', utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '', status: 'Oportunidade', sdr_id: '', closer_id: '', valor_negociacao: '', observacoes: '', lead_qualificado: false };

export default function CommercialLeadModal({ open, members, canViewFinancials, lead, onClose, onSave }: Props) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(lead ? {
      ...empty,
      nome: lead.nome || '', telefone: lead.telefone || '', email: lead.email || '', empresa: lead.empresa || '', origem: lead.origem || '', campanha: lead.campanha || '',
      ja_investiu_trafego: lead.ja_investiu_trafego || '', faturamento_mensal: lead.faturamento_mensal || '', prioridade: lead.prioridade || '', investimento: lead.investimento || '', vidas: lead.vidas || '', negocio_etapa: lead.negocio_etapa || '', utm_source: lead.utm_source || '', utm_medium: lead.utm_medium || '', utm_campaign: lead.utm_campaign || '', utm_term: lead.utm_term || '', utm_content: lead.utm_content || '',
      status: lead.status || 'Oportunidade', sdr_id: lead.sdr_id || '', closer_id: lead.closer_id || '', valor_negociacao: String(lead.valor_negociacao || ''), observacoes: lead.observacoes || '', lead_qualificado: Boolean(lead.lead_qualificado),
    } : empty);
    setError(null);
  }, [lead, open]);

  if (!open) return null;
  const set = (field: string, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try { await onSave({ ...form, id: lead?.id, valor_negociacao: canViewFinancials ? Number(form.valor_negociacao || 0) : 0 }); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar lead.'); }
    finally { setSaving(false); }
  }
  const sdrs = members.filter((member) => member.papel === 'sdr' && member.ativo);
  const closers = members.filter((member) => member.papel === 'closer' && member.ativo);
  return (
    <div className="kh-modal" role="dialog" aria-modal="true" aria-labelledby="kh-lead-modal-title">
      <button className="kh-modal-scrim" aria-label="Fechar" onClick={onClose} />
      <form className="kh-modal-sheet" onSubmit={submit}>
        <header><div><span>Central de leads</span><h2 id="kh-lead-modal-title">{lead ? 'Editar lead' : 'Adicionar lead'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose}><X size={20} /></button></header>
        <div className="kh-form-grid">
          <label className="wide"><span>Nome</span><input className="kh-input" value={form.nome} onChange={(event) => set('nome', event.target.value)} required /></label>
          <label><span>Telefone</span><input className="kh-input" type="tel" value={form.telefone} onChange={(event) => set('telefone', event.target.value)} /></label>
          <label><span>E-mail</span><input className="kh-input" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} /></label>
          <label><span>Empresa</span><input className="kh-input" value={form.empresa} onChange={(event) => set('empresa', event.target.value)} /></label>
          <label><span>Origem</span><input className="kh-input" value={form.origem} onChange={(event) => set('origem', event.target.value)} /></label>
          <label><span>Campanha</span><input className="kh-input" value={form.campanha} onChange={(event) => set('campanha', event.target.value)} /></label>
          {canViewFinancials && <label><span>JÃ¡ investiu em trÃ¡fego?</span><input className="kh-input" value={form.ja_investiu_trafego} onChange={(event) => set('ja_investiu_trafego', event.target.value)} /></label>}
          {canViewFinancials && <label><span>Faturamento mensal</span><input className="kh-input" value={form.faturamento_mensal} onChange={(event) => set('faturamento_mensal', event.target.value)} /></label>}
          <label><span>Prioridade</span><input className="kh-input" value={form.prioridade} onChange={(event) => set('prioridade', event.target.value)} /></label>
          {canViewFinancials && <label><span>Investimento</span><input className="kh-input" value={form.investimento} onChange={(event) => set('investimento', event.target.value)} /></label>}
          <label><span>Vidas</span><input className="kh-input" value={form.vidas} onChange={(event) => set('vidas', event.target.value)} /></label>
          <label><span>Etapa</span><select className="kh-select" value={form.status} onChange={(event) => set('status', event.target.value)}>{COMMERCIAL_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label><span>NegÃ³cio - Etapa</span><input className="kh-input" value={form.negocio_etapa} onChange={(event) => set('negocio_etapa', event.target.value)} /></label>
          <label><span>SDR</span><select className="kh-select" value={form.sdr_id} onChange={(event) => set('sdr_id', event.target.value)}><option value="">Sem SDR</option>{sdrs.map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}</select></label>
          <label><span>Closer</span><select className="kh-select" value={form.closer_id} onChange={(event) => set('closer_id', event.target.value)}><option value="">Sem closer</option>{closers.map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}</select></label>
          {canViewFinancials && <label><span>Valor em negociaÃ§Ã£o</span><input className="kh-input" type="number" min="0" step="0.01" value={form.valor_negociacao} onChange={(event) => set('valor_negociacao', event.target.value)} /></label>}
          <label className="kh-check"><input type="checkbox" checked={form.lead_qualificado} onChange={(event) => set('lead_qualificado', event.target.checked)} /><span>Lead qualificado (MQL)</span></label>
          <label className="wide"><span>ObservaÃ§Ãµes</span><textarea className="kh-textarea" value={form.observacoes} onChange={(event) => set('observacoes', event.target.value)} /></label>
          <div className="wide kh-form-section"><span>UTMs</span><div className="kh-form-grid"><label><span>utm_source</span><input className="kh-input" value={form.utm_source} onChange={(event) => set('utm_source', event.target.value)} /></label><label><span>utm_medium</span><input className="kh-input" value={form.utm_medium} onChange={(event) => set('utm_medium', event.target.value)} /></label><label><span>utm_campaign</span><input className="kh-input" value={form.utm_campaign} onChange={(event) => set('utm_campaign', event.target.value)} /></label><label><span>utm_term</span><input className="kh-input" value={form.utm_term} onChange={(event) => set('utm_term', event.target.value)} /></label><label><span>utm_content</span><input className="kh-input" value={form.utm_content} onChange={(event) => set('utm_content', event.target.value)} /></label></div></div>
        </div>
        {error && <div className="kh-inline-error">{error}</div>}
        <footer><button type="button" className="kh-button" onClick={onClose}>Cancelar</button><button className="kh-button primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar lead'}</button></footer>
      </form>
    </div>
  );
}
