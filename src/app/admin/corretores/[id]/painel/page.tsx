'use client';

import { use, useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { StatCard } from '@/components/ui/Stats';
import { supabase } from '@/lib/supabase/client';
import { Corretor, Lead } from '@/types';
import { ArrowLeft, ExternalLink, KanbanSquare, Loader2, Target, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';

export default function AdminCorretorPainelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [corretor, setCorretor] = useState<Corretor | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      const [{ data: corretorData, error: corretorError }, { data: leadsData, error: leadsError }] = await Promise.all([
        supabase.from('corretores').select('*').eq('id', id).maybeSingle(),
        supabase.from('leads').select('*').eq('corretor_id', id).order('data_entrada', { ascending: false }),
      ]);

      if (!corretorError) setCorretor(corretorData);
      if (!leadsError) setLeads(leadsData || []);
      setLoading(false);
    }

    void Promise.resolve().then(fetchData);
  }, [id]);

  const stats = {
    total: leads.length,
    oportunidades: leads.filter((lead) => lead.status === 'Aguardando atendimento').length,
    negociacao: leads.filter((lead) => lead.status === 'Em negociação').length,
    vendas: leads.filter((lead) => lead.status === 'Venda realizada').length,
  };

  if (loading) {
    return (
      <InternalLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <div className="mb-10">
        <Link href="/admin/corretores" className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-blue-600">
          <ArrowLeft size={16} /> Voltar para Corretores
        </Link>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-widest text-blue-600">Visão admin do corretor</p>
            <h1 className="text-3xl font-black tracking-tight text-gray-900">{corretor?.nome || 'Corretor'}</h1>
            <p className="font-medium text-gray-500">{corretor?.email}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {corretor?.link_pagina && (
              <a href={corretor.link_pagina} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-gray-700 shadow-sm ring-1 ring-gray-100 hover:text-blue-600">
                <ExternalLink size={16} /> Página
              </a>
            )}
            <Link href={`/admin/corretores/${id}/editar`} className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700">
              Editar corretor
            </Link>
          </div>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Leads recebidos" value={stats.total} icon={Users} color="blue" />
        <StatCard title="Oportunidades" value={stats.oportunidades} icon={Target} color="purple" />
        <StatCard title="Em negociação" value={stats.negociacao} icon={KanbanSquare} color="orange" />
        <StatCard title="Vendas realizadas" value={stats.vendas} icon={TrendingUp} color="green" />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm lg:col-span-2">
          <h2 className="mb-6 text-xl font-black text-gray-900">Últimos leads</h2>
          <div className="space-y-3">
            {leads.slice(0, 8).map((lead) => (
              <div key={lead.id} className="flex flex-col gap-2 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-black text-gray-900">{lead.nome}</p>
                  <p className="text-sm font-medium text-gray-500">{lead.telefone} • {lead.cidade || 'Cidade não informada'}</p>
                </div>
                <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-600">
                  {lead.status === 'Aguardando atendimento' ? 'Oportunidade' : lead.status}
                </span>
              </div>
            ))}
            {leads.length === 0 && (
              <p className="py-10 text-center text-sm font-bold text-gray-400">Nenhum lead encontrado para este corretor.</p>
            )}
          </div>
        </div>

        <div className="rounded-[2.5rem] border border-gray-100 bg-slate-50 p-8">
          <h2 className="mb-5 text-xl font-black text-gray-900">Configuração comercial</h2>
          <div className="space-y-4 text-sm font-bold text-gray-600">
            <p>Campanha: <span className="text-gray-900">{corretor?.tipo_campanha?.toUpperCase() || 'AMBOS'}</span></p>
            <p>Telefone: <span className="text-gray-900">{corretor?.telefone || '-'}</span></p>
            <p>Status: <span className="text-gray-900">{corretor?.status || '-'}</span></p>
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}
