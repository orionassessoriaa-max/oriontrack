'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  ArrowLeft,
  Bot,
  RefreshCw,
  Cpu,
  ShieldCheck,
  Compass,
  MessageSquare,
  Sparkles,
  User
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/components/providers/AuthProvider';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Sub-componente Typewriter de alta velocidade para o Apolo One
function Typewriter({ text, speed = 15, onComplete }: { text: string; speed?: number; onComplete?: () => void }) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let index = 0;
    setDisplayedText('');

    const interval = setInterval(() => {
      if (index < text.length) {
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
    <div className="space-y-2">
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

// Visualizador do Core Canvas do Apolo One (Esfera Brilhante HSL e Órbitas Premium)
function ApoloOneVisualizer({ isThinking }: { isThinking: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hue, setHue] = useState(200); // Começa no ciano/azul

  // Troca de cores suave no gradiente
  useEffect(() => {
    const interval = setInterval(() => {
      setHue(prev => (prev + 1) % 360);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = 300);
    let height = (canvas.height = 140);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const pulseRadius = 24 + Math.sin(Date.now() / (isThinking ? 120 : 250)) * 4;

      // 1. Glow holográfico externo amplo e brilhante (Deep Glow)
      const glowGrad = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, pulseRadius * 2.8);
      const activeColor = `hsla(${hue}, 90%, 55%, ${isThinking ? 0.45 : 0.3})`;
      const activeColorOuter = `hsla(${(hue + 30) % 360}, 90%, 50%, 0.05)`;
      
      glowGrad.addColorStop(0, activeColor);
      glowGrad.addColorStop(0.5, activeColorOuter);
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius * 2.8, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();

      // 2. Órbitas cibernéticas finas girando (Concentric Rings)
      const time = Date.now() / 1500;
      
      // Órbita 1 (Externa)
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius * 1.8, time, time + Math.PI * 1.5);
      ctx.strokeStyle = `hsla(${hue}, 80%, 65%, 0.25)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Órbita 2 (Média, sentido oposto)
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius * 1.4, -time * 1.3, -time * 1.3 + Math.PI);
      ctx.strokeStyle = `hsla(${(hue + 120) % 360}, 85%, 60%, 0.2)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // 3. Esfera central sólida com gradiente HSL de alta fidelidade
      const coreGrad = ctx.createLinearGradient(centerX - pulseRadius, centerY - pulseRadius, centerX + pulseRadius, centerY + pulseRadius);
      coreGrad.addColorStop(0, `hsl(${hue}, 90%, 65%)`);
      coreGrad.addColorStop(1, `hsl(${(hue + 60) % 360}, 95%, 50%)`);

      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = coreGrad;
      ctx.shadowBlur = isThinking ? 35 : 20;
      ctx.shadowColor = `hsl(${hue}, 95%, 55%)`;
      ctx.fill();
      ctx.shadowBlur = 0; // Reseta sombra para não afetar os outros desenhos

      // 4. Detalhes internos da esfera (Core Pattern)
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius - 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius - 9, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${isThinking ? 0.35 : 0.15})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isThinking, hue]);

  return (
    <div className="relative flex justify-center items-center h-36">
      <canvas ref={canvasRef} className="w-[300px] h-[140px] block pointer-events-none" />
      <span className="absolute bottom-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400/60 animate-pulse">
        Matriz Apolo Conectada
      </span>
    </div>
  );
}

export default function ApoloOnePage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [typingComplete, setTypingComplete] = useState(false);
  const [hasOnboardedNickname, setHasOnboardedNickname] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mensagens padrão
  const getWelcomeMessage = (nickname?: string): Message => {
    if (nickname) {
      return {
        role: 'assistant',
        content: `Olá, **${nickname}**! Tudo bem? Em que posso te servir hoje?\n\nEu sou o **Apolo One**, sua Inteligência Artificial central e co-piloto supremo. Possuo conhecimento absoluto de toda a infraestrutura da plataforma Orion Track e estou pronto para te guiar nas configurações do sistema ou orientar seu fluxo de fechamento comercial!`
      };
    }
    return {
      role: 'assistant',
      content: `Olá, corretor parceiro! Tudo bem?\n\nIdentifiquei que este é o seu primeiro acesso ao **Apolo One**. Como você gostaria de ser chamado durante as nossas conversas? Por favor, digite o nome ou apelido que você prefere.`
    };
  };

  // Inicializa o chat no carregamento do Perfil
  useEffect(() => {
    if (!profile?.id) return;

    const storedNickname = localStorage.getItem(`orion:apolo_nickname_${profile.id}`);
    if (storedNickname) {
      setHasOnboardedNickname(true);
      setMessages([getWelcomeMessage(storedNickname)]);
    } else {
      setHasOnboardedNickname(false);
      setMessages([getWelcomeMessage()]);
    }
    setTypingComplete(false);
  }, [profile?.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, typingComplete]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    setTypingComplete(true); // Conclui digitação imediata ao interagir

    // Fluxo de Onboarding do Apelido
    if (hasOnboardedNickname === false && profile?.id) {
      const chosenName = text.trim();
      localStorage.setItem(`orion:apolo_nickname_${profile.id}`, chosenName);
      setHasOnboardedNickname(true);

      const userMsg: Message = { role: 'user', content: chosenName };
      const systemReply: Message = {
        role: 'assistant',
        content: `Muito prazer, **${chosenName}**! Seu nome foi registrado com sucesso em minhas sinapses centrais.\n\nEu sou o **Apolo One**, seu co-piloto supremo. Como posso te ajudar hoje? Você pode me perguntar sobre configurações, rotas da plataforma, segurança de dados ou solicitar copys comerciais de alta conversão para fechar novos negócios!`
      };

      setMessages(prev => [...prev, userMsg, systemReply]);
      setInputValue('');
      setTypingComplete(false);
      return;
    }

    const userMessage: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const storedNickname = profile?.id ? localStorage.getItem(`orion:apolo_nickname_${profile.id}`) : '';

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
          mode: 'apolo-one',
          nickname: storedNickname || ''
        }),
      });

      if (!response.ok) {
        throw new Error('Falha ao se conectar à matriz central do Apolo One.');
      }

      const data = await response.json();
      setTypingComplete(false);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err: any) {
      console.error('Erro Apolo One:', err);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Lamento, parceiro. Tive uma flutuação nas minhas sinapses neuronais. Poderia tentar enviar a mensagem novamente? Se o erro persistir, recomendo abrir um chamado de suporte.` }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    const storedNickname = profile?.id ? localStorage.getItem(`orion:apolo_nickname_${profile.id}`) : null;
    if (storedNickname) {
      setHasOnboardedNickname(true);
      setMessages([getWelcomeMessage(storedNickname)]);
    } else {
      setHasOnboardedNickname(false);
      setMessages([getWelcomeMessage()]);
    }
    setTypingComplete(false);
    setInputValue('');
  };

  const handleQuickPrompt = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const quickPrompts = [
    {
      icon: ShieldCheck,
      title: 'Segurança',
      desc: 'O site da Orion Track é realmente seguro?',
      text: 'Quero saber sobre as diretrizes de segurança da informação e criptografia do Orion Track.'
    },
    {
      icon: Compass,
      title: 'Menu e Rotas',
      desc: 'Onde vejo minhas notificações?',
      text: 'Onde ficam as minhas notificações, as tabelas de reajustes e os avisos de tráfego?'
    },
    {
      icon: MessageSquare,
      title: 'Objeções de Preço',
      desc: 'O cliente achou o plano caro.',
      text: 'Me passe uma copy para WhatsApp para rebater o cliente que achou o plano caro.'
    },
    {
      icon: Sparkles,
      title: 'Multicálculo',
      desc: 'Como fazer novos cálculos de plano?',
      text: 'Como faço um novo cálculo de planos de saúde no multicálculo?'
    }
  ];

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30">
      {/* Holographic scanner glows */}
      <div className="absolute inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.06),transparent_70%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-20" />

      {/* Cabeçalho Fixo Premium */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#030712]/70 backdrop-blur-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/ajuda')}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/2 hover:bg-white/5 border border-white/5 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Voltar à Central de Ajuda"
          >
            <ArrowLeft size={16} />
          </button>
          
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-inner">
              <Cpu size={18} />
            </div>
            <div>
              <h1 className="text-sm font-black flex items-center gap-2">
                <span>Apolo One</span>
                <span className="rounded-full bg-gradient-to-r from-cyan-400/25 to-blue-500/25 border border-cyan-400/20 px-2 py-0.5 text-[8px] font-black text-cyan-300 uppercase tracking-widest animate-pulse">
                  Apolo Core
                </span>
              </h1>
              <p className="text-[10px] font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                Matriz de sinapses ativas
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleClearChat}
          className="flex items-center gap-1.5 rounded-xl border border-white/5 bg-white/2 px-4 py-2 text-2xs font-extrabold uppercase tracking-wider text-slate-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer shadow-md"
          title="Reiniciar chat"
        >
          <RefreshCw size={12} /> Reiniciar
        </button>
      </header>

      {/* Área Central de Conversa (ChatGPT Style) */}
      <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center">
        <div className="max-w-3xl w-full flex flex-col space-y-8 flex-1 justify-between">
          
          {/* Timeline de mensagens */}
          <div className="space-y-6 flex-1">
            {/* Animação do Apolo One em Destaque no Topo */}
            <ApoloOneVisualizer isThinking={isLoading} />

            {messages.map((msg, index) => {
              const isAssistant = msg.role === 'assistant';

              return (
                <div
                  key={index}
                  className={`flex w-full ${isAssistant ? 'justify-start' : 'justify-end'} animate-fade-in`}
                >
                  <div
                    className={`max-w-[80%] rounded-[1.5rem] px-5 py-4 text-sm leading-relaxed shadow-sm transition-all duration-300 ${
                      isAssistant
                        ? 'bg-slate-900/40 border border-white/5 text-slate-200 rounded-tl-none'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-none shadow-blue-600/10'
                    }`}
                  >
                    {isAssistant && index === messages.length - 1 && !typingComplete ? (
                      <Typewriter
                        text={msg.content}
                        onComplete={() => setTypingComplete(true)}
                      />
                    ) : (
                      // Renderizador de Markdown estático
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

            {/* Grid 2x2 de Sugestões de Onboarding (Apenas no início do chat) */}
            {typingComplete && messages.length <= 1 && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mt-8 space-y-4 pt-4 border-t border-white/5"
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block text-center sm:text-left">
                  Como posso servir sua operação hoje?
                </span>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {quickPrompts.map((item, idx) => {
                    const IconComp = item.icon;
                    return (
                      <button
                        key={idx}
                        onClick={() => handleQuickPrompt(item.text)}
                        className="flex flex-col items-start text-left p-4.5 rounded-2xl bg-white/2 hover:bg-cyan-500/5 border border-white/5 hover:border-cyan-500/25 transition-all duration-300 group cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 mb-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-white transition-all shadow-inner">
                            <IconComp size={15} />
                          </div>
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-300 group-hover:text-cyan-300 transition-colors">
                            {item.title}
                          </span>
                        </div>
                        <p className="text-xs font-bold leading-normal text-slate-400 group-hover:text-slate-200 transition-colors">
                          {item.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Indicador de carregamento */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-900/40 border border-white/5 text-slate-400 rounded-[1.5rem] rounded-tl-none px-5 py-4 text-sm font-bold flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce" />
                  <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Apolo One está formulando...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

        </div>
      </div>

      {/* Input de Mensagem estilo ChatGPT */}
      <footer className="w-full bg-gradient-to-t from-[#030712] via-[#030712] to-transparent pt-6 pb-8 px-6 flex justify-center">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputValue);
          }}
          className="max-w-3xl w-full flex gap-3.5 items-center relative"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Digite sua dúvida ou solicite um suporte ao Apolo One..."
            className="flex-1 bg-slate-900/50 border border-white/10 rounded-2xl px-5 py-4.5 text-sm font-bold text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/25 transition-all shadow-inner"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-lg shadow-blue-600/10"
          >
            <Send size={16} />
          </button>
        </form>
      </footer>
    </div>
  );
}
