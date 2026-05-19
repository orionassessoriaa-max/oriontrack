'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { StatCard } from '@/components/ui/Stats';
import { useAuth } from '@/components/providers/AuthProvider';
import { 
  Users, 
  BarChart3,
  Clock, 
  DollarSign,
  Send, 
  TrendingUp, 
  LayoutDashboard, 
  Globe, 
  HelpCircle, 
  ArrowRight,
  GraduationCap,
  CalendarDays,
  Target,
  Sparkles,
  Info,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getTeamMemberPhoto } from '@/lib/orionTeam';

type CorretorDashboardData = {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  link_pagina: string | null;
  gestor_trafego_id: string | null;
  time_operacional: Array<{
    nome: string;
    cargo: string;
  }> | null;
};

type LeadMetricRow = {
  status: string | null;
  data_entrada: string | null;
};

type MonthlyPerformance = {
  key: string;
  label: string;
  leads: number;
  spend: number;
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

function getLastMonths(total = 6): MonthlyPerformance[] {
  const now = new Date();
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (total - 1 - index), 1);
    return {
      key: monthKey(date),
      label: monthLabel(date),
      leads: 0,
      spend: 0,
    };
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

export default function DashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const [corretorData, setCorretorData] = useState<CorretorDashboardData | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    waiting: 0,
    inProgress: 0,
    quoted: 0,
    sold: 0,
    stale: 0
  });
  const [monthlyPerformance, setMonthlyPerformance] = useState<MonthlyPerformance[]>(getLastMonths());
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    async function fetchCorretorData() {
      if (!profile || profile.tipo_usuario !== "corretor") {
        setLoadingData(false);
        return;
      }

      if (!profile.corretor_id) {
        setLoadingData(false);
        return;
      }

      setLoadingData(true);
      
      try {
        // 1. Buscar dados do Corretor (Time e Configurações)
        const { data, error: corretorError } = await supabase
          .from("corretores")
          .select("id, nome, email, telefone, link_pagina, gestor_trafego_id, time_operacional")
          .eq("id", profile.corretor_id)
          .maybeSingle();

        if (corretorError) {
          console.error("Erro ao buscar corretor do dashboard:", JSON.stringify(corretorError, null, 2));
          throw corretorError;
        }

        setCorretorData(data);

        // 2. Buscar Estatísticas de Leads
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const [statsQuery, metaQuery] = await Promise.all([
          supabase
            .from('leads')
            .select('status, data_entrada')
            .eq('corretor_id', profile.corretor_id),
          supabase
            .from('meta_metricas_diarias')
            .select('data, spend')
            .eq('corretor_id', profile.corretor_id)
            .gte('data', sixMonthsAgo.toISOString().slice(0, 10))
        ]);

        if (statsQuery.error) throw statsQuery.error;

        if (statsQuery.data) {
          const statsRes = statsQuery.data as LeadMetricRow[];
          setStats({
            total: statsRes.length,
            waiting: statsRes.filter(l => l.status === 'Aguardando atendimento').length,
            inProgress: statsRes.filter(l => l.status === 'Em negociação').length,
            quoted: statsRes.filter(l => l.status === 'Cotação enviada').length,
            sold: statsRes.filter(l => l.status === 'Venda realizada').length,
            stale: statsRes.filter(l => {
              if (l.status !== 'Aguardando atendimento' || !l.data_entrada) return false;
              return Date.now() - new Date(l.data_entrada).getTime() > 20 * 60 * 1000;
            }).length
          });

          const months = getLastMonths();
          const monthMap = new Map(months.map((month) => [month.key, { ...month }]));

          statsRes.forEach((lead) => {
            if (!lead.data_entrada) return;
            const current = monthMap.get(monthKey(new Date(lead.data_entrada)));
            if (current) current.leads += 1;
          });

          if (!metaQuery.error) {
            (metaQuery.data || []).forEach((row: any) => {
              if (!row.data) return;
              const current = monthMap.get(monthKey(new Date(`${row.data}T12:00:00`)));
              if (current) current.spend += Number(row.spend || 0);
            });
          }

          setMonthlyPerformance(Array.from(monthMap.values()));
        }
      } catch (err: unknown) {
        console.error("Dashboard general error:", err);
      } finally {
        setLoadingData(false);
      }
    }

    fetchCorretorData();
  }, [profile]);

  const firstName = profile?.nome ? profile.nome.split(' ')[0] : '';
  const isDataLoading = authLoading || loadingData;

  const timeOperacional = Array.isArray(corretorData?.time_operacional)
    ? corretorData.time_operacional
    : [];

  const staleOpportunityCount = stats.stale;
  const maxMetric = Math.max(stats.waiting, stats.inProgress, stats.quoted, stats.sold, 1);
  const performanceBars = [
    { label: 'Aguardando', value: stats.waiting, color: 'bg-purple-500' },
    { label: 'Em negociação', value: stats.inProgress, color: 'bg-orange-500' },
    { label: 'Cotações', value: stats.quoted, color: 'bg-indigo-500' },
    { label: 'Vendas', value: stats.sold, color: 'bg-emerald-500' },
  ];
  const maxMonthlyLeads = Math.max(...monthlyPerformance.map((month) => month.leads), 1);
  const maxMonthlySpend = Math.max(...monthlyPerformance.map((month) => month.spend), 1);
  const currentMonth = monthlyPerformance[monthlyPerformance.length - 1] || { leads: 0, spend: 0 };

  const quickActions = [
    { icon: Users, label: 'Planilha', desc: 'Veja todos os contatos recebidos.', href: '/leads', color: 'blue' },
    { icon: LayoutDashboard, label: 'Kanban Comercial', desc: 'Organize seus leads por etapa.', href: '/kanban', color: 'indigo' },
    { icon: Globe, label: 'Minha Página', desc: 'Acesse seu link de captação.', href: '/minha-pagina', color: 'purple' },
    { icon: HelpCircle, label: 'Ajuda Orion', desc: 'Solicite suporte ou alinhamento.', href: '/ajuda', color: 'slate' },
    { icon: GraduationCap, label: 'Treinamento', desc: 'Apoio para melhorar sua conversão.', href: '/ajuda?tipo=treinamento_comercial', color: 'green' },
    { icon: CalendarDays, label: 'Reunião Alinhamento', desc: 'Ajuste o perfil dos seus leads.', href: '/ajuda?tipo=alinhamento_leads', color: 'orange' },
  ];

  return (
    <InternalLayout>
      {/* Header Section */}
      <div className="mb-10 animate-in fade-in slide-in-from-top-4 duration-700">
        <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">
          {isDataLoading ? (
            <span className="inline-block w-48 h-10 bg-gray-100 animate-pulse rounded-lg" />
          ) : (
            `Olá, ${firstName} 👋`
          )}
        </h1>
        <p className="text-xl font-bold text-blue-600 mb-2">Bem-vindo ao ORION TRACK</p>
        <p className="text-gray-500 font-medium max-w-2xl">
          Por aqui você acompanha seus leads, organiza seu funil comercial e aciona a equipe da Orion sempre que precisar.
        </p>
      </div>

      {/* Intro Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        <div className="lg:col-span-2 bg-gradient-to-br from-blue-600 to-indigo-700 p-10 rounded-[2.5rem] text-white shadow-xl shadow-blue-600/20 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-700">
            <Sparkles size={120} />
          </div>
          <div className="relative z-10">
            <h2 className="text-2xl font-black mb-4">Seu painel comercial</h2>
            <p className="text-blue-100 font-medium text-lg mb-8 max-w-md">
              Veja seus leads, atualize a etapa de cada atendimento e acompanhe sua evolução comercial em tempo real.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/leads" className="bg-white text-blue-600 px-6 py-4 rounded-2xl font-black flex items-center gap-2 hover:bg-blue-50 transition-all shadow-lg">
                Ver meus leads <ArrowRight size={18} />
              </Link>
              <Link href="/kanban" className="bg-blue-500/30 text-white border border-white/20 backdrop-blur-md px-6 py-4 rounded-2xl font-black flex items-center gap-2 hover:bg-blue-500/40 transition-all">
                Abrir Kanban
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-600 mb-4 font-black text-xs uppercase tracking-widest">
              <Info size={14} /> Como usar seu painel
            </div>
            <ul className="space-y-4">
              {[
                'Veja seus novos leads em Planilha',
                'Atualize a etapa no Kanban Comercial',
                'Solicite apoios na área Ajuda Orion',
                'Acesse sua LP em Minha Página'
              ].map((text, i) => (
                <li key={i} className="flex gap-3 text-sm font-bold text-gray-600">
                  <div className="w-5 h-5 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0 text-[10px]">
                    {i+1}
                  </div>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mb-12 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1.8fr]">
        <div className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Resumo deste mês</p>
              <h2 className="text-2xl font-black text-gray-950">Perfil comercial</h2>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <BarChart3 size={24} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniMetric icon={Users} label="Leads no mês" value={currentMonth.leads} />
            <MiniMetric icon={DollarSign} label="Investido no mês" value={formatCurrency(currentMonth.spend)} />
            <MiniMetric icon={Clock} label="Em negociação" value={stats.inProgress} />
            <MiniMetric icon={TrendingUp} label="Vendas" value={stats.sold} />
          </div>
          <div className="mt-5 rounded-2xl bg-slate-50 p-4">
            <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Corretor</p>
            <p className="text-sm font-black text-gray-900">{corretorData?.nome || profile?.nome || '-'}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">{corretorData?.email || profile?.email || '-'}</p>
          </div>
        </div>

        <div className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col justify-between gap-2 md:flex-row md:items-end">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Crescimento mensal</p>
              <h2 className="text-2xl font-black text-gray-950">Investimento Meta x leads</h2>
            </div>
            <p className="text-xs font-bold text-slate-400">Últimos 6 meses</p>
          </div>
          <div className="grid min-h-72 grid-cols-6 items-end gap-3">
            {monthlyPerformance.map((month) => (
              <div key={month.key} className="flex h-full flex-col justify-end gap-3">
                <div className="flex h-48 items-end gap-1.5 rounded-2xl bg-slate-50 px-2 pb-2">
                  <div className="flex flex-1 flex-col items-center justify-end">
                    <div
                      className="w-full rounded-t-lg bg-blue-600"
                      style={{ height: `${Math.max((month.spend / maxMonthlySpend) * 100, month.spend > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-end">
                    <div
                      className="w-full rounded-t-lg bg-emerald-500"
                      style={{ height: `${Math.max((month.leads / maxMonthlyLeads) * 100, month.leads > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs font-black uppercase text-slate-700">{month.label}</p>
                  <p className="mt-1 text-[10px] font-bold text-blue-600">{formatCurrency(month.spend)}</p>
                  <p className="text-[10px] font-bold text-emerald-600">{month.leads} leads</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3 text-[11px] font-black uppercase tracking-widest">
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-blue-700"><span className="h-2 w-2 rounded-full bg-blue-600" /> Investimento</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Leads</span>
          </div>
        </div>
      </div>

      {/* Metrics Section */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-xl font-black text-gray-900 tracking-tight">Desempenho Geral</h2>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          <Link href="/leads"><StatCard title="Leads recebidos" value={stats.total} icon={Users} color="blue" loading={isDataLoading} /></Link>
          <Link href="/leads?status=Aguardando atendimento"><StatCard title="Aguardando" value={stats.waiting} icon={Target} color="purple" loading={isDataLoading} /></Link>
          <Link href="/leads?status=Em negociação"><StatCard title="Em negociação" value={stats.inProgress} icon={Clock} color="orange" loading={isDataLoading} /></Link>
          <Link href="/leads?status=Cotação enviada"><StatCard title="Cotações enviadas" value={stats.quoted} icon={Send} color="indigo" loading={isDataLoading} /></Link>
          <Link href="/leads?status=Venda realizada"><StatCard title="Vendas realizadas" value={stats.sold} icon={TrendingUp} color="green" loading={isDataLoading} /></Link>
        </div>
      </div>

      <div className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
          <h3 className="mb-6 text-sm font-black uppercase tracking-widest text-gray-900">Distribuição por etapa</h3>
          <div className="space-y-4">
            {performanceBars.map((bar) => (
              <div key={bar.label}>
                <div className="mb-2 flex justify-between text-xs font-bold text-gray-500">
                  <span>{bar.label}</span>
                  <span>{bar.value}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${(bar.value / maxMetric) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <Link href="/leads?status=Aguardando atendimento" className="rounded-[2rem] border border-amber-100 bg-amber-50 p-6 transition-all hover:bg-amber-100">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-amber-600 shadow-sm">
            <AlertTriangle size={24} />
          </div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-amber-700">Necessita atenção</p>
          <h3 className="text-2xl font-black text-amber-950">{staleOpportunityCount} oportunidades sem resposta</h3>
          <p className="mt-3 text-sm font-bold leading-relaxed text-amber-800">
            Priorize leads novos. A regra ideal é responder em até 20 minutos para aumentar a chance de contato.
          </p>
        </Link>
      </div>

      {/* Quick Actions Grid */}
      <div className="mb-16">
        <h2 className="text-xl font-black text-gray-900 mb-8 flex items-center gap-2">
          Ações rápidas
          <div className="h-px flex-1 bg-gray-100 ml-2" />
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action, idx) => (
            <Link 
              key={idx} 
              href={action.href}
              className="group bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all duration-500 flex flex-col justify-between h-64"
            >
              <div className="flex justify-between items-start">
                <div className="p-4 bg-slate-50 text-blue-600 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 transform group-hover:scale-110 shadow-inner">
                  <action.icon size={28} />
                </div>
                <ArrowRight size={20} className="text-gray-300 group-hover:text-blue-600 transition-colors" />
              </div>
              <div>
                <h3 className="text-xl font-black text-gray-900 mb-2">{action.label}</h3>
                <p className="text-sm text-gray-500 font-medium leading-relaxed">{action.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Your Orion Team */}
      <div className="bg-slate-50 p-10 rounded-[3rem] border border-gray-100 mb-10">
        <div className="mb-8">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight mb-2">Seu time Orion</h2>
          <p className="text-gray-500 font-medium">Essas são as pessoas da Orion responsáveis por acompanhar sua operação.</p>
        </div>

        {isDataLoading ? (
          <div className="flex gap-4">
             <div className="w-32 h-32 bg-white rounded-3xl animate-pulse" />
             <div className="w-32 h-32 bg-white rounded-3xl animate-pulse" />
          </div>
        ) : timeOperacional.length === 0 ? (
          <div className="bg-white p-8 rounded-[2rem] border border-gray-100 text-center">
             <p className="text-gray-500 font-bold italic">Seu time operacional ainda não foi definido. Fale com a Orion.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {timeOperacional.map((membro, index: number) => {
              const foto = getTeamMemberPhoto(membro.nome);

              return (
                <div key={`${membro.nome}-${index}`} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center group hover:scale-105 transition-all duration-500 hover:shadow-xl hover:border-blue-100">
                  <div className="w-24 h-24 mb-4 relative">
                    {foto ? (
                      <img 
                        src={foto} 
                        alt={membro.nome}
                        className="w-full h-full rounded-2xl object-cover shadow-md group-hover:rotate-3 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg group-hover:rotate-6 transition-transform">
                        {membro.nome?.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <h3 className="font-black text-gray-900 mb-1 leading-tight">{membro.nome}</h3>
                  <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{membro.cargo}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </InternalLayout>
  );
}

function MiniMetric({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-blue-600">
        <Icon size={17} />
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black text-gray-950">{value}</p>
    </div>
  );
}
