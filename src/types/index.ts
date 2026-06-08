export type UserRole = 'admin' | 'corretor' | 'corretor_membro' | 'gestor_trafego' | 'designer' | 'account_manager' | 'corretor_admin';
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
  is_admin_master?: boolean | null;
  tema_sistema?: 'claro' | 'noturno' | null;
  equipe_orion?: 'apollo' | 'kripto_hunters' | null;
  telefone?: string | null;
  created_at: string;
}

export interface Corretor {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  nome_empresa?: string | null;
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
  comissao_percentual?: number | string | null;
  rodizio_ativo?: boolean | null;
  crm_api_url?: string | null;
  facebook_login?: string | null;
  facebook_senha?: string | null;
  operadoras_info?: Record<string, string | string[]> | null;
  regioes_campanha?: string | null;
  onboarding_status?: 'pendente' | 'dados_completos' | 'campanhas_ativas' | null;
  campanhas_ativas?: boolean | null;
  meta_ad_account_id?: string | null;
  meta_ad_account_name?: string | null;
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
  custo_plano_atual?: string | null;
  investimento: string;
  cidade: string;
  operadora?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  valor_negociacao?: number | string | null;
  operadora_negociacao?: string | null;
  tipo_plano?: string | null;
  valor_venda?: number | string | null;
  valor_comissao?: number | string | null;
  comissao_percentual?: number | string | null;
  sem_interesse_motivo?: string | null;
  sem_interesse_fez_cotacao?: boolean | null;
  cadencia_ativa?: boolean | null;
  cadencia_inicio?: string | null;
  cadencia_fim?: string | null;
  responsavel_membro_id?: string | null;
  responsavel_profile_id?: string | null;
  responsavel_membro?: {
    nome: string;
    email: string;
  } | null;
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

export interface LeadAtividade {
  id: string;
  lead_id: string;
  profile_id: string | null;
  tipo: 'nota' | 'status' | 'ligacao' | 'whatsapp' | 'email' | 'tarefa' | 'sistema';
  titulo: string;
  descricao?: string | null;
  created_at: string;
}

export interface LeadTarefa {
  id: string;
  lead_id: string;
  corretor_id: string | null;
  responsavel_profile_id?: string | null;
  titulo: string;
  descricao?: string | null;
  vencimento?: string | null;
  status: 'pendente' | 'concluida' | 'cancelada';
  prioridade: 'baixa' | 'normal' | 'alta';
  created_at: string;
  updated_at: string;
}

export interface MetaAdAccount {
  id: string;
  meta_account_id: string;
  nome: string;
  currency?: string | null;
  timezone_name?: string | null;
  status?: string | null;
  last_synced_at?: string | null;
}

export interface MetaCampaign {
  id: string;
  meta_campaign_id: string;
  meta_account_id: string;
  nome: string;
  status?: string | null;
  objective?: string | null;
  corretor_id?: string | null;
}

export interface MetaMetricaDiaria {
  id: string;
  meta_account_id: string;
  meta_campaign_id?: string | null;
  corretor_id?: string | null;
  data: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl?: number | null;
}
