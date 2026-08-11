'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bot, Loader2, Shield, Sparkles, Target, Trophy } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { canSelectOperationalTeam, DUAL_OPERATION_ACCESS_KEY, getTeamHome, TEAM_SELECTION_STORAGE_KEY, type OrionTeamKey } from '@/lib/teamSelection';

const teams: Array<{
  id: OrionTeamKey;
  name: string;
  subtitle: string;
  description: string;
  badge: string;
  icon: typeof Trophy;
  gradient: string;
}> = [
  {
    id: 'apollo',
    name: 'Time Apollo',
    subtitle: 'Operacional',
    description: 'CRM de corretores, Meta Ads, rodizio de leads, inbox, suporte e acompanhamento do time operacional.',
    badge: 'Patrick Admin',
    icon: Bot,
    gradient: 'from-cyan-500 via-blue-600 to-indigo-700',
  },
  {
    id: 'kripto_hunters',
    name: 'Kripto Hunter',
    subtitle: 'Comercial',
    description: 'Operacao comercial da Orion com dashboard executivo, pipeline, leads, tarefas e follow-up inteligente.',
    badge: 'Pedro Admin',
    icon: Target,
    gradient: 'from-emerald-500 via-teal-600 to-cyan-700',
  },
];

export default function SelecionarTimePage() {
  const router = useRouter();
  const { user, actualProfile, loading, signOut } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    const verifiedDualAccess = actualProfile
      ? window.sessionStorage.getItem(DUAL_OPERATION_ACCESS_KEY) === actualProfile.id
      : false;
    if (actualProfile && !canSelectOperationalTeam(actualProfile, verifiedDualAccess)) {
      router.replace('/');
    }
  }, [actualProfile, loading, router, user]);

  function selectTeam(team: OrionTeamKey) {
    window.sessionStorage.setItem(TEAM_SELECTION_STORAGE_KEY, team);
    window.localStorage.setItem(TEAM_SELECTION_STORAGE_KEY, team);
    window.dispatchEvent(new Event('orion:team_selected'));
    const destination = team === 'apollo' && actualProfile?.tipo_usuario === 'gestor_trafego'
      ? '/trafego'
      : getTeamHome(team);
    router.replace(destination);
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] text-white">
        <Loader2 className="animate-spin text-cyan-400" size={38} />
      </div>
    );
  }

  if (!actualProfile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#020617] px-5 text-white">
        <section className="w-full max-w-lg rounded-3xl border border-red-400/20 bg-[#08111f] p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-black">Nao foi possivel carregar seu acesso</h1>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-400">
            A conexao demorou mais que o esperado. Tente novamente sem precisar fechar o navegador.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-cyan-500 px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-950">
              Tentar novamente
            </button>
            <button type="button" onClick={signOut} className="rounded-xl border border-white/10 px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-300">
              Voltar ao login
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#020617] px-5 py-8 text-white sm:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_30%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-center">
        <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">
              <Shield size={14} />
              Acesso admin / dev
            </div>
            <h1 className="max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
              Qual time voce deseja acessar?
            </h1>
            <p className="mt-4 max-w-2xl text-sm font-bold leading-relaxed text-slate-400 sm:text-base">
              Escolha a operacao antes de entrar no painel. Apollo e Kripto Hunter possuem dados, fluxos e identidades visuais independentes.
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-fit rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            Sair
          </button>
        </header>

        <section className="grid gap-5 md:grid-cols-2">
          {teams.map((team) => {
            const Icon = team.icon;
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => selectTeam(team.id)}
                className="group relative min-h-[320px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#08111f] p-6 text-left shadow-2xl transition hover:-translate-y-1 hover:border-cyan-300/40 hover:shadow-cyan-500/10 sm:p-8"
              >
                <div className={`absolute inset-x-0 top-0 h-32 bg-gradient-to-r ${team.gradient} opacity-25 transition group-hover:opacity-40`} />
                <div className="relative flex h-full flex-col justify-between gap-10">
                  <div>
                    <div className="mb-6 flex items-center justify-between gap-4">
                      <div className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${team.gradient} text-white shadow-xl`}>
                        <Icon size={30} />
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-200">
                        {team.badge}
                      </span>
                    </div>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">{team.subtitle}</p>
                    <h2 className="text-3xl font-black tracking-tight">{team.name}</h2>
                    <p className="mt-4 max-w-md text-sm font-bold leading-relaxed text-slate-400">{team.description}</p>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/10 pt-5">
                    <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-300">
                      <Sparkles size={15} className="text-cyan-300" />
                      Acessar painel
                    </span>
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-950 transition group-hover:translate-x-1">
                      <ArrowRight size={18} />
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </section>
      </div>
    </main>
  );
}
