export const COMMERCIAL_STATUSES = [
  "Oportunidade",
  "Dia 1",
  "Dia 2",
  "Dia 3",
  "Dia 4",
  "Dia 5",
  "Dia 6",
  "Dia 7",
  "Dia 8",
  "Dia 9",
  "Dia 10",
  "Plano de saúde",
  "Fora do ICP com recurso",
  "Dentro do ICP sem recurso",
  "Reuniões agendadas",
  "No-show",
  "Outros seguros",
  "Fora do MQL",
  "Carrossel holandês",
  "Follow TCV",
  "Follow MRR",
  "Stand-by",
  "Desqualificado",
  "Perdido",
  "Negócio fechado",
] as const;

export type CommercialStage = {
  id: string;
  label: string;
  desc?: string;
  protected?: boolean;
  color?: string;
};
export const COMMERCIAL_STAGES: CommercialStage[] = COMMERCIAL_STATUSES.map(
  (label) => ({
    id: label,
    label,
    protected: [
      "Oportunidade",
      "Em negociaÃ§Ã£o",
      "NegÃ³cio fechado",
      "Sem interesse",
    ].includes(label),
  }),
);

export type CommercialStatus = string;
export type CommercialRole = "coordenador" | "closer" | "sdr" | "visualizador";

export const LEO_COMMERCIAL_CLOSER_PROFILE_ID =
  "97558b76-425a-42b7-900b-46830f2c28d3";

export function canManageCommercialStages(
  role?: CommercialRole | null,
  profileId?: string | null,
) {
  return (
    role === "coordenador" ||
    (role === "closer" && profileId === LEO_COMMERCIAL_CLOSER_PROFILE_ID)
  );
}

export function canAssignCommercialResponsible(
  role?: CommercialRole | null,
  profileId?: string | null,
) {
  return (
    role === "coordenador" ||
    (role === "closer" && profileId === LEO_COMMERCIAL_CLOSER_PROFILE_ID)
  );
}

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
  vendedor_id: string | null;
  lead_qualificado: boolean;
  valor_negociacao: number;
  valor_fechado: number;
  valor_pago: number | null;
  modelo_pagamento: "tcv" | "mrr" | "mesclado" | null;
  reuniao_agendada_at: string | null;
  reuniao_realizada_at: string | null;
  reuniao_qualificada: boolean | null;
  reuniao_link: string | null;
  onboarding_briefing: string | null;
  briefing_gerado_at: string | null;
  no_show: boolean;
  no_show_count: number;
  observacoes: string | null;
  ultimo_contato_at: string | null;
  fechado_at: string | null;
  data_entrada: string;
  status_started_at: string | null;
  contato_cadencia_ativa?: boolean;
  contato_cadencia_inicio?: string | null;
  proximo_retorno_at?: string | null;
  proximo_retorno_titulo?: string | null;
  created_at: string;
  updated_at: string;
};

export type CommercialCadenceAttemptStatus =
  | "pendente"
  | "nao_atendeu"
  | "sem_resposta"
  | "atendeu"
  | "respondeu"
  | "nao_necessario";

export type CommercialCadenceAttempt = {
  id: string;
  lead_id: string;
  dia: number;
  ordem: number;
  canal:
    | "ligacao_fixo"
    | "ligacao_whatsapp"
    | "mensagem_whatsapp"
    | "audio_whatsapp";
  titulo: string;
  status: CommercialCadenceAttemptStatus;
  concluido_at: string | null;
};

export type CommercialContactCadence = {
  active: boolean;
  day: number;
  started_at: string | null;
  completed: boolean;
  attempts: CommercialCadenceAttempt[];
  history: Array<{
    day: number;
    completed: boolean;
    completed_attempts: number;
    attempts: CommercialCadenceAttempt[];
  }>;
};

export type CommercialTask = {
  id: string;
  lead_id: string | null;
  responsavel_id: string;
  titulo: string;
  descricao: string | null;
  vencimento: string | null;
  prioridade: "baixa" | "normal" | "alta";
  status: "pendente" | "concluida" | "cancelada";
  created_at: string;
  updated_at: string;
  lead?: Pick<CommercialLead, "id" | "nome" | "telefone" | "status"> | null;
};

export function commercialRoleLabel(role?: CommercialRole | null) {
  if (role === "coordenador") return "Coordenador comercial";
  if (role === "closer") return "Closer";
  if (role === "visualizador") return "Gestor (somente leitura)";
  return "SDR";
}

export function currency(value: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

export function percent(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
