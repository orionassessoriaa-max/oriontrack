'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Sparkles,
  Compass,
  Copy,
  Bot,
  ArrowRight,
  RefreshCw,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ApoloAiWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'gps' | 'copy'>('gps');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mensagens iniciais de boas-vindas dependendo do modo
  const getInitialMessage = (currentMode: 'gps' | 'copy') => {
    if (currentMode === 'gps') {
      return {
        role: 'assistant' as const,
        content: `Olá, corretor parceiro! Eu sou o **Apolo**, seu guia inteligente de navegação no Orion Track. 🧭\n\nPosso te mostrar onde fica qualquer funcionalidade da plataforma. Pergunte-me coisas como: "Onde vejo minhas notificações?", "Como faço uma simulação?", ou "Como mudo o tema do sistema?".\n\n*Que tenhamos um ótimo expediente com excelentes vendas hoje! 🚀*`
      };
    } else {
      return {
        role: 'assistant' as const,
        content: `Olá! Sou o **Apolo**, seu assistente especialista em Copys Comerciais e Vendas de Alta Conversão. ✍️💼\n\nEstou aqui para criar abordagens persuasivas para WhatsApp ou te ajudar a quebrar objeções de fechamento (Preço, Coparticipação, etc.).\n\nQual é a objeção ou proposta que precisamos destravar hoje?`
      };
    }
  };

  // Reiniciar mensagens ao trocar de modo
  useEffect(() => {
    setMessages([getInitialMessage(mode)]);
  }, [mode]);

  // Rolar para a última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

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
          mode
        }),
      });

      if (!response.ok) {
        throw new Error('Falha ao obter resposta do Apolo.');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (error) {
      console.error('Erro ao conversar com Apolo:', error);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Ops! Ocorreu um erro ao me conectar com meus servidores. Certifique-se de que a chave de API da OpenAI está configurada corretamente nas variáveis de ambiente!' }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const quickPromptsGPS = [
    { label: 'Onde vejo as notificações?', text: 'Onde vejo minhas notificações e avisos de tabelas?' },
    { label: 'Como simular plano?', text: 'Como posso fazer uma simulação de plano de saúde?' },
    { label: 'Onde altero meu tema?', text: 'Como mudo o tema visual para modo escuro ou claro?' },
    { label: 'Configurar minha página', text: 'Onde configuro minha página de captação de leads?' }
  ];

  const quickPromptsCopy = [
    { label: 'Contornar preço caro', text: 'Me ajude a criar uma copy de WhatsApp para o cliente que achou o plano de saúde caro.' },
    { label: 'Explicar coparticipação', text: 'Como posso contornar a objeção de coparticipação do cliente de forma inteligente?' },
    { label: 'WhatsApp de boas-vindas', text: 'Escreva uma mensagem de boas-vindas para mandar no WhatsApp de um lead recém-chegado.' },
    { label: 'Pressão de Fechamento', text: 'Me dê uma copy para mandar para o cliente que disse que vai falar com o cônjuge e sumiu.' }
  ];

  return (
    <div className="fixed bottom-6 right-6 z-[9999] font-sans">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            className="mb-4 flex h-[620px] w-[380px] flex-col overflow-hidden rounded-[2.5rem] border border-blue-500/20 bg-slate-900/95 shadow-[0_20px_50px_rgba(59,130,246,0.3)] backdrop-blur-xl sm:w-[420px]"
          >
            {/* Cabeçalho Premium */}
            <div className="relative bg-gradient-to-r from-blue-600 to-indigo-700 p-5 text-white">
              {/* Brilho de fundo */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent)] pointer-events-none" />
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 border border-white/10 shadow-inner">
                    <Sparkles className="h-5 w-5 text-cyan-300 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-black tracking-wide flex items-center gap-1.5">
                      <span>Apolo AI</span>
                      <span className="rounded-full bg-cyan-400/20 border border-cyan-400/30 px-2 py-0.5 text-[9px] font-black text-cyan-300 uppercase tracking-widest">
                        Co-Piloto
                      </span>
                    </h3>
                    <p className="text-[10px] font-bold text-blue-200">
                      Parceiro Inteligente do Corretor
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-xl bg-white/5 border border-white/5 p-2 text-blue-100 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Seletor de Modo */}
              <div className="mt-4 flex bg-black/20 p-1 rounded-2xl border border-white/5">
                <button
                  onClick={() => setMode('gps')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-2xs font-black uppercase tracking-wider transition-all duration-200 ${
                    mode === 'gps'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-blue-200 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Compass size={12} />
                  <span>Apolo GPS</span>
                </button>
                <button
                  onClick={() => setMode('copy')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-2xs font-black uppercase tracking-wider transition-all duration-200 ${
                    mode === 'copy'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-blue-200 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Copy size={12} />
                  <span>Apolo Copywriter</span>
                </button>
              </div>
            </div>

            {/* Histórico de Mensagens */}
            <div className="flex-1 overflow-y-auto bg-slate-950/40 p-5 space-y-4 scrollbar-thin">
              {messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-2.5 ${isAssistant ? '' : 'flex-row-reverse'}`}
                  >
                    {isAssistant ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/20 text-cyan-400 shadow-md">
                        <Bot size={15} />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white text-xs font-black shadow-md">
                        C
                      </div>
                    )}

                    <div
                      className={`max-w-[80%] rounded-[1.5rem] px-4 py-3 text-xs font-medium leading-relaxed ${
                        isAssistant
                          ? 'bg-slate-900 border border-white/5 text-slate-200'
                          : 'bg-blue-600 text-white rounded-tr-none'
                      }`}
                    >
                      {/* Renderizador de Markdown básico para negritos e quebras de linha */}
                      {msg.content.split('\n').map((line, lIdx) => {
                        // Regex simples para converter **texto** em negrito
                        const boldRegex = /\*\*(.*?)\*\*/g;
                        const parts = line.split(boldRegex);
                        return (
                          <p key={lIdx} className={lIdx > 0 ? 'mt-2' : ''}>
                            {parts.map((part, pIdx) => {
                              if (pIdx % 2 === 1) {
                                return <strong key={pIdx} className="font-black text-cyan-300">{part}</strong>;
                              }
                              return part;
                            })}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Indicador de Carregamento */}
              {isLoading && (
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/20 text-cyan-400">
                    <Bot size={15} />
                  </div>
                  <div className="bg-slate-900 border border-white/5 text-slate-400 rounded-[1.5rem] px-4 py-3.5 text-xs font-bold flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce" />
                    <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    <span className="ml-1 text-3xs font-extrabold uppercase tracking-widest text-slate-500">Apolo está formulando...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Prompts Rápidos de Apoio */}
            <div className="px-4 py-2 bg-slate-950/20 border-t border-white/5">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                Sugestões Rápidas:
              </span>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {(mode === 'gps' ? quickPromptsGPS : quickPromptsCopy).map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickPrompt(chip.text)}
                    className="shrink-0 bg-white/2 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/30 px-3 py-1 rounded-xl text-3xs font-extrabold text-slate-400 hover:text-cyan-300 transition-all cursor-pointer"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input e Envio */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(inputValue);
              }}
              className="p-4 bg-slate-900 border-t border-white/5 flex gap-2 items-center"
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={mode === 'gps' ? 'Pergunte onde fica algo...' : 'Peça uma objeção ou copy...'}
                className="flex-1 bg-white/5 border border-white/5 rounded-2xl px-4 py-3 text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer shadow-md shadow-blue-600/20"
              >
                <Send size={14} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Botão de Trigger Principal Flutuante */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-[0_10px_30px_rgba(59,130,246,0.5)] border border-blue-400/20 cursor-pointer relative"
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <X size={20} />
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="relative"
            >
              <Sparkles size={20} className="animate-pulse text-cyan-300" />
              {/* Notificação sutil pulando */}
              <span className="absolute -top-2 -right-2 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
