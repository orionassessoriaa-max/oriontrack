export type FerramentaStatus = 'oculto' | 'disponivel' | 'ativo' | 'em_breve';

export type FerramentaCatalogItem = {
  key: string;
  titulo: string;
  categoria: string;
  resumo: string;
  descricao: string;
  entregas: string[];
  beneficios?: string[];
  funcionamento?: string[];
  destaque: string;
  accent: string;
  coverImage?: string;
  tipo?: string;
  defaultStatus?: FerramentaStatus;
};

export const FERRAMENTA_STATUS_LABEL: Record<FerramentaStatus, string> = {
  oculto: 'Oculto',
  disponivel: 'Disponivel',
  ativo: 'Ativo',
  em_breve: 'Em breve',
};

export const FERRAMENTA_CATALOG: FerramentaCatalogItem[] = [
  {
    key: 'bot_atendimento',
    titulo: 'Bot de Atendimento',
    categoria: 'Atendimento',
    resumo: 'Fluxo automatico mais simples, com respostas prontas e menus.',
    descricao: 'Atendimento padrao para triagem, mensagens rapidas, horarios, setores e encaminhamento inicial dentro do WhatsApp.',
    entregas: ['Respostas automaticas', 'Menus interativos', 'Coleta de dados', 'Encaminhamento inteligente', 'Horarios personalizados'],
    beneficios: ['Atendimento 24/7', 'Reducao do tempo de resposta', 'Mais agilidade na triagem', 'Melhor experiencia para o lead'],
    funcionamento: ['Configure mensagens e menus', 'Defina regras de encaminhamento', 'Ative nos canais', 'Leads sao atendidos automaticamente'],
    destaque: 'Ativa',
    accent: 'from-emerald-500 to-teal-600',
    coverImage: '/ferramentas/bot.png',
    tipo: 'Automacao',
    defaultStatus: 'ativo',
  },
  {
    key: 'ia_atendimento',
    titulo: 'IA de Atendimento',
    categoria: 'Atendimento',
    resumo: 'Atendimento automatizado humanizado para leads.',
    descricao: 'Inicia conversa, coleta dados, entende interesse, conduz o lead para o proximo passo e encaminha para o responsavel quando necessario.',
    entregas: ['Primeiro contato automatico', 'Qualificacao guiada', 'Resumo para o corretor', 'Handoff para humano', 'Resposta em texto e audio'],
    beneficios: ['Mais velocidade no primeiro contato', 'Padronizacao do atendimento', 'Menos lead parado', 'Resumo pronto para o time comercial'],
    funcionamento: ['Lead entra no CRM', 'IA inicia a conversa', 'Coleta dados pendentes', 'Encaminha ao responsavel'],
    destaque: 'Ativa',
    accent: 'from-amber-500 to-orange-600',
    coverImage: '/ferramentas/ia.png',
    tipo: 'IA',
    defaultStatus: 'ativo',
  },
  {
    key: 'pagina_comercial',
    titulo: 'Pagina Comercial',
    categoria: 'Captacao',
    resumo: 'Paginas de vendas estrategicas para captar leads.',
    descricao: 'Pagina comercial para apresentar sua corretora, ofertas, provas sociais e formularios integrados ao funil de captacao.',
    entregas: ['Pagina de captura', 'Formulario integrado', 'Copy comercial', 'Pixel e UTMs', 'Versao responsiva'],
    beneficios: ['Mais credibilidade', 'Campanhas com destino certo', 'Captacao organizada', 'Melhor apresentacao da corretora'],
    funcionamento: ['Defina a oferta', 'Criamos a pagina', 'Conectamos ao CRM', 'Leads entram no funil'],
    destaque: 'Ativa',
    accent: 'from-lime-500 to-cyan-600',
    coverImage: '/ferramentas/pagina-comercial.png',
    tipo: 'Landing page',
    defaultStatus: 'ativo',
  },
  {
    key: 'captacao_imagens_videos',
    titulo: 'Captacao de Imagens e Videos',
    categoria: 'Conteudo',
    resumo: 'Producao presencial em Brasilia para fotos e videos profissionais.',
    descricao: 'Captacao de imagens e videos para fortalecer a presenca digital da corretora, equipe e rotina comercial. Disponivel somente para Brasilia.',
    entregas: ['Fotos profissionais', 'Videos curtos', 'Bastidores comerciais', 'Conteudo para redes sociais'],
    beneficios: ['Mais autoridade visual', 'Conteudo real da equipe', 'Melhor percepcao de marca', 'Material para campanhas'],
    funcionamento: ['Agende a captacao', 'Defina roteiro', 'Gravacao presencial', 'Entrega dos arquivos'],
    destaque: 'Ativa',
    accent: 'from-blue-500 to-cyan-600',
    coverImage: '/ferramentas/captacao.png',
    tipo: 'Presencial',
    defaultStatus: 'ativo',
  },
  {
    key: 'social_media',
    titulo: 'Social Media',
    categoria: 'Marketing',
    resumo: 'Conteudo profissional para fortalecer sua marca.',
    descricao: 'Conteudos para gerar autoridade, manter presenca nas redes e atrair mais clientes todos os dias.',
    entregas: ['Artes para feed', 'Stories', 'Calendario editorial', 'Copies comerciais', 'Linha visual'],
    beneficios: ['Marca mais forte', 'Mais constancia', 'Conteudo com cara profissional', 'Apoio para captacao'],
    funcionamento: ['Defina objetivos', 'Criamos pauta', 'Produzimos artes', 'Publicacao segue o calendario'],
    destaque: 'Ativa',
    accent: 'from-orange-500 to-amber-700',
    coverImage: '/ferramentas/social-media.png',
    tipo: 'Marketing',
    defaultStatus: 'ativo',
  },
  {
    key: 'treinamento_comercial',
    titulo: 'Treinamento Comercial',
    categoria: 'Treinamento',
    resumo: 'Capacitacao pratica para melhorar abordagem e fechamento.',
    descricao: 'Treinamento focado em rotina comercial, atendimento rapido, diagnostico do lead, proposta, follow-up e fechamento.',
    entregas: ['Aulas praticas', 'Scripts revisados', 'Plano de acao', 'Checklist de atendimento'],
    beneficios: ['Mais padrao no time', 'Melhor follow-up', 'Mais seguranca na venda', 'Processo comercial claro'],
    funcionamento: ['Mapeamos gargalos', 'Treinamos o time', 'Ajustamos scripts', 'Acompanhamos evolucao'],
    destaque: 'Ativa',
    accent: 'from-lime-500 to-emerald-700',
    tipo: 'Capacitacao',
    defaultStatus: 'ativo',
  },
  {
    key: 'simulador',
    titulo: 'Simulador',
    categoria: 'Vendas',
    resumo: 'Ferramenta para simular cenarios e apoiar propostas comerciais.',
    descricao: 'Simulador para organizar dados do cliente, comparar cenarios e ajudar o time comercial a conduzir uma proposta com mais clareza.',
    entregas: ['Entrada de dados', 'Cenarios de proposta', 'Resumo comercial', 'Apoio para follow-up'],
    beneficios: ['Mais clareza na proposta', 'Menos retrabalho', 'Comparacao mais rapida', 'Atendimento mais consultivo'],
    funcionamento: ['Preencha dados', 'Escolha o cenario', 'Revise a simulacao', 'Use no atendimento'],
    destaque: 'Disponivel',
    accent: 'from-indigo-500 to-blue-700',
    tipo: 'Comercial',
    defaultStatus: 'disponivel',
  },
  {
    key: 'automacao_comercial',
    titulo: 'Automacao Comercial',
    categoria: 'Automacao',
    resumo: 'Fluxos automaticos para nutricao, follow-ups e envio de mensagens.',
    descricao: 'Automacoes para manter leads aquecidos, organizar follow-up e disparar mensagens no momento certo.',
    entregas: ['Fluxos de follow-up', 'Mensagens programadas', 'Regras por status', 'Alertas para o time'],
    beneficios: ['Menos esquecimento', 'Mais cadencia comercial', 'Processo previsivel', 'Mais leads acompanhados'],
    funcionamento: ['Defina etapas', 'Configure mensagens', 'Ative regras', 'Acompanhe resultados'],
    destaque: 'Disponivel',
    accent: 'from-violet-500 to-purple-800',
    tipo: 'Automacao',
    defaultStatus: 'disponivel',
  },
];

export function getFerramentaByKey(key: string) {
  return FERRAMENTA_CATALOG.find((item) => item.key === key) || null;
}

export function isFerramentaStatus(value: unknown): value is FerramentaStatus {
  return typeof value === 'string' && ['oculto', 'disponivel', 'ativo', 'em_breve'].includes(value);
}
