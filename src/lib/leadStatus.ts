import { LeadStatus } from '@/types';

export const LEAD_STATUSES: LeadStatus[] = [
  'Aguardando atendimento',
  'Inicio',
  'Contato feito',
  'Cotação enviada',
  'Em negociação',
  'Não tive retorno',
  'Venda realizada',
  'Sem interesse'
];

export const LEGACY_LEAD_STATUS_MAP: Record<string, LeadStatus> = {
  'CotaÃ§Ã£o enviada': 'Cotação enviada',
  'RegiÃ£o sem comercializaÃ§Ã£o': 'Região sem comercialização',
  'Telefone nÃ£o existe': 'Telefone não existe',
  'NÃ£o tive retorno': 'Não tive retorno',
  'Em negociaÃ§Ã£o': 'Em negociação',
};

export function normalizeLeadStatus(status: string | null | undefined): LeadStatus {
  if (!status) return 'Aguardando atendimento';
  return LEGACY_LEAD_STATUS_MAP[status] || (status as LeadStatus);
}

export function getLeadStatusStyle(status: string | null | undefined) {
  const normalized = normalizeLeadStatus(status);

  const styles: Record<string, { label: string; chip: string; dot: string; column: string }> = {
    'Aguardando atendimento': {
      label: 'Oportunidade',
      chip: 'orion-status-opportunity',
      dot: 'bg-blue-600',
      column: 'border-blue-100 bg-blue-50/50',
    },
    'Inicio': {
      label: 'Inicio',
      chip: 'orion-status-contact',
      dot: 'bg-cyan-500',
      column: 'border-cyan-100 bg-cyan-50/50',
    },
    'Contato feito': {
      label: 'Contato feito',
      chip: 'orion-status-negotiation',
      dot: 'bg-purple-600',
      column: 'border-purple-100 bg-purple-50/50',
    },
    'Cotação enviada': {
      label: 'Cotação enviada',
      chip: 'orion-status-quote',
      dot: 'bg-indigo-600',
      column: 'border-indigo-100 bg-indigo-50/50',
    },
    'Em negociação': {
      label: 'Em negociação',
      chip: 'orion-status-negotiation',
      dot: 'bg-amber-500',
      column: 'border-amber-100 bg-amber-50/50',
    },
    'Não tive retorno': {
      label: 'Sem retorno',
      chip: 'orion-status-neutral',
      dot: 'bg-slate-500',
      column: 'border-slate-200 bg-slate-100/70',
    },
    'Venda realizada': {
      label: 'Venda realizada',
      chip: 'orion-status-sale',
      dot: 'bg-emerald-600',
      column: 'border-emerald-100 bg-emerald-50/50',
    },
    'Sem interesse': {
      label: 'Sem interesse',
      chip: 'orion-status-lost',
      dot: 'bg-rose-500',
      column: 'border-rose-100 bg-rose-50/50',
    },
    'Região sem comercialização': {
      label: 'Região sem comercialização',
      chip: 'orion-status-negotiation',
      dot: 'bg-orange-500',
      column: 'border-orange-100 bg-orange-50/50',
    },
    'Chamou duas vezes': {
      label: 'Chamou duas vezes',
      chip: 'orion-status-quote',
      dot: 'bg-violet-600',
      column: 'border-violet-100 bg-violet-50/50',
    },
    'Telefone não existe': {
      label: 'Telefone não existe',
      chip: 'orion-status-neutral',
      dot: 'bg-zinc-500',
      column: 'border-zinc-200 bg-zinc-100/70',
    },
  };

  return styles[normalized] || {
    label: normalized,
    chip: 'orion-status-neutral',
    dot: 'bg-slate-500',
    column: 'border-slate-200 bg-slate-100/70',
  };
}
