import { LeadStatus } from '@/types';

export const LEAD_STATUSES: LeadStatus[] = [
  'Aguardando atendimento',
  'Contato feito',
  'Cotação enviada',
  'Em negociação',
  'Não tive retorno',
  'Venda realizada',
  'Sem interesse',
  'Região sem comercialização',
  'Chamou duas vezes',
  'Telefone não existe'
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

  const styles: Record<LeadStatus, { label: string; chip: string; dot: string; column: string }> = {
    'Aguardando atendimento': {
      label: 'Oportunidade',
      chip: 'bg-blue-50 text-blue-700 border-blue-100',
      dot: 'bg-blue-600',
      column: 'border-blue-100 bg-blue-50/50',
    },
    'Contato feito': {
      label: 'Contato feito',
      chip: 'bg-cyan-50 text-cyan-700 border-cyan-100',
      dot: 'bg-cyan-600',
      column: 'border-cyan-100 bg-cyan-50/50',
    },
    'Cotação enviada': {
      label: 'Cotação enviada',
      chip: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      dot: 'bg-indigo-600',
      column: 'border-indigo-100 bg-indigo-50/50',
    },
    'Em negociação': {
      label: 'Em negociação',
      chip: 'bg-amber-50 text-amber-700 border-amber-100',
      dot: 'bg-amber-500',
      column: 'border-amber-100 bg-amber-50/50',
    },
    'Não tive retorno': {
      label: 'Sem retorno',
      chip: 'bg-slate-100 text-slate-700 border-slate-200',
      dot: 'bg-slate-500',
      column: 'border-slate-200 bg-slate-100/70',
    },
    'Venda realizada': {
      label: 'Venda realizada',
      chip: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      dot: 'bg-emerald-600',
      column: 'border-emerald-100 bg-emerald-50/50',
    },
    'Sem interesse': {
      label: 'Sem interesse',
      chip: 'bg-rose-50 text-rose-700 border-rose-100',
      dot: 'bg-rose-500',
      column: 'border-rose-100 bg-rose-50/50',
    },
    'Região sem comercialização': {
      label: 'Região sem comercialização',
      chip: 'bg-orange-50 text-orange-700 border-orange-100',
      dot: 'bg-orange-500',
      column: 'border-orange-100 bg-orange-50/50',
    },
    'Chamou duas vezes': {
      label: 'Chamou duas vezes',
      chip: 'bg-violet-50 text-violet-700 border-violet-100',
      dot: 'bg-violet-600',
      column: 'border-violet-100 bg-violet-50/50',
    },
    'Telefone não existe': {
      label: 'Telefone não existe',
      chip: 'bg-zinc-100 text-zinc-700 border-zinc-200',
      dot: 'bg-zinc-500',
      column: 'border-zinc-200 bg-zinc-100/70',
    },
  };

  return styles[normalized] || styles['Aguardando atendimento'];
}
