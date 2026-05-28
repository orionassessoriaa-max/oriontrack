'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types';

export default function LoginPage() {
  const [view, setView] = useState<'login' | 'recovery'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

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
        router.replace('/primeiro-acesso');
        return;
      }

      // Redirection logic based on tipo_usuario
      if (profile.tipo_usuario === 'admin') {
        router.replace('/admin');
      } else if (profile.tipo_usuario === 'gestor_trafego') {
        router.replace('/trafego/relatorios');
      } else if (profile.tipo_usuario === 'designer') {
        router.replace('/designer');
      } else if (profile.tipo_usuario === 'account_manager') {
        router.replace('/account');
      } else if (profile.tipo_usuario === 'corretor_membro') {
        router.replace('/crm');
      } else {
        router.replace('/dashboard');
      }
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

  return (
    <div className="min-h-screen bg-[#020617] flex flex-col md:flex-row relative overflow-hidden font-sans">
      {/* Esferas Flutuantes 3D Premium de Fundo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            y: [-10, 20, -10],
            x: [-10, 15, -10],
            scale: [1, 1.05, 1],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute top-[-25%] left-[-15%] w-[70%] h-[70%] bg-gradient-to-br from-blue-600/15 to-cyan-500/10 rounded-full blur-[140px] pointer-events-none"
        />
        <motion.div
          animate={{
            y: [10, -25, 10],
            x: [15, -10, 15],
            scale: [1, 1.08, 1],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute bottom-[-20%] right-[-15%] w-[60%] h-[60%] bg-gradient-to-tr from-indigo-900/30 to-purple-800/10 rounded-full blur-[150px] pointer-events-none"
        />
        <motion.div
          animate={{
            scale: [0.95, 1.05, 0.95],
            opacity: [0.1, 0.2, 0.1],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute top-[35%] right-[25%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none"
        />
      </div>

      {/* Lado Esquerdo - Copy Exclusivo e Inspiracional */}
      <div className="hidden md:flex flex-1 flex-col items-start justify-center p-16 lg:p-28 relative z-10 border-r border-white/5 bg-white/[0.005]">
        <motion.div 
          initial={{ opacity: 0, x: -30 }} 
          animate={{ opacity: 1, x: 0 }} 
          transition={{ duration: 0.8, ease: "easeOut" }} 
          className="max-w-xl space-y-10"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-blue-500/30 bg-blue-500/10 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
            <span className="text-xs font-black tracking-widest text-blue-400 uppercase">CRM Orion Track v2.0</span>
          </div>

          <div className="space-y-6">
            <h1 className="text-5xl lg:text-7xl font-black text-white leading-[1.08] tracking-tighter">
              Sua jornada rumo ao <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-400">
                topo das vendas
              </span>
            </h1>
            <p className="text-slate-400 text-xl leading-relaxed font-semibold">
              Mais que um CRM. A máquina de alta performance do corretor moderno para tracionar leads, otimizar comissões e fechar negócios em tempo recorde.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 border-t border-white/5 pt-8 text-white">
            <div className="space-y-1">
              <p className="text-3xl font-black text-blue-400 tracking-tight">+42%</p>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Conversão Média</p>
            </div>
            <div className="space-y-1">
              <p className="text-3xl font-black text-cyan-400 tracking-tight">2.5x</p>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mais Velocidade</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Lado Direito - Formulário Glassmorphism */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 30, scale: 0.98 }} 
          animate={{ opacity: 1, y: 0, scale: 1 }} 
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          {/* Glass Panel */}
          <div className="glass-panel border-white/10 p-8 md:p-10 rounded-[2.5rem] shadow-[0_25px_60px_rgba(0,0,0,0.45)] dark:bg-slate-950/40 relative overflow-hidden group">
            {/* Sutil brilho no topo do card */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />

            <div className="flex flex-col items-center mb-8">
              <img src="/brand-logo.png" alt="ORION TRACK" className="h-20 w-auto object-contain transition-transform group-hover:scale-102 duration-300" />
            </div>

            <AnimatePresence mode="wait">
              {view === 'login' ? (
                <motion.div 
                  key="login" 
                  initial={{ opacity: 0, x: 15 }} 
                  animate={{ opacity: 1, x: 0 }} 
                  exit={{ opacity: 0, x: -15 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="mb-6 text-center md:text-left">
                    <h2 className="text-2xl font-black text-white mb-1.5 tracking-tight">Acessar Painel</h2>
                    <p className="text-slate-400 font-bold text-sm">Insira seus dados comerciais para continuar.</p>
                  </div>

                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm font-bold leading-relaxed"
                    >
                      <AlertCircle size={18} className="shrink-0" /> <span>{error}</span>
                    </motion.div>
                  )}

                  <form onSubmit={handleLogin} className="space-y-5">
                    <div className="space-y-2 group">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Corporativo</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="corretor@orion.com.br"
                          className="w-full bg-[#0c1a3a] border border-[#1e3a5f] text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400/60 focus:bg-[#0f2042] transition-all placeholder:text-slate-500 font-semibold"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 group">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Senha de Acesso</label>
                        <button 
                          type="button" 
                          onClick={() => setView('recovery')} 
                          className="text-[10px] text-blue-400 font-black hover:text-blue-300 hover:underline uppercase tracking-wider transition-colors"
                        >
                          Esqueceu?
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                        <input
                          type="password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-[#0c1a3a] border border-[#1e3a5f] text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400/60 focus:bg-[#0f2042] transition-all placeholder:text-slate-500 font-semibold"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 bg-[size:200%_auto] hover:bg-right text-white font-black py-4.5 rounded-2xl shadow-xl shadow-blue-600/15 hover:shadow-blue-600/25 transition-all duration-500 flex items-center justify-center gap-3 group text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                    >
                      {loading ? (
                        <Loader2 className="animate-spin" size={22} />
                      ) : (
                        <>
                          Entrar no Painel 
                          <ArrowRight size={20} className="group-hover:translate-x-1.5 transition-transform duration-300" />
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
                  transition={{ duration: 0.3 }}
                >
                  <div className="mb-6 text-center md:text-left">
                    <h2 className="text-2xl font-black text-white mb-1.5 tracking-tight">Recuperar Senha</h2>
                    <p className="text-slate-400 font-bold text-sm">Enviaremos um link de reset para o seu email.</p>
                  </div>

                  {error && (
                    <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm font-bold leading-relaxed">
                      <AlertCircle size={18} className="shrink-0" /> <span>{error}</span>
                    </div>
                  )}

                  {success && (
                    <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center gap-3 text-green-400 text-sm font-bold leading-relaxed">
                      <CheckCircle2 size={18} className="shrink-0" /> <span>{success}</span>
                    </div>
                  )}

                  <form onSubmit={handleRecovery} className="space-y-5">
                    <div className="space-y-2 group">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Corporativo</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="corretor@orion.com.br"
                          className="w-full bg-[#0c1a3a] border border-[#1e3a5f] text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400/60 focus:bg-[#0f2042] transition-all placeholder:text-slate-500 font-semibold"
                        />
                      </div>
                    </div>

                    <button 
                      type="submit" 
                      disabled={loading} 
                      className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 bg-[size:200%_auto] hover:bg-right text-white font-black py-4.5 rounded-2xl shadow-xl shadow-blue-600/15 hover:shadow-blue-600/25 transition-all duration-500 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                    >
                      {loading ? <Loader2 className="animate-spin" size={22} /> : <>Enviar Link de Reset <ArrowRight size={20} /></>}
                    </button>

                    <button 
                      type="button" 
                      onClick={() => setView('login')} 
                      className="w-full text-sm text-slate-400 font-black hover:text-white transition-colors py-2"
                    >
                      Voltar para o Login
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

