'use client';

import { useState, useEffect } from 'react';
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

  useEffect(() => {
    localStorage.clear();
    sessionStorage.clear();
  }, []);

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

      // Redirection logic based on tipo_usuario
      if (profile.tipo_usuario === 'admin') {
        router.push('/admin');
      } else if (profile.tipo_usuario === 'gestor_trafego') {
        router.push('/trafego/relatorios');
      } else {
        router.push('/dashboard');
      }
      
      router.refresh();
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
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-600/10 rounded-full blur-[140px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/20 rounded-full blur-[120px]" />
      </div>

      <div className="hidden md:flex flex-1 flex-col items-center justify-start pt-20 lg:pt-32 p-12 lg:p-24 relative z-10 border-r border-white/5 bg-white/[0.01]">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 }} className="max-w-lg">
          <div className="space-y-8">
            <h1 className="text-5xl lg:text-6xl font-black text-white leading-tight tracking-tighter">
              Sua jornada de <span className="text-blue-500">vendas</span> começa aqui.
            </h1>
            <p className="text-gray-400 text-xl leading-relaxed font-light">
              A plataforma definitiva para corretores que buscam excelência no gerenciamento de leads.
            </p>
          </div>
        </motion.div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 md:p-12 relative z-10">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md">
          <div className="bg-[#0f172a]/40 backdrop-blur-3xl border border-white/10 p-8 md:p-10 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <div className="flex justify-center mb-6">
              <img src="/brand-logo.png" alt="ORION TRACK" className="h-20 w-auto" />
            </div>
            <AnimatePresence mode="wait">
              {view === 'login' ? (
                <motion.div key="login" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="mb-6 text-center md:text-left">
                    <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Acessar Painel</h2>
                    <p className="text-gray-500 font-medium text-sm">Insira seus dados para continuar.</p>
                  </div>

                  {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm">
                      <AlertCircle size={18} /> {error}
                    </div>
                  )}

                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2 group">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={18} />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="exemplo@orion.com.br"
                          className="w-full bg-white/[0.03] border border-white/10 text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-700"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 group">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Senha</label>
                        <button type="button" onClick={() => setView('recovery')} className="text-[10px] text-blue-400 font-bold hover:underline uppercase tracking-tighter">Esqueceu?</button>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={18} />
                        <input
                          type="password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-white/[0.03] border border-white/10 text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-700"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black py-5 rounded-2xl shadow-xl shadow-blue-600/20 transition-all flex items-center justify-center gap-3 group text-lg disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="animate-spin" size={22} /> : <>Entrar <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" /></>}
                    </button>
                  </form>
                </motion.div>
              ) : (
                <motion.div key="recovery" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="mb-6 text-center md:text-left">
                    <h2 className="text-2xl font-bold text-white mb-2">Recuperar Senha</h2>
                    <p className="text-gray-500 font-medium text-sm">Enviaremos um link para o seu email corporativo.</p>
                  </div>
                  {error && <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm"><AlertCircle size={18} /> {error}</div>}
                  {success && <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center gap-3 text-green-400 text-sm"><CheckCircle2 size={18} /> {success}</div>}
                  <form onSubmit={handleRecovery} className="space-y-4">
                    <div className="space-y-2 group">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Email Corporativo</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={18} />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="exemplo@orion.com.br"
                          className="w-full bg-white/[0.03] border border-white/10 text-white rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-700"
                        />
                      </div>
                    </div>
                    <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black py-5 rounded-2xl shadow-xl shadow-blue-600/20 transition-all flex items-center justify-center gap-3 disabled:opacity-50">
                      {loading ? <Loader2 className="animate-spin" size={22} /> : <>Enviar Link <ArrowRight size={22} /></>}
                    </button>
                    <button type="button" onClick={() => setView('login')} className="w-full text-sm text-gray-400 font-bold hover:text-white transition-colors">Voltar para o Login</button>
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
