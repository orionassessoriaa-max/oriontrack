export type FerramentaStatus = 'oculto' | 'disponivel' | 'ativo' | 'em_breve';

export type FerramentaCatalogItem = {
  key: string;
  titulo: string;
  categoria: string;
  resumo: string;
  descricao: string;
  entregas: string[];
  destaque: string;
  accent: string;
};

export const FERRAMENTA_STATUS_LABEL: Record<FerramentaStatus, string> = {
  oculto: 'Oculto',
  disponivel: 'Disponivel',
  ativo: 'Ativo',
  em_breve: 'Em breve',
};

export const FERRAMENTA_CATALOG: FerramentaCatalogItem[] = [
  {
    key: 'ia_atendimento',
    titulo: 'IA de Atendimento',
    categoria: 'Automacao',
    resumo: 'Aline atende, qualifica e encaminha leads para o corretor certo.',
    descricao: 'Agente comercial para iniciar conversas, confirmar dados do formulario, conduzir o lead para agendamento e entregar o resumo para o responsavel.',
    entregas: ['Primeiro contato automatico', 'Qualificacao guiada', 'Resumo para o corretor', 'Handoff quando precisa de humano'],
    destaque: 'Mais vendido',
    accent: 'from-cyan-500 to-blue-600',
  },
  {
    key: 'bot_atendimento',
    titulo: 'Bot de Atendimento',
    categoria: 'WhatsApp',
    resumo: 'Fluxos prontos para responder perguntas frequentes e organizar demandas.',
    descricao: 'Automacao simples para triagem, mensagens de boas-vindas, horario de atendimento, direcionamento para setores e captura de informacoes.',
    entregas: ['Menu de atendimento', 'Respostas rapidas', 'Direcionamento por assunto', 'Registro no CRM'],
    destaque: 'Operacional',
    accent: 'from-emerald-500 to-teal-600',
  },
  {
    key: 'ebook_comercial',
    titulo: 'Ebook Comercial',
    categoria: 'Treinamento',
    resumo: 'Material de apoio para melhorar abordagem, follow-up e fechamento.',
    descricao: 'Conteudo comercial para corretores usarem como guia de processo, com argumentos, scripts e boas praticas para planos de saude.',
    entregas: ['Scripts de abordagem', 'Modelo de follow-up', 'Objeções comuns', 'Checklist de venda'],
    destaque: 'Conteudo',
    accent: 'from-fuchsia-500 to-purple-600',
  },
  {
    key: 'treinamento_comercial',
    titulo: 'Treinamento Comercial',
    categoria: 'Performance',
    resumo: 'Aulas e encontros para padronizar atendimento e aumentar conversao.',
    descricao: 'Treinamento focado em rotina comercial, atendimento rapido, diagnostico do lead, proposta e fechamento com acompanhamento.',
    entregas: ['Aulas gravadas', 'Encontros ao vivo', 'Scripts revisados', 'Plano de acao'],
    destaque: 'Performance',
    accent: 'from-amber-500 to-orange-600',
  },
  {
    key: 'social_media',
    titulo: 'Social Media',
    categoria: 'Marketing',
    resumo: 'Criativos e conteudos para fortalecer autoridade da concessionaria.',
    descricao: 'Pacote de conteudo para redes sociais com foco em prova social, autoridade, captacao e reforco da marca.',
    entregas: ['Artes para feed', 'Stories', 'Calendario editorial', 'Copies comerciais'],
    destaque: 'Marca',
    accent: 'from-rose-500 to-pink-600',
  },
  {
    key: 'landing_pages',
    titulo: 'Landing Pages',
    categoria: 'Captacao',
    resumo: 'Paginas de captura para campanhas, funis e ofertas especificas.',
    descricao: 'Paginas comerciais de alta conversao integradas ao funil de leads, com foco em campanhas por produto, cidade ou operadora.',
    entregas: ['Pagina de captura', 'Formulario integrado', 'Copy comercial', 'Pixel e UTMs'],
    destaque: 'Captacao',
    accent: 'from-indigo-500 to-sky-600',
  },
];

export function getFerramentaByKey(key: string) {
  return FERRAMENTA_CATALOG.find((item) => item.key === key) || null;
}

export function isFerramentaStatus(value: unknown): value is FerramentaStatus {
  return typeof value === 'string' && ['oculto', 'disponivel', 'ativo', 'em_breve'].includes(value);
}
