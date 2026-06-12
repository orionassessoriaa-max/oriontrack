'use client';

import Link from 'next/link';
import InternalLayout from '@/components/layout/InternalLayout';
import { ArrowRight, CheckCircle2, MessageSquare, PhoneCall, TrendingUp, Users, Trophy } from 'lucide-react';

export default function AccountHomePage() {
  return (
    <InternalLayout>
      {/* Hero Welcome Panel */}
      <div className="mb-8 overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-br from-[#090e1a]/95 via-blue-950/30 to-blue-900/10 p-8 text-white shadow-2xl relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl -mr-16 -mt-16" />
        
        <div className="max-w-4xl relative z-10">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-400 flex items-center gap-1.5">
            Account manager
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight leading-tight">
            Central de Relacionamento Orion
          </h1>
          <p className="mt-3 max-w-3xl text-sm sm:text-base font-semibold leading-relaxed text-slate-300">
            Organize contatos, gerencie fluxos de criativos para clientes e acompanhe quem já recebeu atenção hoje.
          </p>
        </div>
        
        <div className="mt-8 grid gap-4 md:grid-cols-3 relative z-10">
          <HeroMetric icon={Users} label="Carteira" value="Clientes Acompanhados" />
          <HeroMetric icon={CheckCircle2} label="Rotina" value="Interações do Dia" />
          <HeroMetric icon={PhoneCall} label="Atendimento" value="WhatsApp e Relatórios" />
        </div>
      </div>

      {/* Shortcuts Grid */}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 mb-12">
        <Shortcut href="/account/inbox" icon={MessageSquare} title="Inbox" text="Acessar WhatsApp, relatórios rápidos e check diário." color="blue" />
        <Shortcut href="/trafego/relatorios" icon={TrendingUp} title="Relatórios" text="Gerar e salvar relatórios de tráfego completos." color="emerald" />
        <Shortcut href="/equipe/apollo" icon={Trophy} title="Meu time" text="Visualizar equipe Apollo, conquistas e objetivos." color="indigo" />
      </div>

      {/* Footer Decoration */}
      <div className="mt-16 pt-8 border-t border-white/5 flex justify-between items-center opacity-45">
        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Orion Track v2.0</p>
        <div className="flex gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
        </div>
      </div>
    </InternalLayout>
  );
}

function HeroMetric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="border border-white/5 bg-white/[0.03] p-5 rounded-2xl backdrop-blur-md group hover:border-cyan-500/20 transition-all duration-300">
      <Icon size={20} className="text-cyan-400 stroke-[2.5]" />
      <p className="mt-3.5 text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-white">{value}</p>
    </div>
  );
}

function Shortcut({ href, icon: Icon, title, text, color }: { href: string; icon: any; title: string; text: string; color: 'blue' | 'emerald' | 'indigo' }) {
  const colors = {
    blue: 'bg-blue-600 shadow-blue-600/20 group-hover:bg-blue-500',
    emerald: 'bg-emerald-600 shadow-emerald-600/20 group-hover:bg-emerald-500',
    indigo: 'bg-indigo-600 shadow-indigo-600/20 group-hover:bg-indigo-500',
  };

  return (
    <Link href={href} className="group min-h-[220px] p-6 rounded-2xl bg-[#090e1a]/85 border border-white/5 hover:border-blue-500/30 shadow-xl hover:shadow-[0_0_30px_rgba(59,130,246,0.08)] transition-all duration-300 flex flex-col justify-between">
      <div>
        <div className={`flex h-12 w-12 items-center justify-center text-white rounded-xl shadow-lg transition-transform group-hover:scale-105 ${colors[color]}`}>
          <Icon size={22} />
        </div>
        <h2 className="mt-4 text-xl font-black text-white group-hover:text-cyan-400 transition-colors">{title}</h2>
        <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-400">{text}</p>
      </div>
      <span className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-400 group-hover:text-white transition-colors">
        Acessar <ArrowRight size={12} />
      </span>
    </Link>
  );
}
