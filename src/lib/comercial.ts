export const COMMERCIAL_STATUSES = [
  'Oportunidade',
  '1º dia',
  'Tentando contato',
  'Plano de saúde',
  'Fora do ICP com recurso',
  'Dentro do ICP sem recurso',
  'Reuniões agendadas',
  'No-show',
  'Outros seguros',
  'Fora do MQL',
  'Carrossel holandês',
  'Follow TCV',
  'Follow MRR',
  'Stand-by',
  'Desqualificado',
  'Perdido',
  'Negócio fechado',
] as const;

export type CommercialStage = { id: string; label: string; desc?: string; protected?: boolean };
export const COMMERCIAL_STAGES: CommercialStage[] = COMMERCIAL_STATUSES.map((label) => ({
  id: label,
  label,
  protected: ['Oportunidade', 'Em negociaÃ§Ã£o', 'NegÃ³cio fechado', 'Sem interesse'].includes(label),
}));

export type CommercialStatus = string;
export type CommercialRole = 'coordenador' | 'closer' | 'sdr';

export type CommercialMember = {
  profile_id: string;
  papel: CommercialRole;
  ativo: boolean;
  nome: string;
  email: string | null;
  foto_url?: string | null;
};

export type CommercialLead = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  empresa: string | null;
  estado: string | null;
  origem: string | null;
  campanha: string | null;
  ja_investiu_trafego: string | null;
  faturamento_mensal: string | null;
  prioridade: string | null;
  investimento: string | null;
  vidas: string | null;
  negocio_etapa: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  status: string;
  sdr_id: string | null;
  closer_id: string | null;
  lead_qualificado: boolean;
  valor_negociacao: number;
  valor_fechado: number;
  reuniao_agendada_at: string | null;
  reuniao_realizada_at: string | null;
  reuniao_qualificada: boolean | null;
  no_show: boolean;
  no_show_count: number;
  observacoes: string | null;
  ultimo_contato_at: string | null;
  fechado_at: string | null;
  data_entrada: string;
  status_started_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommercialTask = {
  id: string;
  lead_id: string | null;
  responsavel_id: string;
  titulo: string;
  descricao: string | null;
  vencimento: string | null;
  prioridade: 'baixa' | 'normal' | 'alta';
  status: 'pendente' | 'concluida' | 'cancelada';
  created_at: string;
  updated_at: string;
  lead?: Pick<CommercialLead, 'id' | 'nome' | 'telefone' | 'status'> | null;
};

export function commercialRoleLabel(role?: CommercialRole | null) {
  if (role === 'coordenador') return 'Coordenador comercial';
  if (role === 'closer') return 'Closer';
  return 'SDR';
}

export function currency(value: number | string | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

export function percent(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
