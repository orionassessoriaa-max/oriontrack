'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types';
import { canSelectOperationalTeam, TEAM_SELECTION_STORAGE_KEY } from '@/lib/teamSelection';

function isTemporaryAuthFailure(message?: string | null) {
  return /failed to fetch|network|timeout|timed out|fetch failed|load failed/i.test(String(message || ''));
}

function loginErrorMessage(message?: string | null) {
  if (isTemporaryAuthFailure(message)) {
    return 'O CRM esta oscilando e nao conseguiu consultar seu acesso. Sua senha nao foi alterada. Tente novamente em alguns segundos.';
  }
  if (/invalid login credentials|email not confirmed/i.test(String(message || ''))) {
    return 'Email ou senha invalidos.';
  }
  return 'Nao foi possivel validar seu acesso agora. Tente novamente.';
}

export default function LoginPage() {
  const [view, setView] = useState<'login' | 'recovery'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const redirectFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [redirecionando, setRedirecionando] = useState(false);

  const router = useRouter();

  const clearRedirectFallback = () => {
    if (!redirectFallbackRef.current) return;
    clearTimeout(redirectFallbackRef.current);
    redirectFallbackRef.current = null;
  };

  const finishLoginRedirect = (path: string) => {
    clearRedirectFallback();
    setRedirecionando(true);
    router.replace(path);
  };

  useEffect(() => () => clearRedirectFallback(), []);

  // O login leva direto ao painel. A navegacao completa e a rede de seguranca
  // para navegador presa em chunk antigo, que ja aconteceu aqui.
  const entrarNoPainel = (path: string) => {
    setRedirecionando(true);
    clearRedirectFallback();
    redirectFallbackRef.current = setTimeout(() => {
      window.location.replace(path);
    }, 3000);
    finishLoginRedirect(path);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let loginResult = await supabase.auth.signInWithPassword({ email, password });
      if (loginResult.error && isTemporaryAuthFailure(loginResult.error.message)) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        loginResult = await supabase.auth.signInWithPassword({ email, password });
      }
      const { data: authData, error: authError } = loginResult;

      if (authError) throw new Error(loginErrorMessage(authError.message));
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
        entrarNoPainel('/primeiro-acesso');
        return;
      }

      // Define a rota de destino baseada no perfil
      let destination = '/dashboard';
      if (canSelectOperationalTeam(profile)) {
        window.sessionStorage.removeItem(TEAM_SELECTION_STORAGE_KEY);
        destination = '/selecionar-time';
      } else if (profile.tipo_usuario === 'gestor_trafego') {
        destination = '/trafego';
      } else if (profile.tipo_usuario === 'designer') {
        destination = '/designer';
      } else if (profile.tipo_usuario === 'account_manager') {
        destination = '/account';
      }

      if (!canSelectOperationalTeam(profile)) {
        const { data: commercialMember } = await supabase
          .from('comercial_membros')
          .select('ativo')
          .eq('profile_id', profile.id)
          .eq('ativo', true)
          .maybeSingle();
        if (commercialMember?.ativo) destination = '/comercial';
      }

      entrarNoPainel(destination);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar no painel.');
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar email de recuperação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020512] flex items-center justify-center relative overflow-hidden font-sans">
      
      {/* Fundo sobrio: a operacao vende previsibilidade, nao espetaculo. Sem
          video, a tela de entrada tambem deixou de baixar 6,9 MB por acesso. */}
      <div className="absolute inset-0 z-0 bg-[#020512]" />
      <div
        className="absolute inset-0 z-0 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 20% 15%, rgba(37,99,235,0.22) 0%, transparent 45%),' +
            'radial-gradient(circle at 85% 80%, rgba(6,182,212,0.16) 0%, transparent 50%)',
        }}
      />
      <div
        className="absolute inset-0 z-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.9) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(148,163,184,0.9) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#020512] to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#020512] to-transparent z-10 pointer-events-none" />

      {redirecionando && (
        <div className="absolute inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center animate-fade-in">
          <div className="text-center space-y-4">
            <Loader2 className="animate-spin text-cyan-400 mx-auto" size={40} />
            <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300 animate-pulse">Abrindo seu painel...</p>
          </div>
        </div>
      )}

      {/* Container Principal de Login (Centralizado e Glassmorphic) */}
      <div className="w-full max-w-md px-6 relative z-20">
        <AnimatePresence>
          {!redirecionando && (
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
                          Venda com <span className="text-cyan-400 font-extrabold">previsibilidade</span>.
                        </h2>
                        <p className="text-slate-400 font-bold text-3xs uppercase tracking-wider leading-relaxed">
                          O CRM que mostra quantos leads entram, quanto custa cada um e o que vira venda.
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
