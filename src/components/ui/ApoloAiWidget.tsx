'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  X,
  Send,
  Sparkles,
  Compass,
  Copy,
  Bot,
  RefreshCw,
  TrendingUp,
  Palette,
  Users,
  Settings,
  ShieldCheck,
  Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type ApoloNotification = {
  id: string;
  titulo: string;
  mensagem: string;
  destinatario_profile_id: string | null;
  destinatario_tipo: string | null;
  lida: boolean;
  created_at: string;
};

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface TypewriterProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
}

// Sub-componente interno para efeito de máquina de escrever com suporte a Markdown sutil (negrito)
function Typewriter({ text, speed = 10, onComplete }: TypewriterProps) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let index = 0;
    setDisplayedText('');

    const interval = setInterval(() => {
      if (index < text.length) {
        // Digita 3 caracteres por vez para um ritmo fluido e ágil
        const step = Math.min(3, text.length - index);
        setDisplayedText(prev => prev + text.substring(index, index + step));
        index += step;
      } else {
        clearInterval(interval);
        if (onComplete) onComplete();
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <div className="space-y-2 text-xs leading-relaxed text-slate-200">
      {displayedText.split('\n').map((line, lIdx) => {
        const boldRegex = /\*\*(.*?)\*\*/g;
        const parts = line.split(boldRegex);
        return (
          <p key={lIdx} className={lIdx > 0 ? 'mt-2' : ''}>
            {parts.map((part, pIdx) => {
              if (pIdx % 2 === 1) {
                return (
                  <strong key={pIdx} className="font-extrabold text-cyan-400">
                    {part}
                  </strong>
                );
              }
              return part;
            })}
          </p>
        );
      })}
    </div>
  );
}

export default function ApoloAiWidget() {
  const { profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [typingComplete, setTypingComplete] = useState(false);
  const [recentNotifications, setRecentNotifications] = useState<ApoloNotification[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unreadNotifications = recentNotifications.filter((notification) => !notification.lida).length;

  useEffect(() => {
    if (!profile?.id) {
      setRecentNotifications([]);
      return;
    }

    const isForCurrentProfile = (notification: Partial<ApoloNotification>) => (
      profile.tipo_usuario === 'admin'
      || notification.destinatario_profile_id === profile.id
      || notification.destinatario_tipo === profile.tipo_usuario
      || notification.destinatario_tipo === 'todos'
    );

    const loadRecentNotifications = async () => {
      let query = supabase
        .from('notificacoes')
        .select('id,titulo,mensagem,destinatario_profile_id,destinatario_tipo,lida,created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      if (profile.tipo_usuario !== 'admin') {
        query = query.or(`destinatario_profile_id.eq.${profile.id},destinatario_tipo.eq.${profile.tipo_usuario},destinatario_tipo.eq.todos`);
      }

      const { data, error } = await query;
      if (error) {
        console.error('[Apolo] Falha ao carregar notificacoes:', error);
        return;
      }
      setRecentNotifications((data || []) as ApoloNotification[]);
    };

    loadRecentNotifications();

    const channel = supabase
      .channel(`apolo-widget-notificacoes:${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificacoes' }, (payload) => {
        const notification = payload.new as ApoloNotification;
        if (!isForCurrentProfile(notification)) return;
        setRecentNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 5));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notificacoes' }, (payload) => {
        const notification = payload.new as ApoloNotification;
        if (!isForCurrentProfile(notification)) return;
        setRecentNotifications((current) => current.map((item) => item.id === notification.id ? notification : item));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.tipo_usuario]);

  const markNotificationAsRead = async (notification: ApoloNotification) => {
    if (notification.lida) return;
    setRecentNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, lida: true } : item));
    const { error } = await supabase.from('notificacoes').update({ lida: true }).eq('id', notification.id);
    if (error) {
      setRecentNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, lida: false } : item));
    }
  };

  // Determinar a mensagem de boas-vindas dinâmica baseado no cargo do usuário
  const welcomeMessage: Message = useMemo(() => {
    const role = profile?.tipo_usuario || 'corretor';
    let content = `Olá. Sou o **Apolo**, assistente do Orion Track.\n\nPosso ajudar a localizar recursos do sistema, consultar informações do CRM e preparar abordagens para o WhatsApp.\n\nEscolha uma sugestão ou escreva sua dúvida.`;

    if (role === 'gestor_trafego') {
      content = `Olá. Sou o **Apolo**, assistente de tráfego do Orion Track.\n\nPosso ajudar a analisar campanhas, orçamento, criativos e indicadores como CPL.`;
    } else if (role === 'designer') {
      content = `Olá. Sou o **Apolo**, assistente de design do Orion Track.\n\nPosso apoiar a criação de peças, roteiros e direcionamentos visuais.`;
    } else if (role === 'account_manager') {
      content = `Olá. Sou o **Apolo**, assistente de operações do Orion Track.\n\nPosso ajudar com relacionamento, distribuição de leads, retenção e onboarding.`;
    } else if (role === 'admin') {
      content = `Olá. Sou o **Apolo**, assistente administrativo do Orion Track.\n\nPosso ajudar com integrações, status de APIs, auditoria e segurança.`;
    }

    return { role: 'assistant', content };
  }, [profile?.tipo_usuario]);

  // Sugestões rápidas dinâmicas baseadas no cargo do usuário no formato Grid 2x2
  const quickSuggestions = useMemo(() => {
    const role = profile?.tipo_usuario || 'corretor';

    if (role === 'gestor_trafego') {
      return [
        {
          icon: TrendingUp,
          title: 'Campanhas Meta',
          desc: 'Como reduzir o CPL de planos de saúde no Meta Ads?',
          text: 'Quais as melhores estratégias e práticas para reduzir o CPL em campanhas de planos de saúde no Meta Ads?'
        },
        {
          icon: Sparkles,
          title: 'Criativos de Tráfego',
          desc: 'Ideias de criativos que mais convertem na área da saúde.',
          text: 'Pode me dar ideias e conceitos de criativos em imagem e vídeo de alta conversão para o nicho de planos de saúde?'
        },
        {
          icon: Compass,
          title: 'Página de Vendas',
          desc: 'Dicas de headlines e gatilhos para landing pages.',
          text: 'Quais headlines e gatilhos mentais funcionam melhor em landing pages e páginas de vendas voltadas para conversão de leads de planos de saúde?'
        },
        {
          icon: Copy,
          title: 'Teste A/B',
          desc: 'Como estruturar testes eficientes no gerenciador.',
          text: 'Como devo estruturar um teste A/B no gerenciador do Meta Ads para otimizar público e criativos em planos de saúde?'
        }
      ];
    }

    if (role === 'designer') {
      return [
        {
          icon: Palette,
          title: 'Cores de Saúde',
          desc: 'Paletas de cores magnéticas que inspiram confiança.',
          text: 'Sugira paletas de cores premium e modernas para layouts do nicho de planos de saúde que transmitem autoridade e confiança.'
        },
        {
          icon: MessageSquare,
          title: 'Roteiros de Vídeo',
          desc: 'Estrutura de criativos em vídeo para corretores.',
          text: 'Crie um roteiro em vídeo dinâmico de 30 segundos com gancho magnético focado em planos de saúde para um corretor gravar.'
        },
        {
          icon: Compass,
          title: 'Hierarquia Visual',
          desc: 'Boas práticas para estruturar banners comerciais.',
          text: 'Quais as regras fundamentais de hierarquia visual e composição para desenhar um banner comercial de planos de saúde?'
        },
        {
          icon: Sparkles,
          title: 'Estilo Canva',
          desc: 'Como manter um visual premium usando ferramentas online.',
          text: 'Quais técnicas e fontes posso utilizar no Canva para criar posts de redes sociais com aspecto premium e corporativo?'
        }
      ];
    }

    if (role === 'account_manager') {
      return [
        {
          icon: Users,
          title: 'Retenção & CS',
          desc: 'Como aumentar a fidelidade da carteira de clientes.',
          text: 'Quais estratégias práticas de Customer Success posso adotar para reter e encantar clientes ativos de planos de saúde PME?'
        },
        {
          icon: Compass,
          title: 'Equipes & Leads',
          desc: 'Melhores formas de distribuir leads e medir métricas.',
          text: 'Como posso estruturar uma distribuição inteligente e justa de leads e quais métricas chaves de atendimento devo acompanhar?'
        },
        {
          icon: MessageSquare,
          title: 'Pós-Venda Ativo',
          desc: 'Scripts e abordagens após o fechamento do contrato.',
          text: 'Escreva um roteiro simpático de pós-venda para mandar no WhatsApp 30 dias após o fechamento do contrato.'
        },
        {
          icon: Sparkles,
          title: 'Gestão de Crise',
          desc: 'Como lidar com corretores e clientes descontentes.',
          text: 'Como contornar conflitos na distribuição de leads ou reclamações de clientes na carteira de forma assertiva?'
        }
      ];
    }

    if (role === 'admin') {
      return [
        {
          icon: Settings,
          title: 'Logs Evolution',
          desc: 'Como verificar status e eventos da Evolution API.',
          text: 'Como funciona o monitoramento e o fluxo de webhooks/instâncias na Evolution API do Orion Track?'
        },
        {
          icon: ShieldCheck,
          title: 'Segurança Supabase',
          desc: 'Melhores práticas de RLS e integridade de tabelas.',
          text: 'Me dê dicas e boas práticas para garantir a segurança e performance usando Row Level Security (RLS) no Supabase.'
        },
        {
          icon: Compass,
          title: 'Monitoramento de Filas',
          desc: 'Como identificar engargalamentos no processamento.',
          text: 'Como posso auditar atrasos de webhooks e garantir que as mensagens de WhatsApp sejam entregues instantaneamente?'
        },
        {
          icon: Bot,
          title: 'Prompt Engenharia',
          desc: 'Como ajustar regras sistêmicas globais da IA Apolo.',
          text: 'Dicas fundamentais de Prompt Engineering para refinar a precisão das respostas do Apolo nos canais de atendimento.'
        }
      ];
    }

    // Default: Corretor
    return [
      {
        icon: Compass,
        title: 'Guia de Navegação',
        desc: 'Onde vejo minhas notificações e avisos de tabelas?',
        text: 'Onde vejo minhas notificações e avisos de tabelas?'
      },
      {
        icon: Sparkles,
        title: 'Simular Planos',
        desc: 'Como faço uma nova simulação de plano de saúde?',
        text: 'Como posso fazer uma simulação de plano de saúde?'
      },
      {
        icon: MessageSquare,
        title: 'Abordagem WhatsApp',
        desc: 'Escreva uma mensagem comercial de boas-vindas.',
        text: 'Escreva uma mensagem de boas-vindas para mandar no WhatsApp de um lead recém-chegado.'
      },
      {
        icon: Copy,
        title: 'Objeção de Preço',
        desc: 'Copy para o cliente que achou o plano caro.',
        text: 'Me ajude a criar uma copy de WhatsApp para o cliente que achou o plano de saúde caro.'
      }
    ];
  }, [profile?.tipo_usuario]);

  // Inicializar mensagens quando aberto
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([welcomeMessage]);
      setTypingComplete(false);
    }
  }, [isOpen, welcomeMessage]);

  // Rolar para a última mensagem
  useEffect(() => {
    if (isOpen) {
      // Pequeno timeout para garantir render completo após transições ou mudanças
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [messages, isLoading, typingComplete, isOpen]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    // Garantir que a digitação inicial se conclua ao enviar uma mensagem
    setTypingComplete(true);

    const userMessage: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          mode: 'unified',
          tipo_usuario: profile?.tipo_usuario || 'corretor'
        }),
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Falha ao obter resposta do Apolo.');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (error: any) {
      console.error('Erro ao conversar com Apolo:', error);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Ops! Ocorreu um erro ao me conectar com meus servidores. Detalhes: ${error.message || error}` }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const handleClearConversation = () => {
    setMessages([welcomeMessage]);
    setTypingComplete(false);
    setInputValue('');
  };

  return (
    <>
      {/* Gatilho Principal (FAB) - Ocultado quando a sidebar está aberta para evitar sobreposição */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="apolo-trigger"
            initial={{ scale: 0, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: 20 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-[9998] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-[0_10px_35px_rgba(59,130,246,0.45)] border border-blue-400/20 cursor-pointer"
            title="Abrir Apolo AI"
          >
            <div className="relative flex items-center justify-center">
              <img
                src="/orion-empty-logo.png"
                alt="Apolo"
                className="h-7 w-7 object-contain animate-pulse"
              />
              {unreadNotifications > 0 && (
                <span className="absolute -right-3 -top-3 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#070b16] bg-cyan-400 px-1 text-[9px] font-black text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.8)]">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Sidebar Lateral de Altura Completa */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="apolo-sidebar"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed top-0 right-0 z-[9999] flex h-screen w-full flex-col border-l border-white/10 bg-[#070b16]/95 backdrop-blur-2xl shadow-[-15px_0_40px_rgba(0,0,0,0.6)] sm:max-w-[420px]"
          >
            {/* Brilho interno premium */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.06),transparent)] pointer-events-none" />

            {/* Cabeçalho Premium */}
            <div className="relative border-b border-white/5 bg-[#0a0f21]/60 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/20 to-cyan-500/20 border border-blue-500/30 shadow-inner overflow-hidden">
                  <img src="/orion-empty-logo.png" alt="Orion" className="h-5 w-5 object-contain" />
                </div>
                <div>
                  <h3 className="text-sm font-black tracking-wide flex items-center gap-2 text-white">
                    <span>Apolo AI</span>
                    <span className="rounded-full bg-cyan-400/10 border border-cyan-400/20 px-2 py-0.5 text-[8px] font-black text-cyan-300 uppercase tracking-widest">
                      Co-Piloto
                    </span>
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Assistente unificado ativo
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleClearConversation}
                  className="rounded-lg bg-white/2 hover:bg-white/5 border border-white/5 p-2 text-slate-400 hover:text-white transition-all cursor-pointer"
                  title="Reiniciar conversa"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg bg-white/2 hover:bg-white/5 border border-white/5 p-2 text-slate-400 hover:text-white transition-all cursor-pointer"
                  title="Fechar"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <section className="relative border-b border-white/5 bg-[#08101f]/80 px-5 py-3" aria-label="Ultimas notificacoes">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bell size={13} className="text-cyan-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Ultimas notificacoes</span>
                  {unreadNotifications > 0 && (
                    <span className="rounded-full bg-cyan-400/15 px-1.5 py-0.5 text-[9px] font-black text-cyan-300">
                      {unreadNotifications} nova{unreadNotifications === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <Link href="/notificacoes" onClick={() => setIsOpen(false)} className="text-[9px] font-black uppercase tracking-wider text-cyan-400 transition-colors hover:text-cyan-200">
                  Ver todas
                </Link>
              </div>

              <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                {recentNotifications.length === 0 ? (
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-3 text-[10px] font-medium text-slate-500">
                    Nenhuma notificacao recente.
                  </div>
                ) : recentNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => markNotificationAsRead(notification)}
                    className={`group flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${notification.lida ? 'border-white/5 bg-white/[0.02]' : 'border-cyan-400/20 bg-cyan-400/[0.06] hover:bg-cyan-400/[0.1]'}`}
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${notification.lida ? 'bg-slate-700' : 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.85)]'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <strong className="truncate text-[10px] font-extrabold text-slate-200">{notification.titulo || 'Notificacao'}</strong>
                        <time className="shrink-0 text-[8px] font-bold text-slate-600">{formatNotificationTime(notification.created_at)}</time>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[9px] font-medium leading-relaxed text-slate-500 group-hover:text-slate-400">{notification.mensagem}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Histórico de Mensagens */}
            <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6 scrollbar-thin">
              {messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';
                const isFirstMessage = index === 0;

                return (
                  <div
                    key={index}
                    className={`flex items-start gap-3 ${isAssistant ? '' : 'flex-row-reverse'}`}
                  >
                    {isAssistant ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/20 text-cyan-400 shadow-md">
                        <Bot size={15} />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white text-xs font-black shadow-md uppercase">
                        C
                      </div>
                    )}

                    <div
                      className={`max-w-[85%] rounded-[1.5rem] px-4 py-3 text-xs font-medium leading-relaxed shadow-sm ${
                        isAssistant
                          ? 'bg-slate-900/80 border border-white/5 text-slate-200 rounded-tl-none'
                          : 'bg-blue-600 text-white rounded-tr-none shadow-blue-600/15'
                      }`}
                    >
                      {isAssistant && isFirstMessage && !typingComplete ? (
                        <Typewriter
                          text={msg.content}
                          onComplete={() => setTypingComplete(true)}
                        />
                      ) : (
                        // Renderizador de Markdown básico estático
                        msg.content.split('\n').map((line, lIdx) => {
                          const boldRegex = /\*\*(.*?)\*\*/g;
                          const parts = line.split(boldRegex);
                          return (
                            <p key={lIdx} className={lIdx > 0 ? 'mt-2' : ''}>
                              {parts.map((part, pIdx) => {
                                if (pIdx % 2 === 1) {
                                  return (
                                    <strong key={pIdx} className="font-extrabold text-cyan-400">
                                      {part}
                                    </strong>
                                  );
                                }
                                return part;
                              })}
                            </p>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Grid 2x2 de Sugestões Premium (Apenas no início da conversa, após conclusão do typewriter) */}
              {typingComplete && messages.length <= 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  className="mt-6 space-y-3"
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                    Sugestões de Perguntas Rápidas:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {quickSuggestions.map((item, idx) => {
                      const IconComponent = item.icon;
                      return (
                        <button
                          key={idx}
                          onClick={() => handleQuickPrompt(item.text)}
                          className="flex flex-col items-start text-left p-3.5 rounded-2xl bg-white/2 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/20 transition-all duration-300 group cursor-pointer"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/10 border border-blue-500/10 text-cyan-400 group-hover:bg-blue-600 group-hover:text-white transition-all">
                              <IconComponent size={13} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 group-hover:text-cyan-300 transition-colors">
                              {item.title}
                            </span>
                          </div>
                          <p className="text-[10px] font-bold leading-normal text-slate-400 group-hover:text-slate-200 transition-colors">
                            {item.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Indicador de Carregamento */}
              {isLoading && (
                <div className="flex items-start gap-3 animate-fade-in">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/20 text-cyan-400 shadow-md">
                    <Bot size={15} />
                  </div>
                  <div className="bg-slate-900/80 border border-white/5 text-slate-400 rounded-[1.5rem] rounded-tl-none px-4 py-3 text-xs font-bold flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce" />
                    <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    <span className="ml-1 text-[9px] font-black uppercase tracking-widest text-slate-500">Apolo está pensando...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input e Envio Premium */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(inputValue);
              }}
              className="p-4 bg-[#0a0f1d] border-t border-white/10 flex gap-2.5 items-center"
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Pergunte ao Apolo..."
                className="flex-1 bg-white/5 border border-white/5 rounded-2xl px-4 py-3.5 text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-md shadow-blue-600/10"
              >
                <Send size={14} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
