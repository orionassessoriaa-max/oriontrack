export type UserRole = 'admin' | 'corretor' | 'gestor_trafego';
export type TipoCampanha = 'pme' | 'adesao' | 'ambos';

export interface Profile {
  id: string;
  email: string;
  email_real?: string | null;
  nome: string;
  tipo_usuario: UserRole;
  corretor_id: string | null;
  status: 'active' | 'inactive' | 'ativo' | 'inativo' | 'Ativo' | 'Inativo';
  foto_url?: string | null;
  nome_empresa?: string | null;
  precisa_trocar_senha?: boolean | null;
  created_at: string;
}

export interface Corretor {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  slug_pagina?: string;
  link_pagina?: string;
  status: 'active' | 'inactive' | 'ativo' | 'inativo' | 'Ativo' | 'Inativo';
  tipo_campanha?: TipoCampanha | null;
  observacoes?: string;
  time_operacional?: Array<{
    nome: string;
    cargo: string;
  }>;
  gestor_trafego_id?: string | null;
  crm_api_url?: string | null;
  facebook_login?: string | null;
  facebook_senha?: string | null;
  operadoras_info?: Record<string, string | string[]> | null;
  regioes_campanha?: string | null;
  onboarding_status?: 'pendente' | 'dados_completos' | 'campanhas_ativas' | null;
  campanhas_ativas?: boolean | null;
  created_at: string;
}

export type LeadStatus = 
  | 'Aguardando atendimento' 
  | 'Contato feito' 
  | 'Cotação enviada' 
  | 'Região sem comercialização' 
  | 'Venda realizada' 
  | 'Chamou duas vezes' 
  | 'Telefone não existe' 
  | 'Não tive retorno' 
  | 'Em negociação' 
  | 'Sem interesse';

export interface Lead {
  id: string;
  corretor_id: string | null;
  data_entrada: string | null;
  nome: string;
  telefone: string;
  idades: string;
  possui_cnpj: string; // 'Sim' | 'Não' | 'Não informado'
  tem_plano_ativo: string; // 'Sim' | 'Não' | 'Não informado'
  plano_atual: string | null;
  investimento: string;
  cidade: string;
  operadora?: string | null;
  status: LeadStatus;
  etiqueta?: string;
  observacoes?: string;
  created_at: string;
  updated_at: string;
}

export type SupportCategory = 'lead' | 'sistema' | 'financeiro' | 'outro' | 'alinhamento_leads' | 'time_operacional' | 'treinamento_comercial' | 'alinhamento' | 'operacional' | 'treinamento';

export interface SolicitacaoSuporte {
  id: string;
  corretor_id: string | null;
  solicitante_profile_id?: string | null;
  solicitante_nome?: string | null;
  solicitante_tipo?: UserRole | null;
  categoria?: SupportCategory | null;
  tipo: SupportCategory;
  status: 'nova' | 'em andamento' | 'resolvida' | 'pending' | 'completed';
  mensagem: string;
  link_agendamento?: string;
  data_reuniao?: string;
  created_at: string;
}

export interface Material {
  id: string;
  title: string;
  description: string;
  category: string;
}
