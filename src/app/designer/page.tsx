'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Clock, ClipboardList, Palette, Upload } from 'lucide-react';

export default function DesignerHomePage() {
  const [stats, setStats] = useState({ pendentes: 0, atrasadas: 0, entregues: 0, assets: 0 });

  useEffect(() => {
    const load = async () => {
      const [{ data: demands }, { data: assets }] = await Promise.all([
        supabase.from('criativo_demandas').select('id, status, data_entrega'),
        supabase.from('criativo_assets').select('id'),
      ]);

      const today = new Date();
      setStats({
        pendentes: (demands || []).filter((item) => item.status === 'pendente').length,
        atrasadas: (demands || []).filter((item) => item.status === 'pendente' && item.data_entrega && new Date(`${item.data_entrega}T23:59:59`) < today).length,
        entregues: (demands || []).filter((item) => ['entregue', 'aprovado', 'feito'].includes(item.status)).length,
        assets: (assets || []).length,
      });
    };

    load();
  }, []);

  return (
    <InternalLayout>
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-widest text-blue-600">Designer</p>
        <h1 className="text-3xl font-black text-slate-950">Painel de criativos</h1>
        <p className="mt-2 text-sm font-bold text-slate-500">Gerencie demandas, entregue ofertas e acompanhe o que ja subiu para os corretores.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Counter icon={Clock} label="Pendentes" value={stats.pendentes} tone="blue" />
        <Counter icon={Clock} label="Atrasadas" value={stats.atrasadas} tone="red" />
        <Counter icon={CheckCircle2} label="Entregues" value={stats.entregues} tone="emerald" />
        <Counter icon={Palette} label="Arquivos" value={stats.assets} tone="slate" />
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Link href="/criativos/demandas" className="group border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-300">
          <ClipboardList className="text-blue-600" size={28} />
          <h2 className="mt-5 text-xl font-black text-slate-950">Demandas</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">Ver solicitacoes, prazos e subir o criativo dentro da demanda.</p>
        </Link>
        <Link href="/designer/ofertas" className="group border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-300">
          <Upload className="text-blue-600" size={28} />
          <h2 className="mt-5 text-xl font-black text-slate-950">Ofertas e arquivos</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">Selecionar corretor, subir criativos avulsos e consultar historico de entregas.</p>
        </Link>
      </div>
    </InternalLayout>
  );
}

function Counter({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  };

  return (
    <div className={`border p-5 ${tones[tone]}`}>
      <Icon size={20} />
      <p className="mt-4 text-[10px] font-black uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}
