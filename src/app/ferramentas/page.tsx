'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { FerramentaCatalogItem, FerramentaStatus } from '@/lib/ferramentas';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  Search,
  Sparkles,
  X,
  Info,
  Calendar,
  Layers,
  CheckCircle2,
  HelpCircle,
  TrendingUp,
  ArrowUpRight,
  BarChart3,
  Clock3,
  MessageCircle,
  ShieldCheck,
  Target,
  Zap,
} from 'lucide-react';

// Premium metadata and copywriting for the 6 tools that have visual assets
interface PremiumMetadata {
  coverImage: string;
  displayTitle: string;
  categoria: string;
  pitch: string;
  entregas: string[];
  beneficios: string[];
  funcionamento: string[];
  accentColor: string;
  accentGlow: string;
}

const PREMIUM_METADATA: Record<string, PremiumMetadata> = {
  bot_atendimento: {
    coverImage: '/ferramentas/capa/bot1.png',
    displayTitle: 'Bot de Atendimento',
    categoria: 'Atendimento Automático',
    pitch: 'Não perca mais nenhum lead por demora no atendimento. O Bot de Atendimento trabalha para você todos os dias, envia respostas instantâneas no WhatsApp, qualifica os clientes com menus interativos e direciona cada contato para o responsável certo.',
    entregas: [
      'Respostas automáticas no WhatsApp',
      'Menus interativos de seleção simples',
      'Coleta preliminar de dados do lead',
      'Direcionamento inteligente de atendimentos',
      'Horários de atendimento personalizados'
    ],
    beneficios: [
      'Disponibilidade total 24/7/365',
      'Redução drástica no tempo de resposta inicial',
      'Triagem padronizada e sem erros humanos',
      'Melhoria perceptível na experiência do lead'
    ],
    funcionamento: [
      'Nossa equipe configura suas mensagens e fluxos de atendimento.',
      'Definimos juntos as regras de transbordo e encaminhamento.',
      'Conectamos o robô ao seu número de WhatsApp comercial.',
      'O bot assume o primeiro contato instantaneamente quando chega um lead.'
    ],
    accentColor: '#10b981', // emerald-500
    accentGlow: 'hover:shadow-[0_0_25px_rgba(16,185,129,0.45)] hover:border-emerald-500/80',
  },
  ia_atendimento: {
    coverImage: '/ferramentas/capa/ia1.png',
    displayTitle: 'IA de Atendimento',
    categoria: 'Inteligência Artificial',
    pitch: 'Tenha uma inteligência artificial conversando com seus leads de forma natural e objetiva. A IA de Atendimento entende a intenção do cliente, responde dúvidas de forma humanizada, envia áudios, qualifica o perfil de compra e entrega um resumo completo para o corretor assumir no momento certo.',
    entregas: [
      'Qualificação guiada baseada em IA',
      'Respostas realistas em texto e áudio por voz',
      'Resumo automático de perfil para o corretor',
      'Handoff inteligente para atendimento humano',
      'Suporte a dúvidas frequentes configurável'
    ],
    beneficios: [
      'Primeiro contato em menos de 60 segundos',
      'Abordagem humanizada e personalizada para cada lead',
      'Eliminação imediata de leads curiosos ou sem perfil',
      'Aumento nas taxas de agendamento e fechamento comercial'
    ],
    funcionamento: [
      'O lead é gerado pelas suas campanhas de tráfego.',
      'A IA inicia o diálogo de forma amigável no WhatsApp.',
      'Coleta as informações-chave (ex: orçamento, região, prazo).',
      'Notifica você e envia o resumo da conversa para seu fechamento.'
    ],
    accentColor: '#f59e0b', // amber-500
    accentGlow: 'hover:shadow-[0_0_25px_rgba(245,158,11,0.45)] hover:border-amber-500/80',
  },
  pagina_comercial: {
    coverImage: '/ferramentas/capa/paginacomercial1.png',
    displayTitle: 'Página Comercial',
    categoria: 'Funil de Vendas',
    pitch: 'Seus anúncios precisam de uma página de destino à altura. A Página Comercial é criada com foco em conversão para planos de saúde: apresenta sua corretora, diferenciais, prova social e formulário integrado para captar leads qualificados diretamente no CRM.',
    entregas: [
      'Landing Page premium de alta conversão',
      'Formulário dinâmico integrado ao Orion Track',
      'Estrutura de copy validada por especialistas',
      'Integração completa de tags (Meta Pixel, Google Analytics, UTMs)',
      'Design responsivo focado em mobile'
    ],
    beneficios: [
      'Aumento imediato na taxa de conversão de anúncios',
      'Fortalecimento da autoridade da sua marca no mercado',
      'Leads mais informados e prontos para comprar',
      'Rastreamento preciso de dados de campanhas'
    ],
    funcionamento: [
      'Escolha o produto ou posicionamento principal.',
      'Nossa equipe desenvolve a estrutura e copywriting.',
      'Configuramos o domínio próprio e integramos ao Orion Track.',
      'Seus anúncios direcionam os clientes para a página otimizada.'
    ],
    accentColor: '#06b6d4', // cyan-500
    accentGlow: 'hover:shadow-[0_0_25px_rgba(6,182,212,0.45)] hover:border-cyan-500/80',
  },
  captacao_imagens_videos: {
    coverImage: '/ferramentas/capa/captação1.png',
    displayTitle: 'Captação de Imagens e Vídeos',
    categoria: 'Produção Audiovisual',
    pitch: 'Imagens vendem mais que palavras. Fortaleça a imagem da sua corretora com fotos da equipe e vídeos profissionais para anúncios e redes sociais. Nossa equipe vai até você para captar conteúdos reais, com direção e qualidade visual. Disponível apenas para Brasília e região.',
    entregas: [
      'Sessão de fotos corporativas da equipe',
      'Produção e captação de vídeos para Reels/TikTok',
      'Roteirização de vídeos focada em atração comercial',
      'Edição profissional dinâmica com som e legendas'
    ],
    beneficios: [
      'Geração de autoridade imediata frente aos clientes',
      'Acervo de fotos reais para postagens e anúncios',
      'Vídeos que retêm a atenção e geram compartilhamento',
      'Profissionalismo visual que se destaca dos concorrentes'
    ],
    funcionamento: [
      'Agende o melhor dia e horário no painel Orion.',
      'Nossa equipe de conteúdo define os roteiros com você.',
      'Realizamos a captação presencial de fotos e vídeos.',
      'Entregamos os materiais editados e prontos para postar.'
    ],
    accentColor: '#3b82f6', // blue-500
    accentGlow: 'hover:shadow-[0_0_25px_rgba(59,130,246,0.45)] hover:border-blue-500/80',
  },
  social_media: {
    coverImage: '/ferramentas/capa/socialmedia1.png',
    displayTitle: 'Social Media',
    categoria: 'Gestão de Marca',
    pitch: 'Mantenha suas redes sociais movimentadas e profissionais sem gastar seu precioso tempo. Nós criamos, planejamos e estruturamos um calendário de postagens de alta qualidade exclusivo para corretores, com artes elegantes, legendas estratégicas e conteúdo que atrai seguidores prontos para fazer negócios.',
    entregas: [
      'Calendário de postagens mensal completo',
      'Artes personalizadas de alta qualidade para o feed',
      'Templates de stories interativos e engajadores',
      'Legendas persuasivas com chamadas para ação (CTA)'
    ],
    beneficios: [
      'Presença online constante e sem esforço diário',
      'Redes sociais com estética moderna e confiável',
      'Atração orgânica de potenciais compradores',
      'Mais tempo livre para focar no fechamento de vendas'
    ],
    funcionamento: [
      'Entendemos a identidade e foco da sua marca.',
      'Elaboramos o cronograma estratégico mensal de posts.',
      'Nossos designers e redatores criam os criativos.',
      'Você aprova e publica de forma automática ou manual.'
    ],
    accentColor: '#f97316', // orange-500
    accentGlow: 'hover:shadow-[0_0_25px_rgba(249,115,22,0.45)] hover:border-orange-500/80',
  },
  treinamento_comercial: {
    coverImage: '/ferramentas/capa/treinamento1.png',
    displayTitle: 'Treinamento Comercial',
    categoria: 'Alta Performance',
    pitch: 'Novos leads só viram venda quando o atendimento é bem conduzido. O Treinamento Comercial é prático e direto, focado nas principais dores do corretor de planos de saúde: abordagem rápida, scripts de WhatsApp, contorno de objeções e técnicas de fechamento.',
    entregas: [
      'Aulas práticas gravadas focadas em vendas',
      'Scripts de abordagem e contorno de objeções no WhatsApp',
      'Scripts estruturados para reuniões de venda virtuais',
      'Acompanhamento e checklists diários de conversão'
    ],
    beneficios: [
      'Aumento imediato na conversão de leads para agendamentos',
      'Equipe comercial alinhada e utilizando técnicas de ponta',
      'Segurança total para falar de valores e fechamentos',
      'Processo comercial claro, previsível e mensurável'
    ],
    funcionamento: [
      'Avaliamos as principais dores do seu time de vendas.',
      'Fornecemos acesso à nossa plataforma de capacitação.',
      'Implementamos os scripts adaptados no seu dia a dia.',
      'Acompanhamos a evolução dos resultados e ajustamos.'
    ],
    accentColor: '#84cc16', // lime-500
    accentGlow: 'hover:shadow-[0_0_25px_rgba(132,204,22,0.45)] hover:border-lime-500/80',
  }
};

type Tool = FerramentaCatalogItem & {
  status: FerramentaStatus;
  observacoes: string | null;
  premium?: PremiumMetadata;
};

type RawTool = FerramentaCatalogItem & {
  status: FerramentaStatus;
  observacoes: string | null;
};

type ToolsResponse = {
  tools?: RawTool[];
  error?: string;
};

const getToolTitle = (tool: Tool | null) => tool?.premium?.displayTitle || tool?.titulo || '';

const IMPACT_METRICS = [
  {
    label: 'Resposta mais rapida',
    value: '24/7',
    description: 'O lead recebe retorno mesmo fora do horario comercial.',
    icon: Clock3,
  },
  {
    label: 'Operacao mais previsivel',
    value: '+ ritmo',
    description: 'Cada ferramenta remove gargalos do atendimento ao fechamento.',
    icon: BarChart3,
  },
  {
    label: 'Equipe mais focada',
    value: '- retrabalho',
    description: 'O corretor fica livre para vender, acompanhar e fechar.',
    icon: Target,
  },
];

const MOTIVATION_CARDS = [
  {
    title: 'Atendimento que nao esfria',
    description: 'Bot e IA seguram o primeiro contato, qualificam e entregam contexto para o corretor entrar com mais precisao.',
    icon: MessageCircle,
    glow: 'from-emerald-500/20 to-cyan-500/10',
  },
  {
    title: 'Marca que passa confianca',
    description: 'Pagina comercial, social media e conteudos reais fazem a corretora parecer maior antes mesmo da primeira conversa.',
    icon: ShieldCheck,
    glow: 'from-blue-500/20 to-violet-500/10',
  },
  {
    title: 'Time com mais argumento',
    description: 'Treinamento e materiais comerciais reduzem improviso e deixam a abordagem mais clara, rapida e consistente.',
    icon: Zap,
    glow: 'from-amber-500/20 to-red-500/10',
  },
];

export default function FerramentasPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  
  // Hero section selection
  const [heroToolKey, setHeroToolKey] = useState<string | null>(null);
  const [heroDirection, setHeroDirection] = useState(1);
  
  // Detail Modal selection
  const [detailToolKey, setDetailToolKey] = useState<string | null>(null);
  
  // Consultation State
  const [submittingConsultation, setSubmittingConsultation] = useState(false);
  const [consultationSuccess, setConsultationSuccess] = useState<string | null>(null);
  const [consultationError, setConsultationError] = useState<string | null>(null);

  // Scroll Refs for rows
  const activeRowRef = useRef<HTMLDivElement>(null);
  const availableRowRef = useRef<HTMLDivElement>(null);

  async function loadTools() {
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setError('Sessão expirada. Faça login novamente.');
        return;
      }

      const response = await fetch('/api/ferramentas', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as ToolsResponse;
      if (!response.ok) {
        setError(data.error || 'Erro ao carregar ferramentas.');
        return;
      }

      // Filter and map tools to only include the ones with premium metadata
      const loadedTools: Tool[] = (data.tools || [])
        .filter((tool) => PREMIUM_METADATA[tool.key])
        .map((tool) => ({
          ...tool,
          premium: PREMIUM_METADATA[tool.key],
        }));

      setTools(loadedTools);
      
      // Select first active tool as default hero tool
      const defaultHero = loadedTools.find((t) => t.status === 'ativo')?.key || loadedTools[0]?.key || null;
      setHeroToolKey(defaultHero);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro de rede ao carregar ferramentas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const loadTimeout = window.setTimeout(() => {
      void loadTools();
    }, 0);
    return () => window.clearTimeout(loadTimeout);
  }, []);

  // Hero auto-rotation loop
  useEffect(() => {
    if (tools.length === 0) return;
    const interval = setInterval(() => {
      setHeroToolKey((currentKey) => {
        const currentIndex = tools.findIndex((t) => t.key === currentKey);
        if (currentIndex === -1) return tools[0]?.key || null;
        setHeroDirection(1);
        const nextIndex = (currentIndex + 1) % tools.length;
        return tools[nextIndex].key;
      });
    }, 6000); // cycle every 6 seconds
    return () => clearInterval(interval);
  }, [tools]);

  // Filter tools based on search term
  const visibleTools = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tools;
    return tools.filter((tool) =>
      `${tool.titulo} ${tool.categoria} ${tool.resumo} ${tool.descricao}`
        .toLowerCase()
        .includes(term)
    );
  }, [search, tools]);

  const activeTools = useMemo(() => visibleTools.filter((tool) => tool.status === 'ativo'), [visibleTools]);
  const availableTools = useMemo(() => visibleTools.filter((tool) => tool.status !== 'ativo' && tool.status !== 'oculto'), [visibleTools]);

  const selectedHeroTool = useMemo(() => {
    return tools.find((tool) => tool.key === heroToolKey) || tools[0] || null;
  }, [heroToolKey, tools]);

  const selectedDetailTool = useMemo(() => {
    return tools.find((tool) => tool.key === detailToolKey) || null;
  }, [detailToolKey, tools]);

  const moveHero = (direction: 1 | -1) => {
    if (tools.length === 0) return;
    setHeroDirection(direction);
    setHeroToolKey((currentKey) => {
      const currentIndex = tools.findIndex((tool) => tool.key === currentKey);
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = (safeIndex + direction + tools.length) % tools.length;
      return tools[nextIndex].key;
    });
  };

  const selectHeroTool = (key: string) => {
    const currentIndex = tools.findIndex((tool) => tool.key === heroToolKey);
    const nextIndex = tools.findIndex((tool) => tool.key === key);
    setHeroDirection(nextIndex >= currentIndex ? 1 : -1);
    setHeroToolKey(key);
  };

  const handleHeroDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: { offset: { x: number } }) => {
    if (info.offset.x < -70) moveHero(1);
    if (info.offset.x > 70) moveHero(-1);
  };

  // Scroll handlers for rows
  const handleScroll = (ref: React.RefObject<HTMLDivElement | null>, direction: 'left' | 'right') => {
    if (ref.current) {
      const scrollAmount = 480;
      ref.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  // Consultation Submission
  const handleConsultAvailability = async (tool: Tool) => {
    if (!tool || submittingConsultation) return;

    setSubmittingConsultation(true);
    setConsultationError(null);
    setConsultationSuccess(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      const response = await fetch('/api/support/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          categoria: 'sistema',
          tipo: 'sistema',
          mensagem: `[Solicitação de ativação] O corretor demonstrou interesse na ferramenta "${getToolTitle(tool)}" (chave: ${tool.key}). Entrar em contato para validar disponibilidade, condições e próximos passos.`,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Não foi possível enviar a solicitação.');
      }

      setConsultationSuccess(`Solicitação enviada. Seu gerente comercial analisará a ativação da ferramenta "${getToolTitle(tool)}" e entrará em contato.`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setConsultationError(err.message || 'Erro ao processar solicitação de suporte.');
    } finally {
      setSubmittingConsultation(false);
    }
  };

  return (
    <InternalLayout>
      <main className="min-h-screen bg-[#111115] text-white -mx-3 -my-5 pb-24 overflow-x-hidden font-sans netflix-theme sm:-mx-5 sm:-my-7 lg:-mx-7 lg:-my-7 relative">
        <style dangerouslySetInnerHTML={{ __html: `
          .scrollbar-none::-webkit-scrollbar {
            display: none;
          }
          .scrollbar-none {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: scale(1.01); }
            to { opacity: 1; transform: scale(1); }
          }
          .animate-fade-in {
            animation: fadeIn 0.6s ease-out forwards;
          }
          @keyframes toolFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          @keyframes toolPulseLine {
            0% { transform: scaleX(0); opacity: 0.2; }
            45%, 100% { transform: scaleX(1); opacity: 1; }
          }
          .tool-float {
            animation: toolFloat 5s ease-in-out infinite;
          }
          .tool-pulse-line {
            transform-origin: left;
            animation: toolPulseLine 2.8s ease-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .tool-float,
            .tool-pulse-line {
              animation: none !important;
            }
          }
          
          /* Neutralize light theme overrides for the Netflix dashboard */
          .netflix-theme {
            background-color: #111115 !important;
            color: #ffffff !important;
          }
          .theme-claro .netflix-theme {
            background-color: #111115 !important;
            color: #ffffff !important;
          }
          .theme-claro .netflix-theme :is(button, a, span, p, h1, h2, h3, h4, li, ol, ul):not(.text-red-500):not(.text-emerald-400):not(.text-emerald-300):not(.text-red-200):not(.text-red-300):not(.text-black) {
            color: inherit !important;
          }
          .theme-claro .netflix-theme .text-black,
          .theme-claro .netflix-theme .text-black * {
            color: #000000 !important;
          }
          .theme-claro .netflix-theme .text-red-500 {
            color: #ef4444 !important;
          }
          .theme-claro .netflix-theme .text-emerald-400 {
            color: #34d399 !important;
          }
          .theme-claro .netflix-theme .text-emerald-300 {
            color: #6ee7b7 !important;
          }
          .theme-claro .netflix-theme .text-red-200 {
            color: #fca5a5 !important;
          }
          .theme-claro .netflix-theme .text-red-300 {
            color: #fca5a5 !important;
          }
          .theme-claro .netflix-theme .bg-white {
            background-color: #ffffff !important;
          }
          .theme-claro .netflix-theme .bg-white:hover {
            background-color: #e2e8f0 !important;
          }
          .theme-claro .netflix-theme .btn-conhecer {
            background-color: rgba(255, 255, 255, 0.25) !important;
            color: #ffffff !important;
          }
          .theme-claro .netflix-theme .btn-conhecer * {
            color: #ffffff !important;
            fill: #ffffff !important;
            stroke: #ffffff !important;
          }
        ` }} />
        
        {/* Search Navigation */}
        <div className="absolute top-0 right-0 z-30 pt-24 lg:pt-28 xl:pt-32 px-6 md:px-16 flex justify-end w-full pointer-events-none">
          <div className="relative w-full md:w-80 xl:w-96 pointer-events-auto">
            <Search className="absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar ferramenta..."
              className="w-full pl-10 pr-9 py-2.5 rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-white placeholder-slate-400 focus:outline-none focus:border-red-500 focus:bg-white/[0.08] transition duration-300"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-red-500" size={48} />
              <p className="text-sm font-bold text-slate-400 tracking-wider uppercase animate-pulse">Carregando ferramentas...</p>
            </div>
          </div>
        ) : error ? (
          <div className="max-w-2xl mx-auto mt-20 p-6 rounded-2xl border border-red-500/20 bg-red-500/10 text-center">
            <p className="text-base font-bold text-red-300">{error}</p>
            <button
              onClick={loadTools}
              className="mt-4 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold transition"
            >
              Tentar novamente
            </button>
          </div>
        ) : visibleTools.length === 0 ? (
          <div className="max-w-md mx-auto mt-20 text-center p-8 rounded-2xl border border-white/5 bg-white/[0.02]">
            <HelpCircle className="mx-auto text-slate-500 mb-4 animate-bounce" size={48} />
            <p className="text-lg font-bold">Nenhuma ferramenta encontrada</p>
            <p className="text-sm text-slate-400 mt-1">Ajuste seu termo de busca para localizar as ferramentas.</p>
          </div>
        ) : (
          <>
            {/* HERO BANNER - Netflix Billboard Style */}
            {selectedHeroTool && selectedHeroTool.premium && (
              <motion.section
                className="relative w-full min-h-[650px] md:min-h-[640px] lg:min-h-[660px] xl:min-h-[760px] 2xl:min-h-[840px] h-auto lg:h-[calc(100dvh-64px)] xl:h-[calc(100dvh-40px)] flex items-center justify-start overflow-hidden shadow-2xl -mt-24 lg:-mt-28 touch-pan-y"
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.08}
                onDragEnd={handleHeroDragEnd}
              >
                {/* Background Image with Dark Vignette/Fade Gradients */}
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={`hero-bg-${selectedHeroTool.key}`}
                    initial={{ opacity: 0, x: heroDirection * 80 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: heroDirection * -80 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0 z-0"
                  >
                    <img
                      src={selectedHeroTool.premium.coverImage}
                      alt={getToolTitle(selectedHeroTool)}
                      className="w-full h-full object-cover object-center scale-105 filter brightness-[0.65]"
                    />
                    {/* Left Side Shadow for Text Contrast */}
                    <div className="absolute inset-0 bg-gradient-to-r from-[#111115] via-[#111115]/75 to-transparent z-10 w-full md:w-1/2" />
                    {/* Base Gradient Fade to Black */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#111115] via-transparent to-transparent z-10" />
                  </motion.div>
                </AnimatePresence>

                <button
                  type="button"
                  aria-label="Ferramenta anterior"
                  onClick={() => moveHero(-1)}
                  className="absolute left-3 md:left-5 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/85 backdrop-blur-md transition hover:bg-black/60 hover:text-white"
                >
                  <ChevronLeft size={20} />
                </button>

                <button
                  type="button"
                  aria-label="Próxima ferramenta"
                  onClick={() => moveHero(1)}
                  className="absolute right-3 md:right-5 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/85 backdrop-blur-md transition hover:bg-black/60 hover:text-white"
                >
                  <ChevronRight size={20} />
                </button>

                {/* Hero Content */}
                <AnimatePresence initial={false} mode="wait">
                  <motion.div
                    key={`hero-content-${selectedHeroTool.key}`}
                    initial={{ opacity: 0, x: heroDirection * 52 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: heroDirection * -52 }}
                    transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                    className="relative z-20 max-w-2xl lg:max-w-3xl xl:max-w-4xl px-14 md:pl-16 md:pr-6 lg:pl-20 xl:pl-24 pt-28 md:pt-32 lg:pt-32 xl:pt-44 2xl:pt-56 pb-28 lg:pb-36 xl:pb-44 flex flex-col items-start gap-4 xl:gap-6"
                  >
                    <div className="flex items-center gap-2">
                      <span className="bg-red-600 text-white text-[10px] lg:text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded">
                        DESTAQUE
                      </span>
                      <span className="text-slate-300 text-xs lg:text-sm font-bold flex items-center gap-1">
                        <Layers size={13} className="text-red-500 lg:w-4 lg:h-4" />
                        {selectedHeroTool.premium.categoria}
                      </span>
                    </div>

                    <h2 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl 2xl:text-[6rem] font-black tracking-tighter text-white leading-[0.95] drop-shadow-md">
                      {getToolTitle(selectedHeroTool)}
                    </h2>

                    <p className="text-sm md:text-base lg:text-base xl:text-lg 2xl:text-xl font-medium leading-relaxed text-slate-300 drop-shadow max-w-lg lg:max-w-xl xl:max-w-2xl 2xl:max-w-4xl">
                      {selectedHeroTool.premium.pitch}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      <button
                        onClick={() => setDetailToolKey(selectedHeroTool.key)}
                        style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)', color: '#ffffff' }}
                        className="flex items-center gap-2 hover:bg-white/30 transition duration-300 font-extrabold text-sm md:text-base xl:text-lg px-6 py-3 xl:px-8 xl:py-4 2xl:px-10 2xl:py-5 rounded-lg shadow-lg cursor-pointer btn-conhecer"
                      >
                        <Play size={18} className="xl:w-5 xl:h-5 2xl:w-6 2xl:h-6" fill="#ffffff" stroke="#ffffff" />
                        Conhecer detalhes
                      </button>

                      {selectedHeroTool.status === 'ativo' ? (
                        <span className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-bold text-sm md:text-base xl:text-lg px-4 py-3 xl:px-6 xl:py-4 2xl:px-8 2xl:py-5 rounded-lg">
                          <Check size={16} className="xl:w-5 xl:h-5 2xl:w-6 2xl:h-6" strokeWidth={3} />
                          Disponível na sua conta
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setDetailToolKey(selectedHeroTool.key);
                          }}
                          className="flex items-center gap-2 bg-red-600/30 hover:bg-red-600/50 border border-red-500/45 text-red-200 hover:text-white transition duration-300 font-extrabold text-sm md:text-base xl:text-lg px-5 py-3 xl:px-7 xl:py-4 2xl:px-9 2xl:py-5 rounded-lg cursor-pointer"
                        >
                          <Info size={16} className="xl:w-5 xl:h-5 2xl:w-6 2xl:h-6" />
                          Consultar disponibilidade
                        </button>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Subtitle Indicator at Right Corner */}
                <div className="absolute right-6 bottom-16 z-20 hidden md:flex items-center gap-1.5 text-xs text-slate-400 font-bold bg-black/40 px-3 py-1.5 rounded-full border border-white/5 backdrop-blur-sm">
                  <TrendingUp size={14} className="text-red-500" />
                  Alta conversão comprovada
                </div>
              </motion.section>
            )}

            {/* CAROUSELS SECTION */}
            <div className="w-full px-6 md:px-16 -mt-6 md:-mt-10 lg:-mt-14 xl:-mt-20 2xl:-mt-24 pb-20 relative z-20 space-y-12 lg:space-y-16 xl:space-y-24">
              
              {/* Row 1: Active Tools */}
              {activeTools.length > 0 && (
                <div className="relative group/row">
                  <h3 className="text-lg md:text-xl xl:text-2xl 2xl:text-3xl font-black tracking-tight text-white mb-4 flex flex-wrap items-center gap-2">
                    <span className="h-5 w-1 bg-emerald-500 rounded-full" />
                    Minhas ferramentas ativas
                    <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                      {activeTools.length} {activeTools.length === 1 ? 'ativa' : 'ativas'}
                    </span>
                  </h3>

                  {/* Left scroll control */}
                  <button
                    onClick={() => handleScroll(activeRowRef, 'left')}
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-30 h-[80%] w-10 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover/row:opacity-100 transition duration-300 border-r border-white/5 backdrop-blur-sm rounded-r-xl"
                  >
                    <ChevronLeft size={28} />
                  </button>

                  {/* Right scroll control */}
                  <button
                    onClick={() => handleScroll(activeRowRef, 'right')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-30 h-[80%] w-10 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover/row:opacity-100 transition duration-300 border-l border-white/5 backdrop-blur-sm rounded-l-xl"
                  >
                    <ChevronRight size={28} />
                  </button>

                  {/* Card Container */}
                  <div
                    ref={activeRowRef}
                    className="flex gap-4 overflow-x-auto py-2 scroll-smooth scrollbar-none [scrollbar-width:none]"
                  >
                    {activeTools.map((tool) => (
                      <motion.div
                        key={tool.key}
                        whileHover={{ scale: 1.04, y: -4 }}
                        transition={{ duration: 0.25 }}
                        onClick={() => {
                          selectHeroTool(tool.key);
                          setDetailToolKey(tool.key);
                        }}
                        className={`relative flex-none w-72 h-[162px] md:w-80 md:h-[180px] lg:w-[340px] lg:h-[191px] xl:w-[420px] xl:h-[236px] 2xl:w-[500px] 2xl:h-[281px] rounded-xl overflow-hidden border border-white/10 bg-[#16161c] cursor-pointer shadow-xl transition-all duration-300 ${
                          tool.premium?.accentGlow || 'hover:border-red-500'
                        }`}
                      >
                        {tool.premium ? (
                          <img
                            src={tool.premium.coverImage}
                            alt={getToolTitle(tool)}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-indigo-900 to-slate-900 flex items-center justify-center">
                            <span className="font-bold text-sm">{getToolTitle(tool)}</span>
                          </div>
                        )}
                        {/* Overlay Gradiente */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-end p-4" />
                        
                        {/* Tag Ativa */}
                        <span className="absolute top-3 left-3 bg-emerald-500 text-white text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow-md flex items-center gap-1">
                          <Check size={10} strokeWidth={3} />
                          Ativa
                        </span>

                        <div className="absolute bottom-3 left-3 right-3">
                          <h4 className="text-sm font-extrabold text-white leading-tight drop-shadow-md">
                            {getToolTitle(tool)}
                          </h4>
                          <p className="text-[10px] text-slate-300 mt-0.5 line-clamp-1">
                            {tool.resumo}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Row 2: Available Tools */}
              {availableTools.length > 0 && (
                <div className="relative group/row">
                  <h3 className="text-lg md:text-xl xl:text-2xl 2xl:text-3xl font-black tracking-tight text-white mb-4 flex flex-wrap items-center gap-2">
                    <span className="h-5 w-1 bg-red-600 rounded-full" />
                    Novidades disponíveis para contratar
                    <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                      {availableTools.length} {availableTools.length === 1 ? 'opção' : 'opções'}
                    </span>
                  </h3>

                  {/* Left scroll control */}
                  <button
                    onClick={() => handleScroll(availableRowRef, 'left')}
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-30 h-[80%] w-10 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover/row:opacity-100 transition duration-300 border-r border-white/5 backdrop-blur-sm rounded-r-xl"
                  >
                    <ChevronLeft size={28} />
                  </button>

                  {/* Right scroll control */}
                  <button
                    onClick={() => handleScroll(availableRowRef, 'right')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-30 h-[80%] w-10 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover/row:opacity-100 transition duration-300 border-l border-white/5 backdrop-blur-sm rounded-l-xl"
                  >
                    <ChevronRight size={28} />
                  </button>

                  {/* Card Container */}
                  <div
                    ref={availableRowRef}
                    className="flex gap-4 overflow-x-auto py-2 scroll-smooth scrollbar-none [scrollbar-width:none]"
                  >
                    {availableTools.map((tool) => (
                      <motion.div
                        key={tool.key}
                        whileHover={{ scale: 1.04, y: -4 }}
                        transition={{ duration: 0.25 }}
                        onClick={() => {
                          selectHeroTool(tool.key);
                          setDetailToolKey(tool.key);
                        }}
                        className={`relative flex-none w-72 h-[162px] md:w-80 md:h-[180px] lg:w-[340px] lg:h-[191px] xl:w-[420px] xl:h-[236px] 2xl:w-[500px] 2xl:h-[281px] rounded-xl overflow-hidden border border-white/10 bg-[#16161c] cursor-pointer shadow-xl transition-all duration-300 ${
                          tool.premium?.accentGlow || 'hover:border-red-500'
                        }`}
                      >
                        {tool.premium ? (
                          <img
                            src={tool.premium.coverImage}
                            alt={getToolTitle(tool)}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-red-950 to-slate-900 flex items-center justify-center">
                            <span className="font-bold text-sm">{getToolTitle(tool)}</span>
                          </div>
                        )}
                        {/* Overlay Gradiente */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent flex flex-col justify-end p-4" />
                        
                        {/* Tag Preço/Status */}
                        <span className="absolute top-3 left-3 bg-red-600 text-white text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow-md">
                          Disponível
                        </span>

                        <div className="absolute bottom-3 left-3 right-3">
                          <h4 className="text-sm font-extrabold text-white leading-tight drop-shadow-md">
                            {getToolTitle(tool)}
                          </h4>
                          <p className="text-[10px] text-slate-300 mt-0.5 line-clamp-1">
                            {tool.resumo}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              <motion.section
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.18 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="relative overflow-hidden border-y border-white/10 bg-[radial-gradient(circle_at_20%_10%,rgba(239,68,68,0.16),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))] px-4 py-12 md:px-8 md:py-16 xl:px-12 xl:py-20"
              >
                <div className="absolute left-0 top-8 h-px w-1/2 bg-gradient-to-r from-red-600 via-white/30 to-transparent tool-pulse-line" />
                <div className="mx-auto max-w-7xl">
                  <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
                    <div className="space-y-7">
                      <div className="space-y-4">
                        <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-red-200">
                          <Sparkles size={14} className="text-red-400" />
                          Ferramentas que mudam a rotina
                        </span>
                        <h3 className="max-w-2xl text-3xl font-black leading-[1.02] tracking-tight text-white md:text-5xl xl:text-6xl">
                          Quando a corretora opera com apoio certo, venda deixa de depender de improviso.
                        </h3>
                        <p className="max-w-xl text-sm font-semibold leading-relaxed text-slate-300 md:text-base xl:text-lg">
                          As ferramentas entram nos pontos que mais drenam energia: primeiro atendimento, prova de autoridade, organizacao comercial e velocidade de resposta. O resultado e uma operacao mais leve, mais clara e mais pronta para crescer.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        {IMPACT_METRICS.map((metric, index) => {
                          const Icon = metric.icon;
                          return (
                            <motion.div
                              key={metric.label}
                              initial={{ opacity: 0, y: 22 }}
                              whileInView={{ opacity: 1, y: 0 }}
                              viewport={{ once: true, amount: 0.35 }}
                              transition={{ delay: index * 0.08, duration: 0.42 }}
                              className="rounded-xl border border-white/10 bg-black/28 p-4 shadow-xl shadow-black/20 backdrop-blur"
                            >
                              <Icon size={18} className="mb-4 text-red-400" />
                              <p className="text-2xl font-black tracking-tight text-white">{metric.value}</p>
                              <p className="mt-1 text-xs font-black uppercase tracking-wider text-slate-400">{metric.label}</p>
                              <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-300">{metric.description}</p>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                      {MOTIVATION_CARDS.map((card, index) => {
                        const Icon = card.icon;
                        return (
                          <motion.div
                            key={card.title}
                            initial={{ opacity: 0, y: 28 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            whileHover={{ y: -6, scale: 1.015 }}
                            viewport={{ once: true, amount: 0.3 }}
                            transition={{ delay: index * 0.08, duration: 0.42 }}
                            className={`relative min-h-[220px] overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${card.glow} p-5 shadow-2xl shadow-black/30`}
                          >
                            <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
                            <div className="relative flex h-full flex-col justify-between gap-8">
                              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white">
                                <Icon size={22} />
                              </span>
                              <div>
                                <h4 className="text-lg font-black leading-tight text-white">{card.title}</h4>
                                <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-300">{card.description}</p>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.section>

              <motion.section
                initial={{ opacity: 0, y: 34 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch"
              >
                <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0d0d12] p-5 shadow-2xl shadow-black/40 md:p-7">
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-cyan-400 to-red-500" />
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
                      <MessageCircle size={24} />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-widest text-emerald-300">Feedback real</p>
                      <h3 className="text-2xl font-black text-white md:text-3xl">A IA ajudando dentro do CRM</h3>
                    </div>
                  </div>

                  <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/35 shadow-xl tool-float">
                    <img
                      src="/ferramentas/danilo-feedback.png"
                      alt="Feedback do Danilo Iacovone sobre a IA de atendimento"
                      className="h-auto w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </div>

                <div className="grid gap-4">
                  {[
                    'A ferramenta aparece no momento em que o corretor precisa agir, sem depender de memoria ou planilha solta.',
                    'O atendimento ganha continuidade: o lead conversa, a IA organiza contexto e o CRM vira uma central de decisao.',
                    'Feedback assim mostra o ponto principal: quando a tecnologia fica simples, o time adota e a operacao anda.'
                  ].map((quote, index) => (
                    <motion.div
                      key={quote}
                      initial={{ opacity: 0, x: 28 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, amount: 0.4 }}
                      transition={{ delay: index * 0.08, duration: 0.42 }}
                      className="rounded-xl border border-white/10 bg-white/[0.035] p-5 shadow-xl shadow-black/20"
                    >
                      <p className="text-sm font-semibold leading-relaxed text-slate-300 md:text-base">{quote}</p>
                    </motion.div>
                  ))}
                </div>
              </motion.section>

              <motion.section
                initial={{ opacity: 0, scale: 0.98 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.5 }}
                className="relative overflow-hidden rounded-xl border border-red-500/25 bg-[linear-gradient(135deg,rgba(185,28,28,0.34),rgba(15,23,42,0.28)_45%,rgba(6,182,212,0.12))] p-6 shadow-2xl shadow-red-950/25 md:p-9 xl:p-12"
              >
                <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-red-500/20 blur-3xl" />
                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-[11px] font-black uppercase tracking-widest text-red-200">Proximo nivel da operacao</p>
                    <h3 className="mt-3 text-3xl font-black leading-tight text-white md:text-5xl">
                      Gostou de alguma ferramenta e quer subir o nivel da sua operacao?
                    </h3>
                    <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-200 md:text-base">
                      Clique no botao e ative ainda hoje. A equipe recebe sua solicitacao e te orienta no melhor caminho para colocar a ferramenta em producao.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const toolToActivate = availableTools[0] || selectedHeroTool || tools[0];
                      if (toolToActivate) {
                        selectHeroTool(toolToActivate.key);
                        setDetailToolKey(toolToActivate.key);
                      }
                    }}
                    className="inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-black text-black shadow-2xl shadow-black/25 transition hover:bg-slate-100 md:text-base"
                  >
                    Ativar ainda hoje
                    <ArrowUpRight size={19} />
                  </button>
                </div>
              </motion.section>

            </div>

            {/* EXPANDED DETAIL MODAL - Netflix Style */}
            <AnimatePresence>
              {selectedDetailTool && selectedDetailTool.premium && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-6 overflow-y-auto"
                >
                  <motion.div
                    initial={{ scale: 0.9, y: 50, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    exit={{ scale: 0.9, y: 50, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                    className="relative bg-[#18181b] rounded-2xl w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl overflow-hidden shadow-2xl border border-white/10 my-8"
                  >
                    
                    {/* Header Image Cover */}
                    <div className="relative w-full h-[280px] md:h-[400px] lg:h-[500px] xl:h-[580px] overflow-hidden">
                      <img
                        src={selectedDetailTool.premium.coverImage}
                        alt={getToolTitle(selectedDetailTool)}
                        className="w-full h-full object-cover object-center"
                      />
                      {/* Close Button */}
                      <button
                        onClick={() => {
                          setDetailToolKey(null);
                          setConsultationSuccess(null);
                          setConsultationError(null);
                        }}
                        className="absolute right-4 top-4 z-40 bg-black/50 hover:bg-black/80 text-white rounded-full p-2.5 transition duration-300 border border-white/10"
                      >
                        <X size={20} />
                      </button>

                      {/* Overlays on Header */}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#18181b] via-[#18181b]/30 to-transparent" />
                      
                      <div className="absolute bottom-6 left-6 md:left-12 z-20">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-red-600 text-white text-[9px] lg:text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded">
                            {selectedDetailTool.premium.categoria}
                          </span>
                        </div>
                        <h3 className="text-3xl md:text-5xl lg:text-6xl xl:text-7xl font-black tracking-tighter text-white drop-shadow-md">
                          {getToolTitle(selectedDetailTool)}
                        </h3>
                      </div>
                    </div>

                    {/* Modal Main Content Container */}
                    <div className="p-6 md:p-12">
                      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 md:gap-12">
                        
                        {/* Left Column: Pitch & Mechanics */}
                        <div className="space-y-6">
                          <div>
                            <h4 className="text-[11px] lg:text-xs font-black uppercase tracking-widest text-red-500 mb-2">Sobre a ferramenta</h4>
                            <p className="text-sm md:text-base lg:text-lg xl:text-xl font-medium leading-relaxed text-slate-300">
                              {selectedDetailTool.premium.pitch}
                            </p>
                          </div>

                          <div className="border-t border-white/10 pt-4">
                            <h4 className="text-sm lg:text-base font-bold text-white mb-3 flex items-center gap-1.5">
                              <Calendar size={16} className="text-red-500 lg:w-5 lg:h-5" />
                              Como funciona o processo
                            </h4>
                            <ol className="space-y-2.5 text-xs lg:text-sm xl:text-base text-slate-400 font-semibold list-decimal pl-4">
                              {selectedDetailTool.premium.funcionamento.map((item, idx) => (
                                <li key={idx} className="pl-1">
                                  {item}
                                </li>
                              ))}
                            </ol>
                          </div>

                          <div className="border-t border-white/10 pt-4">
                            <h4 className="text-sm lg:text-base font-bold text-white mb-3 flex items-center gap-1.5">
                              <TrendingUp size={16} className="text-red-500 lg:w-5 lg:h-5" />
                              Principais benefícios
                            </h4>
                            <ul className="space-y-2 text-xs lg:text-sm xl:text-base text-slate-400 font-semibold list-disc pl-4">
                              {selectedDetailTool.premium.beneficios.map((item, idx) => (
                                <li key={idx} className="pl-1">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>

                        </div>

                        {/* Right Column: Active Check / Action Box */}
                        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 lg:p-8 xl:p-10 flex flex-col justify-between h-fit self-start gap-6 lg:gap-8">
                          
                          <div>
                            <h4 className="text-xs lg:text-sm font-black uppercase tracking-widest text-slate-400 mb-4">
                              O que está incluso
                            </h4>
                            <div className="space-y-3">
                              {selectedDetailTool.premium.entregas.map((entrega) => (
                                <div key={entrega} className="flex items-start gap-3">
                                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <Check size={12} className="lg:w-4 lg:h-4 xl:w-5 xl:h-5" strokeWidth={3} />
                                  </span>
                                  <span className="text-xs lg:text-sm xl:text-base font-bold text-slate-300 leading-tight">
                                    {entrega}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="border-t border-white/5 pt-6 space-y-4">
                            {selectedDetailTool.status === 'ativo' ? (
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                                  <CheckCircle2 size={18} />
                                  <span className="text-xs font-black uppercase tracking-wider">Ferramenta ativa</span>
                                </div>
                                <p className="text-[11px] font-semibold text-slate-400 leading-relaxed text-center">
                                  Esta ferramenta já se encontra em pleno funcionamento e integrada ao seu número ou conta.
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                {consultationSuccess ? (
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center"
                                  >
                                    <CheckCircle2 className="mx-auto text-emerald-400 mb-2 animate-bounce" size={24} />
                                    <p className="text-xs font-black text-emerald-300 leading-normal">
                                      {consultationSuccess}
                                    </p>
                                  </motion.div>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={submittingConsultation}
                                      onClick={() => handleConsultAvailability(selectedDetailTool)}
                                      className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:bg-red-700/50 text-white font-extrabold text-sm py-3 px-5 rounded-xl shadow-lg shadow-red-950/40 hover:shadow-red-600/20 hover:scale-[1.01] transition-all duration-300 cursor-pointer"
                                    >
                                      {submittingConsultation ? (
                                        <>
                                          <Loader2 className="animate-spin" size={16} />
                                          Enviando solicitação...
                                        </>
                                      ) : (
                                        <>
                                          Consultar disponibilidade
                                        </>
                                      )}
                                    </button>

                                    {consultationError && (
                                      <p className="text-xs font-bold text-red-400 text-center">
                                        {consultationError}
                                      </p>
                                    )}

                                    <p className="text-[11px] font-semibold text-slate-400 leading-relaxed text-center">
                                      Ao consultar disponibilidade, um chamado de ativação será enviado automaticamente para a administração.
                                    </p>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                        </div>

                      </div>
                    </div>

                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </main>
    </InternalLayout>
  );
}
