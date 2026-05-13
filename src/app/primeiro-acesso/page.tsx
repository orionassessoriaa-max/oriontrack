'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';

export default function PrimeiroAcessoPage() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [emailReal, setEmailReal] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (profile?.email_real) setEmailReal(profile.email_real);
  }, [loading, user, profile, router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (senha !== confirmarSenha) {
      setError('As senhas não coincidem.');
      return;
    }

    if (senha.length < 8) {
      setError('Crie uma senha com pelo menos 8 caracteres.');
      return;
    }

    setSaving(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setSaving(false);
      setError('Sessão expirada. Entre novamente.');
      return;
    }

    const response = await fetch('/api/auth/primeiro-acesso', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email_real: emailReal, senha })
    });

    const payload = await response.json();
    if (!response.ok) {
      setSaving(false);
      setError(payload.error || 'Não foi possível concluir o primeiro acesso.');
      return;
    }

    setSuccess(true);
    await supabase.auth.signInWithOtp({
      email: emailReal,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/login`
      }
    });
    await refreshProfile();
    await supabase.auth.signOut();
    setTimeout(() => router.push('/login'), 2600);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] p-6 font-sans text-white">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-[-10%] top-[-20%] h-[60%] w-[60%] rounded-full bg-blue-600/10 blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-lg rounded-[2.5rem] border border-white/10 bg-[#0f172a]/60 p-8 shadow-2xl backdrop-blur-3xl md:p-10"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-300">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-3xl font-black tracking-tight">Primeiro acesso</h1>
          <p className="mt-2 text-sm font-medium text-slate-400">
            Confirme seu email real e crie uma senha própria para continuar.
          </p>
        </div>

        {success ? (
          <div className="space-y-4 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6 text-center">
            <CheckCircle2 className="mx-auto text-emerald-300" size={42} />
            <h2 className="text-xl font-black">Acesso atualizado</h2>
            <p className="text-sm font-medium text-emerald-100">
              Enviamos a verificação para seu email real. Depois, entre usando esse email e a nova senha.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-bold text-red-300">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="ml-1 text-xs font-black uppercase tracking-widest text-slate-400">Email real</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="email"
                  required
                  value={emailReal}
                  onChange={(event) => setEmailReal(event.target.value)}
                  placeholder="seunome@email.com"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-4 pl-12 pr-4 font-bold text-white outline-none transition-all focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="ml-1 text-xs font-black uppercase tracking-widest text-slate-400">Nova senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="password"
                  required
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-4 pl-12 pr-4 font-bold text-white outline-none transition-all focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="ml-1 text-xs font-black uppercase tracking-widest text-slate-400">Confirmar senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="password"
                  required
                  value={confirmarSenha}
                  onChange={(event) => setConfirmarSenha(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-4 pl-12 pr-4 font-bold text-white outline-none transition-all focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 py-5 text-lg font-black text-white shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={22} /> : <>Concluir acesso <ArrowRight size={22} /></>}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
