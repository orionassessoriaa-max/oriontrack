'use client';

import { Pencil, X } from 'lucide-react';
import type { CommercialLead, CommercialMember } from '@/lib/comercial';

type Props = {
  lead: CommercialLead | null;
  members: CommercialMember[];
  canViewFinancials: boolean;
  onClose: () => void;
  onEdit: () => void;
};

function date(value: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Não informado';
}

function value(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '' ? 'Não informado' : String(value);
}

export default function CommercialLeadDetailsModal({ lead, members, canViewFinancials, onClose, onEdit }: Props) {
  if (!lead) return null;
  const memberName = (id: string | null, fallback: string) => members.find((member) => member.profile_id === id)?.nome || fallback;
  const fields: Array<[string, string]> = [
    ['Telefone', value(lead.telefone)], ['E-mail', value(lead.email)], ['Empresa', value(lead.empresa)], ['Estado', value(lead.estado)],
    ['Origem', value(lead.origem)], ['Campanha', value(lead.campanha)], ['Status', value(lead.status)], ['Entrada', date(lead.data_entrada)],
    ['Prioridade', value(lead.prioridade)], ['Vidas', value(lead.vidas)], ['Já investiu em tráfego', value(lead.ja_investiu_trafego)],
    ['Faturamento mensal', value(lead.faturamento_mensal)], ['Negócio / etapa', value(lead.negocio_etapa)], ['SDR', memberName(lead.sdr_id, 'Sem SDR')],
    ['Closer', memberName(lead.closer_id, 'Sem closer')], ['Lead qualificado (MQL)', lead.lead_qualificado ? 'Sim' : 'Não'],
    ['Reunião agendada', date(lead.reuniao_agendada_at)], ['Reunião realizada', date(lead.reuniao_realizada_at)], ['No-show', lead.no_show ? 'Sim' : 'Não'],
    ['Último contato', date(lead.ultimo_contato_at)], ['UTM source', value(lead.utm_source)], ['UTM medium', value(lead.utm_medium)],
    ['UTM campaign', value(lead.utm_campaign)], ['UTM term', value(lead.utm_term)], ['UTM content', value(lead.utm_content)],
    ['Observações', value(lead.observacoes)],
  ];
  if (canViewFinancials) fields.splice(8, 0, ['Investimento', value(lead.investimento)], ['Valor em negociação', `R$ ${Number(lead.valor_negociacao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`]);

  return <div className="kh-lead-details-overlay" role="dialog" aria-modal="true" aria-labelledby="kh-lead-details-title"><section className="kh-lead-details-modal"><header><div><span className="kh-eyebrow">Lead comercial</span><h2 id="kh-lead-details-title">{lead.nome}</h2><p>Informações completas do lead</p></div><div className="kh-lead-modal-actions"><button type="button" className="kh-button primary" onClick={onEdit}><Pencil size={14} /> Editar</button><button type="button" className="kh-icon-button" aria-label="Fechar detalhes" onClick={onClose}><X size={18} /></button></div></header><div className="kh-lead-details-grid">{fields.map(([label, content]) => <div key={label} className={label === 'Observações' ? 'wide' : ''}><small>{label}</small><strong>{content}</strong></div>)}</div></section></div>;
}
