'use client';

import Link from 'next/link';
import InternalLayout from '@/components/layout/InternalLayout';
import { ArrowRight, CheckCircle2, ClipboardList, FileSearch, MessageSquare, PhoneCall, TrendingUp, Users } from 'lucide-react';

export default function AccountHomePage() {
  return (
    <InternalLayout>
      <div className="mb-8 overflow-hidden border border-blue-100 bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 p-8 text-white shadow-2xl shadow-blue-900/20 dark:border-blue-400/20">
        <div className="max-w-4xl">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-blue-200">Account manager</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Central de relacionamento Orion</h1>
          <p className="mt-4 max-w-3xl text-base font-semibold leading-8 text-blue-100">
            Organize contatos, gere resumos para clientes e acompanhe quem ja recebeu atencao hoje.
          </p>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          <HeroMetric icon={Users} label="Carteira" value="Clientes acompanhados" />
          <HeroMetric icon={CheckCircle2} label="Rotina" value="Interacoes do dia" />
          <HeroMetric icon={PhoneCall} label="Atendimento" value="WhatsApp e relatorios" />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Shortcut href="/account/inbox" icon={MessageSquare} title="Inbox" text="WhatsApp, relatorio rapido e check diario." color="blue" />
        <Shortcut href="/trafego/relatorios" icon={TrendingUp} title="Relatorios" text="Gerar e salvar relatorios completos." color="emerald" />
        <Shortcut href="/admin/leads" icon={FileSearch} title="Leads" text="Consultar leads por corretor e status." color="indigo" />
        <Shortcut href="/criativos/demandas" icon={ClipboardList} title="Demandas" text="Solicitar criativos para clientes." color="rose" />
      </div>
    </InternalLayout>
  );
}

function HeroMetric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-white/10 p-4 backdrop-blur">
      <Icon size={20} className="text-blue-200" />
      <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-blue-200">{label}</p>
      <p className="mt-1 text-sm font-black text-white">{value}</p>
    </div>
  );
}

function Shortcut({ href, icon: Icon, title, text, color }: { href: string; icon: any; title: string; text: string; color: 'blue' | 'emerald' | 'indigo' | 'rose' }) {
  const colors = {
    blue: 'bg-blue-600 shadow-blue-600/20 group-hover:border-blue-300',
    emerald: 'bg-emerald-600 shadow-emerald-600/20 group-hover:border-emerald-300',
    indigo: 'bg-indigo-600 shadow-indigo-600/20 group-hover:border-indigo-300',
    rose: 'bg-rose-600 shadow-rose-600/20 group-hover:border-rose-300',
  };

  return (
    <Link href={href} className="orion-panel group min-h-[210px] p-6 transition hover:-translate-y-1 hover:shadow-xl">
      <div className={`flex h-14 w-14 items-center justify-center text-white shadow-lg transition group-hover:scale-105 ${colors[color]}`}>
        <Icon size={25} />
      </div>
      <h2 className="mt-5 text-2xl font-black text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500 dark:text-slate-300">{text}</p>
      <span className="mt-5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600">
        Acessar <ArrowRight size={14} />
      </span>
    </Link>
  );
}
