'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types';

// Ponto exato da câmera lenta no vídeo (em segundos)
const PAUSE_TIME = 2.6;

export default function LoginPage() {
  const [view, setView] = useState<'login' | 'recovery'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Estados da transição cinematográfica
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoState, setVideoState] = useState<'playing-intro' | 'paused-form' | 'playing-goal' | 'redirecting'>('playing-intro');
  const [targetRoute, setTargetRoute] = useState<string>('');

  const router = useRouter();

  // Fallback robusto caso o vídeo não inicie ou o autoplay seja bloqueado
  useEffect(() => {
    const timer = setTimeout(() => {
      if (videoState === 'playing-intro') {
        setVideoState('paused-form');
        videoRef.current?.pause();
      }
    }, 4500); // 4.5 segundos limite
    return () => clearTimeout(timer);
  }, [videoState]);

  // Função para executar a retomada do vídeo no sucesso do login
  const handlePlayGoal = (path: string) => {
    setTargetRoute(path);
    setVideoState('playing-goal');
    
    if (videoRef.current) {
      videoRef.current.play().catch((err) => {
        console.warn('Play do vídeo bloqueado ou falhou. Redirecionando imediatamente:', err);
        router.replace(path);
      });
    } else {
      router.replace(path);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw new Error('Email ou senha inválidos.');
      if (!authData.user) throw new Error('Erro ao identificar usuário.');

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();

      const profile = profileData as Profile;

      if (profileError || !profile) {
        await supabase.auth.signOut();
        throw new Error('Usuário sem perfil vinculado. Fale com a Orion.');
      }

      if (profile.precisa_trocar_senha) {
        handlePlayGoal('/primeiro-acesso');
        return;
      }

      // Define a rota de destino baseada no perfil
      let destination = '/dashboard';
      if (profile.tipo_usuario === 'admin') {
        window.sessionStorage.removeItem('orion:selected_team');
        destination = '/selecionar-time';
      } else if (profile.tipo_usuario === 'gestor_trafego') {
        destination = '/trafego';
      } else if (profile.tipo_usuario === 'designer') {
        destination = '/designer';
      } else if (profile.tipo_usuario === 'account_manager') {
        destination = '/account';
      }

      if (profile.tipo_usuario !== 'admin') {
        const { data: commercialMember } = await supabase
          .from('comercial_membros')
          .select('ativo')
          .eq('profile_id', profile.id)
          .eq('ativo', true)
          .maybeSingle();
        if (commercialMember?.ativo) destination = '/comercial';
      }

      handlePlayGoal(destination);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/resetar-senha`,
      });

      if (recoveryError) throw recoveryError;

      setSuccess('Link de recuperação enviado para seu email!');
      setTimeout(() => setView('login'), 5000);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar email de recuperação.');
    } finally {
      setLoading(false);
    }
  };

  const skipIntro = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = PAUSE_TIME;
      videoRef.current.pause();
    }
    setVideoState('paused-form');
  };

  return (
    <div className="min-h-screen bg-[#020512] flex items-center justify-center relative overflow-hidden font-sans">
      
      {/* Background Player de Vídeo */}
      <video
        ref={videoRef}
        src="/Jogador_chutando_bola_parada_202605311417.mp4"
        className="absolute inset-0 w-full h-full object-cover z-0 select-none pointer-events-none"
        muted
        playsInline
        autoPlay
        onTimeUpdate={(e) => {
          const video = e.currentTarget;
          // Pausa o vídeo exatamente na câmera lenta do chute
          if (videoState === 'playing-intro' && video.currentTime >= PAUSE_TIME) {
            video.pause();
            setVideoState('paused-form');
          }
        }}
        onEnded={() => {
          // Quando o vídeo acaba (gol marcado), faz o redirecionamento
          if (videoState === 'playing-goal') {
            setVideoState('redirecting');
            router.replace(targetRoute);
          }
        }}
      />

      {/* Overlay de contraste com desfoque de fundo inteligente */}
      <div 
        className={`absolute inset-0 bg-slate-950/50 transition-all duration-1000 z-10 ${
          videoState === 'paused-form' ? 'backdrop-blur-[4px]' : 'backdrop-blur-[1px]'
        }`} 
      />

      {/* Vinhetas cinematográficas para cobrir marcas d'água e aumentar contraste visual */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#020512] via-[#020512]/85 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#020512] via-[#020512]/50 to-transparent z-10 pointer-events-none" />

      {/* Botão de Pular Intro (Discreto, no topo direito) */}
      {videoState === 'playing-intro' && (
        <button
          onClick={skipIntro}
          className="absolute top-6 right-6 z-50 flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4.5 py-2.5 text-[9px] font-black uppercase tracking-wider text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer backdrop-blur-md shadow-md animate-fade-in"
          title="Pular introdução do chute"
        >
          Pular Intro
        </button>
      )}

      {/* Overlay de Transição Final Tela Cheia (Gol!) */}
      {videoState === 'redirecting' && (
        <div className="absolute inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center animate-fade-in">
          <div className="text-center space-y-4">
            <Loader2 className="animate-spin text-cyan-400 mx-auto" size={40} />
            <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300 animate-pulse">Sincronizando painel comercial...</p>
          </div>
        </div>
      )}

      {/* Container Principal de Login (Centralizado e Glassmorphic) */}
      <div className="w-full max-w-md px-6 relative z-20">
        <AnimatePresence>
          {videoState === 'paused-form' && (
            <motion.div
              initial={{ opacity: 0, y: 35, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -25, scale: 0.96 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="w-full"
            >
              <div className="bg-[#0b1329]/50 backdrop-blur-2xl border border-white/10 p-8 md:p-10 rounded-[2.5rem] shadow-[0_25px_60px_rgba(0,0,0,0.65)] relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
                
                <div className="flex justify-center mb-7">
                  <img src="/brand-logo.png" alt="ORION TRACK" className="h-16 w-auto object-contain" />
                </div>

                <AnimatePresence mode="wait">
                  {view === 'login' ? (
                    <motion.div 
                      key="login" 
                      initial={{ opacity: 0, x: 15 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      exit={{ opacity: 0, x: -15 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="mb-6 text-center space-y-3">
                        <h2 className="text-lg md:text-xl font-black text-white leading-tight tracking-tight uppercase">
                          A gestao que coloca sua concessionaria no <span className="text-cyan-400 font-extrabold animate-pulse">ataque</span>.
                        </h2>
                        <p className="text-slate-400 font-bold text-3xs uppercase tracking-wider leading-relaxed">
                          Um CRM criado para corretores de planos de saúde venderem com mais controle, velocidade e previsibilidade.
                        </p>
                      </div>

                      {error && (
                        <div className="mb-5 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-xs font-bold leading-normal">
                          <AlertCircle size={16} className="shrink-0" /> {error}
                        </div>
                      )}

                      <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-1.5 group">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-400 transition-colors" size={16} />
                            <input
                              type="email"
                              required
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="exemplo@orion.com.br"
                              className="w-full bg-slate-900/40 border border-white/5 text-white rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/35 transition-all text-sm font-semibold placeholder:text-slate-700"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5 group">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Senha</label>
                            <button 
                              type="button" 
                              onClick={() => setView('recovery')} 
                              className="text-[9px] text-cyan-400 font-extrabold hover:underline uppercase tracking-wider"
                            >
                              Esqueceu?
                            </button>
                          </div>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-400 transition-colors" size={16} />
                            <input
                              type="password"
                              required
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="••••••••"
                              className="w-full bg-slate-900/40 border border-white/5 text-white rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/35 transition-all text-sm font-semibold placeholder:text-slate-700"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black py-4.5 rounded-2xl shadow-lg shadow-blue-600/10 hover:shadow-blue-600/20 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 group text-sm uppercase tracking-wider disabled:opacity-50 disabled:pointer-events-none cursor-pointer mt-6"
                        >
                          {loading ? (
                            <Loader2 className="animate-spin" size={18} />
                          ) : (
                            <>
                              Entrar no Painel 
                              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                            </>
                          )}
                        </button>
                      </form>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="recovery" 
                      initial={{ opacity: 0, x: 15 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      exit={{ opacity: 0, x: -15 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="mb-6 text-center">
                        <h2 className="text-xl font-black text-white tracking-tight uppercase">Recuperar Acesso</h2>
                        <p className="text-slate-500 font-bold text-2xs uppercase tracking-wider mt-1">Enviaremos as instruções de redefinição</p>
                      </div>

                      {error && (
                        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-xs font-bold leading-normal">
                          <AlertCircle size={16} className="shrink-0" /> {error}
                        </div>
                      )}

                      {success && (
                        <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center gap-3 text-green-400 text-xs font-bold leading-normal">
                          <CheckCircle2 size={16} className="shrink-0" /> {success}
                        </div>
                      )}

                      <form onSubmit={handleRecovery} className="space-y-4">
                        <div className="space-y-1.5 group">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Corporativo</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-400 transition-colors" size={16} />
                            <input
                              type="email"
                              required
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="exemplo@orion.com.br"
                              className="w-full bg-slate-900/40 border border-white/5 text-white rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/35 transition-all text-sm font-semibold placeholder:text-slate-700"
                            />
                          </div>
                        </div>

                        <button 
                          type="submit" 
                          disabled={loading} 
                          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black py-4.5 rounded-2xl shadow-lg shadow-blue-600/10 hover:shadow-blue-600/20 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-wider disabled:opacity-50 disabled:pointer-events-none cursor-pointer mt-6"
                        >
                          {loading ? (
                            <Loader2 className="animate-spin" size={18} />
                          ) : (
                            <>
                              Enviar Link 
                              <ArrowRight size={16} />
                            </>
                          )}
                        </button>
                        
                        <button 
                          type="button" 
                          onClick={() => setView('login')} 
                          className="w-full text-xs text-slate-400 font-extrabold hover:text-white uppercase tracking-wider transition-colors mt-3 text-center cursor-pointer"
                        >
                          Voltar ao Login
                        </button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
