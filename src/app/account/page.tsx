'use client';

import Link from 'next/link';
import InternalLayout from '@/components/layout/InternalLayout';
import { ClipboardList, FileSearch, MessageSquare, TrendingUp } from 'lucide-react';

export default function AccountHomePage() {
  return (
    <InternalLayout>
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-widest text-blue-600">Account manager</p>
        <h1 className="text-3xl font-black text-slate-950">Central de comunicacao</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold text-slate-500">
          Painel para atender clientes, gerar resumo rapido de desempenho e acompanhar interacoes do dia.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Shortcut href="/account/inbox" icon={MessageSquare} title="Inbox" text="WhatsApp, relatorio rapido e check diario." />
        <Shortcut href="/trafego/relatorios" icon={TrendingUp} title="Relatorios" text="Gerar e salvar relatorios completos." />
        <Shortcut href="/admin/leads" icon={FileSearch} title="Leads" text="Consultar leads por corretor e status." />
        <Shortcut href="/criativos/demandas" icon={ClipboardList} title="Demandas" text="Solicitar criativos para clientes." />
      </div>
    </InternalLayout>
  );
}

function Shortcut({ href, icon: Icon, title, text }: { href: string; icon: any; title: string; text: string }) {
  return (
    <Link href={href} className="orion-panel group min-h-[190px] p-6 transition hover:border-blue-300 hover:shadow-xl">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20 transition group-hover:scale-105">
        <Icon size={25} />
      </div>
      <h2 className="mt-5 text-2xl font-black text-slate-950">{title}</h2>
      <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">{text}</p>
    </Link>
  );
}
