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
  Info,
  AlertTriangle,
  type LucideIcon
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getTeamMemberPhoto } from '@/lib/orionTeam';
import OrionMark from '@/components/ui/OrionMark';

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
  cidade?: string | null;
  valor_negociacao?: string | number | null;
  valor_comissao?: string | number | null;
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

function monthRange(key: string) {
  const [year, month] = key.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  return {
    since: firstDay.toISOString().slice(0, 10),
    until: lastDay.toISOString().slice(0, 10),
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function parseCurrencyValue(value?: string | number | null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(,|$))/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCompactMetric(value: number) {
  if (value >= 1000) {
    const compact = value / 1000;
    return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1).replace('.', ',')}K`;
  }

  return String(value || 0);
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getLastDays(total = 7) {
  const now = new Date();
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (total - 1 - index));
    return {
      key: dayKey(date),
      label: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      leads: 0,
    };
  });
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
    soldThisMonth: 0,
    stale: 0,
    lost: 0,
    revenueRealized: 0,
    revenuePotential: 0
  });
  const [monthlyPerformance, setMonthlyPerformance] = useState<MonthlyPerformance[]>(getLastMonths());
  const [weeklyLeads, setWeeklyLeads] = useState(getLastDays());
  const [topCities, setTopCities] = useState<Array<{ city: string; leads: number }>>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [chartHovering, setChartHovering] = useState(false);

  useEffect(() => {
    async function fetchCorretorData() {
      if (!profile || !['corretor', 'corretor_membro'].includes(profile.tipo_usuario)) {
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
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        let statsRequest = supabase
          .from('leads')
          .select('status, data_entrada, cidade, valor_negociacao, valor_comissao')
          .eq('corretor_id', profile.corretor_id);

        if (profile.tipo_usuario === 'corretor_membro') {
          statsRequest = statsRequest.eq('responsavel_profile_id', profile.id);
        }

        const statsQuery = await statsRequest;

        if (statsQuery.error) throw statsQuery.error;

        if (statsQuery.data) {
          const statsRes = statsQuery.data as LeadMetricRow[];
          const thisMonthKey = monthKey(new Date());
          const soldLeads = statsRes.filter(l => l.status === 'Venda realizada');
          const lostLeads = statsRes.filter(l => l.status === 'Sem interesse');
          const activeRevenueStatuses = ['Em negociação', 'Cotação enviada', 'Contato feito', 'Aguardando atendimento'];
          setStats({
            total: statsRes.length,
            waiting: statsRes.filter(l => l.status === 'Aguardando atendimento').length,
            inProgress: statsRes.filter(l => l.status === 'Em negociação').length,
            quoted: statsRes.filter(l => l.status === 'Cotação enviada').length,
            sold: soldLeads.length,
            soldThisMonth: statsRes.filter(l => l.status === 'Venda realizada' && l.data_entrada && monthKey(new Date(l.data_entrada)) === thisMonthKey).length,
            stale: statsRes.filter(l => {
              if (l.status !== 'Aguardando atendimento' || !l.data_entrada) return false;
              return Date.now() - new Date(l.data_entrada).getTime() > 20 * 60 * 1000;
            }).length,
            lost: lostLeads.length,
            revenueRealized: soldLeads.reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_comissao), 0),
            revenuePotential: statsRes
              .filter((lead) => activeRevenueStatuses.includes(String(lead.status || '')))
              .reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_comissao), 0)
          });

          const months = getLastMonths();
          const monthMap = new Map(months.map((month) => [month.key, { ...month }]));

          statsRes.forEach((lead) => {
            if (!lead.data_entrada) return;
            const current = monthMap.get(monthKey(new Date(lead.data_entrada)));
            if (current) current.leads += 1;
          });

          const days = getLastDays();
          const dayMap = new Map(days.map((day) => [day.key, { ...day }]));
          statsRes.forEach((lead) => {
            if (!lead.data_entrada) return;
            const current = dayMap.get(dayKey(new Date(lead.data_entrada)));
            if (current) current.leads += 1;
          });
          setWeeklyLeads(Array.from(dayMap.values()));

          const cityMap = new Map<string, number>();
          statsRes.forEach((lead) => {
            const city = String(lead.cidade || '').trim();
            if (!city || city === '-') return;
            cityMap.set(city, (cityMap.get(city) || 0) + 1);
          });
          setTopCities(
            Array.from(cityMap.entries())
              .map(([city, leads]) => ({ city, leads }))
              .sort((a, b) => b.leads - a.leads || a.city.localeCompare(b.city))
              .slice(0, 5)
          );

          if (accessToken) {
            const spendResults = await Promise.all(
              months.map(async (month) => {
                const range = monthRange(month.key);

                try {
                  const response = await fetch('/api/integrations/meta/spend', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({
                      corretor_id: profile.corretor_id,
                      data_inicio: range.since,
                      data_fim: range.until,
                    }),
                  });

                  const payload = await response.json();
                  return {
                    key: month.key,
                    spend: response.ok ? Number(payload.spend || 0) : 0,
                  };
                } catch (error) {
                  console.error('Erro ao buscar investimento Meta do mes:', month.key, error);
                  return { key: month.key, spend: 0 };
                }
              })
            );

            spendResults.forEach((result) => {
              const current = monthMap.get(result.key);
              if (current) current.spend = result.spend;
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
  const currentMonthCpl = currentMonth.leads > 0 ? currentMonth.spend / currentMonth.leads : 0;
  const currentMonthConversion = currentMonth.leads > 0 ? (stats.soldThisMonth / currentMonth.leads) * 100 : 0;
  const salesConversionBase = stats.sold + stats.lost;
  const salesConversionRate = salesConversionBase > 0 ? (stats.sold / salesConversionBase) * 100 : 0;
  const chartHeight = 176;
  const maxWeeklyLeads = Math.max(...weeklyLeads.map((day) => day.leads), 1);
  const weeklyTotal = weeklyLeads.reduce((sum, day) => sum + day.leads, 0);
  const bestWeeklyDay = weeklyLeads.reduce((best, day) => day.leads > best.leads ? day : best, weeklyLeads[0] || { label: '-', leads: 0 });
  const maxCityLeads = Math.max(...topCities.map((city) => city.leads), 1);
  const activePipeline = stats.waiting + stats.inProgress + stats.quoted + stats.sold;
  const funnelMax = Math.max(stats.total, activePipeline, stats.quoted + stats.sold, stats.sold, 1);
  const funnelSteps = [
    {
      name: 'Leads',
      value: stats.total,
      detail: 'entradas captadas',
      href: '/leads',
      path: 'M54 96 C92 50 424 50 466 96 C452 146 431 191 411 224 C348 248 172 248 109 224 C88 190 67 146 54 96Z',
      labelY: 132,
      valueY: 169,
      detailY: 199,
      fill: 'url(#funnelTopGradient)',
    },
    {
      name: 'Atendimento',
      value: activePipeline,
      detail: 'em funil comercial',
      href: '/leads?status=Aguardando%20atendimento',
      path: 'M112 232 C176 254 344 254 408 232 C392 285 371 337 341 386 C291 403 229 403 179 386 C149 337 128 285 112 232Z',
      labelY: 284,
      valueY: 322,
      detailY: 352,
      fill: 'url(#funnelMiddleGradient)',
    },
    { label: 'Proposta', name: 'Cotação', value: stats.quoted + stats.sold, detail: 'propostas e vendas', color: '#5868ff', glow: 'rgba(99, 102, 241, 0.34)', width: Math.max(((stats.quoted + stats.sold) / funnelMax) * 100, 46) },
    { label: 'Fundo', name: 'Vendas', value: stats.sold, detail: 'conversões fechadas', color: '#10c7b0', glow: 'rgba(20, 184, 166, 0.36)', width: Math.max((stats.sold / funnelMax) * 100, stats.sold > 0 ? 30 : 24) },
  ];
  const visualFunnelSteps = [
    {
      name: 'Leads',
      value: stats.total,
      detail: 'entradas captadas',
      href: '/leads',
      path: 'M54 96 C92 50 424 50 466 96 C452 146 431 191 411 224 C348 248 172 248 109 224 C88 190 67 146 54 96Z',
      labelY: 132,
      valueY: 169,
      detailY: 199,
      fill: 'url(#funnelTopGradient)',
    },
    {
      name: 'Atendimento',
      value: activePipeline,
      detail: 'em funil comercial',
      href: '/leads?status=Aguardando%20atendimento',
      path: 'M112 232 C176 254 344 254 408 232 C392 285 371 337 341 386 C291 403 229 403 179 386 C149 337 128 285 112 232Z',
      labelY: 284,
      valueY: 322,
      detailY: 352,
      fill: 'url(#funnelMiddleGradient)',
    },
    {
      name: 'Cotação',
      value: stats.quoted + stats.sold,
      detail: 'propostas e vendas',
      href: '/leads?status=Cota%C3%A7%C3%A3o%20enviada',
      path: 'M182 398 C231 415 289 415 338 398 C323 447 307 490 289 524 C270 531 250 531 231 524 C213 490 197 447 182 398Z',
      labelY: 442,
      valueY: 477,
      detailY: 505,
      fill: 'url(#funnelQuoteGradient)',
    },
    {
      name: 'Vendas',
      value: stats.sold,
      detail: 'conversões fechadas',
      href: '/leads?status=Venda%20realizada',
      path: 'M232 535 C250 542 270 542 288 535 C281 572 273 598 260 611 C247 598 239 572 232 535Z',
      labelY: 560,
      valueY: 586,
      detailY: 606,
      fill: 'url(#funnelSalesGradient)',
    },
  ];
  const quoteRate = stats.total > 0 ? ((stats.quoted + stats.sold) / stats.total) * 100 : 0;
  const salesRate = stats.total > 0 ? (stats.sold / stats.total) * 100 : 0;

  const quickActions = [
    { icon: Users, label: 'Leads', desc: 'Veja todos os contatos recebidos.', href: '/leads', color: 'blue' },
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
        <h1 className="mb-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
          {isDataLoading ? (
            <span className="inline-block w-48 h-10 bg-gray-100 animate-pulse rounded-lg" />
          ) : (
            `Olá, ${firstName}`
          )}
        </h1>
        <p className="mb-2 text-lg font-bold text-blue-600 sm:text-xl">Seu centro de vendas Orion está pronto para acelerar seus resultados</p>
        <p className="max-w-2xl text-sm font-medium leading-relaxed text-gray-500 sm:text-base">
          Acompanhe seus leads, avance cada negociação e transforme oportunidades em comissão com mais controle, velocidade e clareza.
        </p>
      </div>

      {/* Intro Card */}
      <div className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="group relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-blue-600 to-indigo-700 p-6 text-white shadow-xl shadow-blue-600/20 sm:rounded-[2.5rem] sm:p-10 lg:col-span-2">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-700">
            <OrionMark size={70} variant="light" />
          </div>
          <div className="relative z-10">
            <h2 className="mb-4 text-2xl font-black">Seu painel comercial</h2>
            <p className="mb-8 max-w-md text-base font-medium text-blue-100 sm:text-lg">
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

        <div className="flex flex-col justify-between rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm sm:rounded-[2.5rem] sm:p-8">
          <div>
            <div className="flex items-center gap-2 text-blue-600 mb-4 font-black text-xs uppercase tracking-widest">
              <Info size={14} /> Como usar seu painel
            </div>
            <ul className="space-y-4">
              {[
                'Veja seus novos leads',
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

      <div className="mb-12 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/10 dark-dashboard-panel sm:rounded-[2rem]">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 p-5 text-white sm:p-7">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">Overview comercial</p>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Funil Orion Track</h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-blue-100">
                Uma visão executiva do caminho do lead: entrada, atendimento, cotação e venda.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">CPL mês</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(currentMonthCpl)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Cotação</p>
                <p className="mt-1 text-lg font-black">{quoteRate.toFixed(1).replace('.', ',')}%</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Venda</p>
                <p className="mt-1 text-lg font-black">{salesRate.toFixed(1).replace('.', ',')}%</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Comissão</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(stats.revenueRealized)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[1.5rem] border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm dark-dashboard-inner sm:p-6">
            <div className="mb-5 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
                <Target size={24} />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-600">Funil comercial</p>
                <h3 className="text-2xl font-black tracking-tight text-gray-950">Performance por etapa</h3>
              </div>
            </div>

            <div className="orion-traffic-funnel mx-auto py-2">
              <svg viewBox="0 0 840 640" role="img" aria-label="Funil comercial Orion Track">
                <defs>
                  <linearGradient id="funnelTopGradient" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#33d4ff" />
                    <stop offset="48%" stopColor="#0789f6" />
                    <stop offset="100%" stopColor="#0754c7" />
                  </linearGradient>
                  <linearGradient id="funnelMiddleGradient" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#21d7f7" />
                    <stop offset="58%" stopColor="#0799c8" />
                    <stop offset="100%" stopColor="#047093" />
                  </linearGradient>
                  <linearGradient id="funnelQuoteGradient" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#7da8ff" />
                    <stop offset="52%" stopColor="#5167ff" />
                    <stop offset="100%" stopColor="#3145c9" />
                  </linearGradient>
                  <linearGradient id="funnelSalesGradient" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#38ffe0" />
                    <stop offset="55%" stopColor="#0ac3b0" />
                    <stop offset="100%" stopColor="#078479" />
                  </linearGradient>
                  <radialGradient id="funnelMouthGradient" cx="50%" cy="45%" r="60%">
                    <stop offset="0%" stopColor="#06243c" stopOpacity="0.72" />
                    <stop offset="58%" stopColor="#0b8fe8" stopOpacity="0.42" />
                    <stop offset="100%" stopColor="#77dcff" stopOpacity="0.92" />
                  </radialGradient>
                  <linearGradient id="funnelSideShine" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                    <stop offset="42%" stopColor="#ffffff" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </linearGradient>
                  <filter id="orionFunnelShadow" x="-20%" y="-15%" width="140%" height="130%">
                    <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#00284d" floodOpacity="0.34" />
                  </filter>
                  <filter id="orionFunnelLift" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="24" stdDeviation="18" floodColor="#0ea5e9" floodOpacity="0.42" />
                  </filter>
                </defs>

                <g filter="url(#orionFunnelShadow)">
                  <ellipse className="orion-funnel-mouth" cx="260" cy="96" rx="206" ry="42" fill="url(#funnelMouthGradient)" />
                  <ellipse cx="260" cy="98" rx="132" ry="20" fill="#05233a" opacity="0.48" />
                  {visualFunnelSteps.map((step) => (
                    <a key={step.name} href={step.href} aria-label={`Abrir leads em ${step.name}`}>
                      <path className="orion-traffic-band" d={step.path} fill={step.fill} />
                    </a>
                  ))}
                  <path className="orion-funnel-side-highlight" d="M392 93 C368 181 336 302 300 415 C286 457 279 503 265 589 C315 526 363 326 425 126 C417 112 405 101 392 93Z" fill="url(#funnelSideShine)" opacity="0.78" />
                  <path className="orion-funnel-left-depth" d="M86 122 C111 229 166 377 242 608 C207 525 161 378 108 224 C96 202 76 150 86 122Z" fill="#003c75" opacity="0.20" />
                </g>

                {visualFunnelSteps.map((step) => (
                  <g key={`${step.name}-value`} className="orion-traffic-text">
                    <text x="260" y={step.valueY} className="orion-traffic-value">{formatCompactMetric(step.value)}</text>
                  </g>
                ))}

                {visualFunnelSteps.map((step, index) => {
                  const connectorY = [150, 312, 468, 578][index];
                  const startX = [438, 390, 326, 286][index];
                  return (
                    <g key={`${step.name}-side`} className="orion-traffic-side">
                      <line x1={startX} y1={connectorY} x2="548" y2={connectorY} className="orion-traffic-connector" />
                      <circle cx={startX} cy={connectorY} r="6" className="orion-traffic-node" />
                      <rect x="562" y={connectorY - 38} width="238" height="70" rx="18" className="orion-traffic-label-card" />
                      <text x="586" y={connectorY - 9} className="orion-traffic-side-label">{step.name}</text>
                      <text x="586" y={connectorY + 18} className="orion-traffic-side-detail">{step.detail}</text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="hidden">
              {(funnelSteps as any[]).map((step, index) => (
                <Link
                  key={step.name}
                  href={index === 0 ? '/leads' : `/leads?status=${encodeURIComponent(index === 1 ? 'Aguardando atendimento' : index === 2 ? 'Cotação enviada' : 'Venda realizada')}`}
                  className="orion-funnel-slice group"
                  style={{
                    width: `${step.width}%`,
                    ['--slice-color' as string]: step.color,
                    ['--slice-glow' as string]: step.glow,
                  }}
                >
                  <span className="orion-funnel-rim" />
                  <span className="orion-funnel-shine" />
                  <div className="orion-funnel-content">
                    <p className="text-sm font-black uppercase tracking-[0.22em] text-white">{step.name}</p>
                    <p className="text-4xl font-black leading-none text-white drop-shadow">{step.value}</p>
                    <p className="mt-1 text-[11px] font-bold text-white/80">{step.detail}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            {[
              { label: 'Sem resposta', value: staleOpportunityCount, hint: 'precisam de atenção rápida', color: 'bg-amber-50 text-amber-700 border-amber-100', icon: AlertTriangle },
              { label: 'Em negociação', value: stats.inProgress, hint: 'leads em conversa ativa', color: 'bg-blue-50 text-blue-700 border-blue-100', icon: Clock },
              { label: 'Comissão prevista', value: formatCurrency(stats.revenuePotential), hint: 'estimativa dos leads ativos', color: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: TrendingUp },
            ].map((item) => (
              <div key={item.label} className={`group rounded-[1.5rem] border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${item.color}`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-80">{item.label}</p>
                    <p className="mt-2 text-3xl font-black">{item.value}</p>
                    <p className="mt-1 text-xs font-bold opacity-80">{item.hint}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/75 transition-transform duration-300 group-hover:scale-110">
                    <item.icon size={22} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-12 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1.8fr]">
        <div className="rounded-[1.5rem] border border-gray-100 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
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
            <MiniMetric icon={Target} label="CPL do mês" value={formatCurrency(currentMonthCpl)} />
            <MiniMetric icon={TrendingUp} label="Conversão mês" value={`${currentMonthConversion.toFixed(1).replace('.', ',')}%`} />
            <MiniMetric icon={Clock} label="Em negociação" value={stats.inProgress} />
            <MiniMetric icon={TrendingUp} label="Vendas" value={stats.sold} />
          </div>
          <div className="mt-5 rounded-2xl bg-slate-50 p-4">
            <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Corretor</p>
            <p className="text-sm font-black text-gray-900">{corretorData?.nome || profile?.nome || '-'}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">{corretorData?.email || profile?.email || '-'}</p>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-gray-100 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
          <div className="mb-6 flex flex-col justify-between gap-2 md:flex-row md:items-end">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Crescimento mensal</p>
              <h2 className="text-2xl font-black text-gray-950">Investimento Meta x leads</h2>
            </div>
            <p className="text-xs font-bold text-slate-400">Últimos 6 meses</p>
          </div>
          <div
            className="scrollbar-visible grid min-h-72 grid-cols-6 items-end gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(6,minmax(86px,1fr))]"
            onMouseEnter={() => setChartHovering(true)}
            onMouseLeave={() => setChartHovering(false)}
          >
            {monthlyPerformance.map((month, index) => (
              <div key={month.key} className="group/month flex h-full flex-col justify-end gap-3">
                <div className="flex h-48 items-end gap-1.5 rounded-2xl bg-slate-50 px-2 pb-2 transition-all duration-300 group-hover/month:-translate-y-1 group-hover/month:bg-blue-50/60 group-hover/month:shadow-lg group-hover/month:shadow-blue-500/10">
                  <div className="flex flex-1 flex-col items-center justify-end">
                    <div
                      className="dashboard-month-bar w-full rounded-t-lg bg-gradient-to-t from-blue-700 to-blue-400 shadow-sm shadow-blue-500/20 group-hover/month:shadow-lg group-hover/month:shadow-blue-500/30"
                      style={{
                        ['--bar-height' as string]: `${Math.max((month.spend / maxMonthlySpend) * chartHeight, month.spend > 0 ? 14 : 0)}px`,
                        ['--bar-delay' as string]: `${index * 90}ms`,
                        height: `${Math.max((month.spend / maxMonthlySpend) * chartHeight, month.spend > 0 ? 14 : 0)}px`,
                        transform: chartHovering ? 'scaleY(1.08)' : 'scaleY(1)',
                        transitionDelay: chartHovering ? `${index * 90}ms` : '0ms',
                      }}
                    />
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-end">
                    <div
                      className="dashboard-month-bar w-full rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-300 shadow-sm shadow-emerald-500/20 group-hover/month:shadow-lg group-hover/month:shadow-emerald-500/30"
                      style={{
                        ['--bar-height' as string]: `${Math.max((month.leads / maxMonthlyLeads) * chartHeight, month.leads > 0 ? 14 : 0)}px`,
                        ['--bar-delay' as string]: `${index * 90 + 45}ms`,
                        height: `${Math.max((month.leads / maxMonthlyLeads) * chartHeight, month.leads > 0 ? 14 : 0)}px`,
                        transform: chartHovering ? 'scaleY(1.08)' : 'scaleY(1)',
                        transitionDelay: chartHovering ? `${index * 90 + 45}ms` : '0ms',
                      }}
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

      <div className="mb-12 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-sm font-black text-gray-900">Taxa de Conversão</p>
            <Target size={18} className="text-slate-500" />
          </div>
          <p className="text-3xl font-black text-gray-950">{salesConversionRate.toFixed(1).replace('.', ',')}%</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold">
            <span className="text-emerald-600">✓ {stats.sold} vendas</span>
            <span className="text-red-500">⊗ {stats.lost} perdidos</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-sm font-black text-gray-900">Comissão vendida</p>
            <DollarSign size={18} className="text-slate-500" />
          </div>
          <p className="text-3xl font-black text-gray-950">{formatCurrency(stats.revenueRealized)}</p>
          <p className="mt-2 text-xs font-bold text-emerald-600">comissão das vendas realizadas</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-sm font-black text-gray-900">Comissão prevista</p>
            <TrendingUp size={18} className="text-slate-500" />
          </div>
          <p className="text-3xl font-black text-gray-950">{formatCurrency(stats.revenuePotential)}</p>
          <p className="mt-2 text-xs font-bold text-slate-500">estimativa dos leads ativos</p>
        </div>
      </div>

      <div className="mb-12 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-[1.5rem] border border-gray-100 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Últimos 7 dias</p>
              <h2 className="text-2xl font-black text-gray-950">Ritmo de entrada</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">Volume diário de leads recebidos.</p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-5 py-3 text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Total</p>
              <p className="text-3xl font-black text-blue-700">{weeklyTotal}</p>
              <p className="text-[11px] font-bold text-blue-500">leads na semana</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_170px]">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
              <div className="flex h-56 items-end gap-2 sm:gap-3">
                {weeklyLeads.map((day) => {
                  const height = Math.max((day.leads / maxWeeklyLeads) * 100, day.leads > 0 ? 14 : 5);
                  const isBest = day.key === bestWeeklyDay.key && day.leads > 0;

                  return (
                    <div key={day.key} className="group/day flex min-w-0 flex-1 flex-col items-center gap-3">
                      <div className="relative flex h-44 w-full items-end justify-center rounded-2xl bg-white px-2 py-2">
                        <div
                          className={`dashboard-week-bar w-full max-w-10 rounded-xl group-hover/day:shadow-lg ${
                            isBest
                              ? 'bg-gradient-to-t from-blue-700 to-cyan-400 shadow-lg shadow-blue-500/25'
                              : 'bg-gradient-to-t from-blue-500 to-blue-300'
                          }`}
                          style={{
                            ['--bar-height' as string]: `${height}%`,
                            ['--bar-delay' as string]: `${weeklyLeads.indexOf(day) * 70}ms`,
                            height: `${height}%`
                          }}
                        />
                        <div className="pointer-events-none absolute -top-3 rounded-xl border border-slate-100 bg-white px-2 py-1 text-[10px] font-black text-slate-700 opacity-0 shadow-sm transition-opacity group-hover/day:opacity-100">
                          {day.leads} leads
                        </div>
                      </div>
                      <span className="text-[10px] font-black text-slate-500 sm:text-xs">{day.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl bg-slate-950 p-4 text-white">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Melhor dia</p>
                <p className="text-2xl font-black">{bestWeeklyDay.label}</p>
                <p className="mt-1 text-sm font-bold text-blue-200">{bestWeeklyDay.leads} leads</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Média/dia</p>
                <p className="text-2xl font-black text-gray-950">
                  {(weeklyTotal / Math.max(weeklyLeads.length, 1)).toFixed(1).replace('.', ',')}
                </p>
                <p className="mt-1 text-xs font-bold text-slate-500">leads por dia</p>
              </div>
              <Link href="/leads" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-700">
                Ver leads <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-gray-100 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Ranking</p>
              <h2 className="text-2xl font-black text-gray-950">Top 5 Cidades</h2>
            </div>
            <p className="text-xs font-bold text-slate-400">Por volume de leads</p>
          </div>
          <div className="space-y-5">
            {topCities.length > 0 ? topCities.map((city, index) => (
              <div key={`${city.city}-${index}`} className="group/city">
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-7 shrink-0 text-xs font-bold text-slate-400">#{index + 1}</span>
                    <span className="truncate font-black text-gray-900">{city.city}</span>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-slate-500">{city.leads} leads</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="dashboard-progress-bar h-full rounded-full bg-blue-600 transition-all duration-500 group-hover/city:bg-gradient-to-r group-hover/city:from-blue-500 group-hover/city:to-cyan-400 group-hover/city:shadow-lg group-hover/city:shadow-blue-500/25"
                    style={{
                      ['--bar-width' as string]: `${Math.max((city.leads / maxCityLeads) * 100, 8)}%`,
                      ['--bar-delay' as string]: `${index * 80}ms`,
                      width: `${Math.max((city.leads / maxCityLeads) * 100, 8)}%`
                    }}
                  />
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sem cidades registradas</p>
              </div>
            )}
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
            {performanceBars.map((bar, index) => (
              <div key={bar.label} className="group/stage">
                <div className="mb-2 flex justify-between text-xs font-bold text-gray-500">
                  <span>{bar.label}</span>
                  <span>{bar.value}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`dashboard-progress-bar h-full rounded-full ${bar.color} transition-all duration-500 group-hover/stage:brightness-110 group-hover/stage:shadow-lg`}
                    style={{
                      ['--bar-width' as string]: `${(bar.value / maxMetric) * 100}%`,
                      ['--bar-delay' as string]: `${index * 90}ms`,
                      width: `${(bar.value / maxMetric) * 100}%`
                    }}
                  />
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
              className="group flex min-h-48 flex-col justify-between rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm transition-all duration-500 hover:border-blue-200 hover:shadow-xl sm:h-64 sm:rounded-[2.5rem] sm:p-8"
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
      <div className="mb-10 rounded-[2rem] border border-gray-100 bg-slate-50 p-5 sm:rounded-[3rem] sm:p-10">
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

function MiniMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | string }) {
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
