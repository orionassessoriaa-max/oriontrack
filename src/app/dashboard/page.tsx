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
  Loader2,
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
    salesRealized: 0,
    salesPotential: 0
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

        let allStats: LeadMetricRow[] = [];
        let pageNum = 0;
        const limitNum = 1000;
        let keepFetching = true;

        while (keepFetching) {
          const from = pageNum * limitNum;
          const to = from + limitNum - 1;
          let statsRequest = supabase
            .from('leads')
            .select('status, data_entrada, cidade, valor_negociacao, valor_comissao')
            .eq('corretor_id', profile.corretor_id)
            .range(from, to);

          if (profile.tipo_usuario === 'corretor_membro') {
            statsRequest = statsRequest.eq('responsavel_profile_id', profile.id);
          }

          const statsQuery = await statsRequest;

          if (statsQuery.error) throw statsQuery.error;

          const dataRows = statsQuery.data || [];
          allStats = [...allStats, ...(dataRows as LeadMetricRow[])];

          if (dataRows.length < limitNum) {
            keepFetching = false;
          } else {
            pageNum += 1;
          }
        }

        const statsRes = allStats;
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
          salesRealized: soldLeads.reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_negociacao), 0),
          salesPotential: statsRes
            .filter((lead) => activeRevenueStatuses.includes(String(lead.status || '')))
            .reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_negociacao), 0)
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
  const salesConversionRate = stats.total > 0 ? (stats.sold / stats.total) * 100 : 0;
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
      <div className="mb-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-700">
        <div>
          <h1 className="mb-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
            {isDataLoading ? (
              <span className="inline-block w-48 h-10 bg-gray-100 animate-pulse rounded-lg" />
            ) : (
              `Olá, ${firstName}`
            )}
          </h1>
          <p className="text-base font-bold text-blue-600 sm:text-lg">Painel de crescimento comercial e aceleração de vendas</p>
        </div>
        <div className="flex gap-3 shrink-0">
          <Link href="/leads" className="bg-blue-600 text-white px-5 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-500/20 text-xs sm:text-sm">
            Ver meus leads <ArrowRight size={16} />
          </Link>
          <Link href="/kanban" className="bg-white/5 text-white border border-white/5 px-5 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-white/10 transition-all text-xs sm:text-sm">
            Abrir Kanban
          </Link>
        </div>
      </div>

      {/* 🚀 STEP 1: KEY NUMBERS AT THE VERY TOP (Swapped General Performance StatCards here!) */}
      <div className="mb-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Link href="/leads">
            <StatCard title="Leads recebidos" value={stats.total} icon={Users} color="blue" loading={isDataLoading} />
          </Link>
          <Link href="/leads?status=Aguardando atendimento">
            <StatCard title="Aguardando" value={stats.waiting} icon={Target} color="purple" loading={isDataLoading} />
          </Link>
          <Link href="/leads?status=Em negociação">
            <StatCard title="Em negociação" value={stats.inProgress} icon={Clock} color="orange" loading={isDataLoading} />
          </Link>
          <Link href="/leads?status=Cotação enviada">
            <StatCard title="Cotações enviadas" value={stats.quoted} icon={Send} color="indigo" loading={isDataLoading} />
          </Link>
          <Link href="/leads?status=Venda realizada">
            <StatCard title="Vendas realizadas" value={stats.sold} icon={TrendingUp} color="green" loading={isDataLoading} />
          </Link>
        </div>
      </div>

      {/* 🚀 STEP 2: THE GORGEOUS 2-COLUMN MAIN CHARTS SECTION */}
      <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Column 1: SVG Curved Area Growth Chart (Meta Ads x Leads Growth) */}
        <div className="rounded-[1.5rem] border border-slate-100 bg-[#090e1a] p-5 shadow-xl sm:rounded-[2rem] sm:p-6 lg:col-span-3">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400">Evolução Mensal</p>
              <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">Investimento Meta x Leads</h2>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Últimos 6 meses</p>
              <div className="mt-1.5 flex items-center gap-4 text-[10px] font-extrabold uppercase">
                <span className="flex items-center gap-1.5 text-cyan-400">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" /> Investimento
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Leads
                </span>
              </div>
            </div>
          </div>
          <div className="relative min-h-[220px] w-full flex items-center justify-center">
            {isDataLoading ? (
              <Loader2 className="animate-spin text-cyan-500" size={32} />
            ) : (
              <CustomGrowthAreaChart data={monthlyPerformance} formatCurrency={formatCurrency} />
            )}
          </div>
        </div>

        {/* Column 2: Gorgeous concentric glowing SVG Pizza (Donut) Chart */}
        <div className="rounded-[1.5rem] border border-slate-100 bg-[#090e1a] p-5 shadow-xl sm:rounded-[2rem] sm:p-6 lg:col-span-2">
          <div className="mb-6">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-purple-400">Distribuição Pizza</p>
            <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">Leads por Etapa</h2>
          </div>
          <div className="min-h-[220px] flex items-center justify-center">
            {isDataLoading ? (
              <Loader2 className="animate-spin text-purple-500" size={32} />
            ) : (
              <CustomDonutPizzaChart
                waiting={stats.waiting}
                inProgress={stats.inProgress}
                quoted={stats.quoted}
                sold={stats.sold}
                lost={stats.lost}
              />
            )}
          </div>
        </div>
      </div>

      {/* 🚀 STEP 3: FINANCIAL INDICATORS GRID WITH GLOWING ACCENTS */}
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-md hover:-translate-y-1 hover:border-cyan-500/20 transition-all duration-300">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Taxa de Conversão</p>
            <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-xl">
              <Target size={16} />
            </div>
          </div>
          <p className="text-3xl font-black text-white">{salesConversionRate.toFixed(1).replace('.', ',')}%</p>
          <div className="mt-2.5 flex items-center justify-between text-[10px] font-bold text-slate-400 border-t border-white/5 pt-2">
            <span>✓ {stats.sold} vendas</span>
            <span>{stats.total} leads</span>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-md hover:-translate-y-1 hover:border-emerald-500/20 transition-all duration-300">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Comissão Vendida</p>
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <DollarSign size={16} />
            </div>
          </div>
          <p className="text-3xl font-black text-white">{formatCurrency(stats.revenueRealized)}</p>
          <div className="mt-2.5 text-[10px] font-bold text-emerald-400 border-t border-white/5 pt-2">
            comissão das vendas realizadas
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-md hover:-translate-y-1 hover:border-purple-500/20 transition-all duration-300">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Venda Prevista</p>
            <div className="p-2 bg-purple-500/10 text-purple-400 rounded-xl">
              <TrendingUp size={16} />
            </div>
          </div>
          <p className="text-3xl font-black text-white">{formatCurrency(stats.salesPotential)}</p>
          <div className="mt-2.5 text-[10px] font-bold text-slate-500 border-t border-white/5 pt-2">
            valor previsto dos leads ativos
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-md hover:-translate-y-1 hover:border-blue-500/20 transition-all duration-300">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Total Vendido</p>
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <BarChart3 size={16} />
            </div>
          </div>
          <p className="text-3xl font-black text-white">{formatCurrency(stats.salesRealized)}</p>
          <div className="mt-2.5 text-[10px] font-bold text-blue-400 border-t border-white/5 pt-2">
            soma das vendas realizadas
          </div>
        </div>
      </div>

      {/* 🚀 STEP 4: FUNIL COMERCIAL & MONTHLY STATS ROW */}
      <div className="mb-10 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/10 dark-dashboard-panel sm:rounded-[2rem]">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 p-5 text-white sm:p-7">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">Overview comercial</p>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Funil Orion Track</h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-blue-100">
                Uma visão executiva do caminho do lead: entrada, atendimento, cotação e venda.
              </p>
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
                    <stop offset="0%" stopColor="#8d6cff" />
                    <stop offset="52%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#4338ca" />
                  </linearGradient>
                  <linearGradient id="funnelSalesGradient" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#1df5d7" />
                    <stop offset="54%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="#0f766e" />
                  </linearGradient>
                  <radialGradient id="funnelMouthGradient" cx="50%" cy="45%" r="60%">
                    <stop offset="0%" stopColor="#a3eaff" />
                    <stop offset="60%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#08385a" />
                  </radialGradient>
                  <linearGradient id="funnelSideShine" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                    <stop offset="45%" stopColor="#ffffff" stopOpacity="0.10" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
                  </linearGradient>
                  <filter id="orionFunnelShadow" x="-20%" y="-15%" width="140%" height="130%">
                    <feDropShadow dx="0" dy="18" stdDeviation="24" floodColor="#020617" floodOpacity="0.22" />
                  </filter>
                  <filter id="orionFunnelLift" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#06b6d4" floodOpacity="0.15" />
                  </filter>
                </defs>
                <g filter="url(#orionFunnelShadow)">
                  <ellipse className="orion-funnel-mouth" cx="260" cy="96" rx="206" ry="42" fill="url(#funnelMouthGradient)" />
                  {visualFunnelSteps.map((step) => (
                    <ellipse key={`rim-${step.name}`} cx="260" cy={step.labelY} rx={step.name === 'Leads' ? 206 : step.name === 'Atendimento' ? 132 : step.name === 'Cotação' ? 86 : 56} ry={step.name === 'Leads' ? 42 : step.name === 'Atendimento' ? 20 : step.name === 'Cotação' ? 12 : 8} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                  ))}
                  <path className="orion-funnel-side-highlight" d="M392 93 C368 181 336 302 300 415 C286 457 279 503 265 589 C315 526 363 326 425 126 C417 112 405 101 392 93Z" fill="url(#funnelSideShine)" opacity="0.78" />
                  <path className="orion-funnel-left-depth" d="M86 122 C111 229 166 377 242 608 C207 525 161 378 108 224 C96 202 76 150 86 122Z" fill="#003c75" opacity="0.20" />
                </g>
                {visualFunnelSteps.map((step) => (
                  <path
                    key={`slice-${step.name}`}
                    d={step.path}
                    fill={step.fill}
                    className="orion-funnel-body transition-all duration-300 hover:brightness-105"
                  />
                ))}
                {visualFunnelSteps.map((step) => {
                  const labelValue = step.name === 'Leads' ? stats.total : step.name === 'Atendimento' ? activePipeline : step.name === 'Cotação' ? stats.quoted + stats.sold : stats.sold;
                  return (
                    <g key={`text-${step.name}`} className="orion-traffic-side">
                      <text x="560" y={step.labelY} className="orion-traffic-side-label">{step.name}</text>
                      <text x="560" y={step.valueY} className="orion-traffic-value" fill={step.name === 'Leads' ? '#0ea5e9' : step.name === 'Atendimento' ? '#0ea5e9' : step.name === 'Cotação' ? '#6366f1' : '#14b8a6'}>{labelValue}</text>
                      <text x="560" y={step.detailY} className="orion-traffic-side-detail">{step.detail}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Monthly commercial context and profile */}
          <div className="rounded-[1.5rem] border border-gray-100 bg-[#090e1a] p-5 shadow-sm sm:rounded-[2rem] sm:p-6 flex flex-col justify-between">
            <div>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Resumo deste mês</p>
                  <h2 className="text-xl font-black text-white">Perfil comercial</h2>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
                  <BarChart3 size={20} />
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
            </div>
            <div className="mt-6 rounded-2xl bg-[#0b1324] border border-white/5 p-4 text-left">
              <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Corretor Conectado</p>
              <p className="text-sm font-black text-white">{corretorData?.nome || profile?.nome || '-'}</p>
              <p className="mt-1 text-xs font-bold text-slate-400">{corretorData?.email || profile?.email || '-'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 🚀 STEP 5: WEEKLY RHYTHM & CIDADES RANKING */}
      <div className="mb-10 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-[1.5rem] border border-gray-100 bg-[#090e1a] p-4 shadow-xl sm:rounded-[2rem] sm:p-6">
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-400">Últimos 7 dias</p>
              <h2 className="text-2xl font-black text-white">Ritmo de entrada</h2>
              <p className="mt-1 text-sm font-bold text-slate-400">Volume diário de leads recebidos.</p>
            </div>
            <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 px-5 py-3 text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Total</p>
              <p className="text-3xl font-black text-white">{weeklyTotal}</p>
              <p className="text-[11px] font-bold text-slate-400">leads na semana</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_170px]">
            <div className="rounded-2xl border border-white/5 bg-[#070b13] p-3 sm:p-4">
              <div className="flex h-56 items-end gap-2 sm:gap-3">
                {weeklyLeads.map((day) => {
                  const height = Math.max((day.leads / maxWeeklyLeads) * 100, day.leads > 0 ? 14 : 5);
                  const isBest = day.key === bestWeeklyDay.key && day.leads > 0;

                  return (
                    <div key={day.key} className="group/day flex min-w-0 flex-1 flex-col items-center gap-3">
                      <div className="relative flex h-44 w-full items-end justify-center rounded-2xl bg-[#090f1d] border border-white/5 px-2 py-2">
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
                        <div className="pointer-events-none absolute -top-3 rounded-xl border border-white/5 bg-[#020617] px-2 py-1 text-[10px] font-black text-white opacity-0 shadow-md transition-opacity group-hover/day:opacity-100 whitespace-nowrap">
                          {day.leads} leads
                        </div>
                      </div>
                      <span className="text-[10px] font-black text-slate-400 sm:text-xs">{day.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl bg-slate-900 border border-white/5 p-4 text-white">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Melhor dia</p>
                <p className="text-xl font-black">{bestWeeklyDay.label}</p>
                <p className="mt-1 text-sm font-bold text-blue-400">{bestWeeklyDay.leads} leads</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-[#070b13] p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Média/dia</p>
                <p className="text-2xl font-black text-white">
                  {(weeklyTotal / Math.max(weeklyLeads.length, 1)).toFixed(1).replace('.', ',')}
                </p>
                <p className="mt-1 text-xs font-bold text-slate-400">leads por dia</p>
              </div>
              <Link href="/leads" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-700">
                Ver leads <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>

        {/* Top 5 Cidades Ranking */}
        <div className="rounded-[1.5rem] border border-gray-100 bg-[#090e1a] p-4 shadow-xl sm:rounded-[2rem] sm:p-6">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-400">Ranking</p>
              <h2 className="text-2xl font-black text-white">Top 5 Cidades</h2>
            </div>
            <p className="text-xs font-bold text-slate-400">Por volume de leads</p>
          </div>
          <div className="space-y-5">
            {topCities.length > 0 ? topCities.map((city, index) => (
              <div key={`${city.city}-${index}`} className="group/city">
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-7 shrink-0 text-xs font-bold text-slate-500">#{index + 1}</span>
                    <span className="truncate font-black text-white">{city.city}</span>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-slate-400">{city.leads} leads</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[#070b13] border border-white/5">
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
              <div className="rounded-2xl border border-dashed border-white/5 py-14 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sem cidades registradas</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 🚀 STEP 6: DYNAMIC WARNING & STALE LEADS BOX */}
      <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-[2rem] border border-white/5 bg-[#090e1a] p-6 shadow-xl lg:col-span-2">
          <h3 className="mb-6 text-sm font-black uppercase tracking-widest text-white">Estatísticas por Etapa</h3>
          <div className="space-y-4">
            {performanceBars.map((bar, index) => (
              <div key={bar.label} className="group/stage">
                <div className="mb-2 flex justify-between text-xs font-bold text-slate-400">
                  <span className="font-extrabold text-white">{bar.label}</span>
                  <span>{bar.value}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-[#070b13] border border-white/5">
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
        <Link href="/leads?status=Aguardando atendimento" className="rounded-[2rem] border border-amber-500/20 bg-amber-500/5 p-6 transition-all hover:bg-amber-500/10">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 shadow-sm border border-amber-500/25">
            <AlertTriangle size={24} />
          </div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-amber-400">Necessita atenção</p>
          <h3 className="text-2xl font-black text-amber-200">{staleOpportunityCount} oportunidades sem resposta</h3>
          <p className="mt-3 text-sm font-bold leading-relaxed text-slate-300">
            Priorize leads novos. A regra ideal é responder em até 20 minutos para aumentar a chance de contato.
          </p>
        </Link>
      </div>

      {/* 🚀 STEP 7: QUICK ACTIONS GRID */}
      <div className="mb-16">
        <h2 className="text-xl font-black text-white mb-8 flex items-center gap-2">
          Ações rápidas
          <div className="h-px flex-1 bg-white/5 ml-2" />
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action, idx) => (
            <Link 
              key={idx} 
              href={action.href}
              className="group flex min-h-48 flex-col justify-between rounded-[1.75rem] border border-white/5 bg-[#090e1a] p-6 shadow-sm transition-all duration-500 hover:border-blue-500/20 hover:shadow-xl sm:h-60 sm:rounded-[2.5rem] sm:p-8"
            >
              <div className="flex justify-between items-start">
                <div className="p-4 bg-white/5 text-blue-400 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 transform group-hover:scale-110 shadow-inner">
                  <action.icon size={26} />
                </div>
                <ArrowRight size={18} className="text-slate-500 group-hover:text-blue-400 transition-colors" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white mb-2">{action.label}</h3>
                <p className="text-sm text-slate-400 font-medium leading-relaxed">{action.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* 🚀 STEP 8: OPERATIONAL TEAM SECTION */}
      <div className="mb-10 rounded-[2rem] border border-white/5 bg-[#090e1a] p-5 sm:rounded-[3rem] sm:p-10">
        <div className="mb-8">
          <h2 className="text-2xl font-black text-white tracking-tight mb-2">Seu time Orion</h2>
          <p className="text-slate-400 font-medium">Essas são as pessoas da Orion responsáveis por acompanhar sua operação.</p>
        </div>

        {isDataLoading ? (
          <div className="flex gap-4">
             <div className="w-32 h-32 bg-[#070b13] rounded-3xl animate-pulse" />
             <div className="w-32 h-32 bg-[#070b13] rounded-3xl animate-pulse" />
          </div>
        ) : timeOperacional.length === 0 ? (
          <div className="bg-[#070b13] p-8 rounded-[2rem] border border-white/5 text-center">
             <p className="text-slate-400 font-bold italic">Seu time operacional ainda não foi definido. Fale com a Orion.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {timeOperacional.map((membro, index: number) => {
              const foto = getTeamMemberPhoto(membro.nome);

              return (
                <div key={`${membro.nome}-${index}`} className="bg-[#070b13] p-6 rounded-[2.5rem] border border-white/5 shadow-sm flex flex-col items-center text-center group hover:scale-105 transition-all duration-500 hover:shadow-xl hover:border-blue-500/20">
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
                  <h3 className="font-black text-white mb-1 leading-tight">{membro.nome}</h3>
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{membro.cargo}</p>
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

function CustomGrowthAreaChart({
  data,
  formatCurrency
}: {
  data: { label: string; spend: number; leads: number }[];
  formatCurrency: (v: number) => string;
}) {
  const maxSpend = Math.max(...data.map(d => d.spend), 1);
  const maxLeads = Math.max(...data.map(d => d.leads), 1);
  
  const width = 500;
  const height = 200;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  
  // Calculate points
  const spendPoints = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padding + chartH - (d.spend / maxSpend) * chartH;
    return { x, y };
  });

  const leadPoints = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padding + chartH - (d.leads / maxLeads) * chartH;
    return { x, y };
  });

  const getAreaPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    let d = `M ${first.x} ${first.y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    d += ` L ${last.x} ${padding + chartH} L ${first.x} ${padding + chartH} Z`;
    return d;
  };

  const getLinePath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  };

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
        <defs>
          <linearGradient id="spendAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="leadsAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const y = padding + p * chartH;
          return (
            <line
              key={i}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="rgba(255, 255, 255, 0.05)"
              strokeDasharray="4 4"
            />
          );
        })}

        {/* Shaded Areas */}
        <path d={getAreaPath(spendPoints)} fill="url(#spendAreaGrad)" />
        <path d={getAreaPath(leadPoints)} fill="url(#leadsAreaGrad)" />

        {/* Neon Stroke Lines */}
        <path
          d={getLinePath(spendPoints)}
          fill="none"
          stroke="#06b6d4"
          strokeWidth="3"
          strokeLinecap="round"
          filter="drop-shadow(0 0 4px rgba(6, 182, 212, 0.4))"
        />
        <path
          d={getLinePath(leadPoints)}
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          strokeLinecap="round"
          filter="drop-shadow(0 0 4px rgba(16, 185, 129, 0.4))"
        />

        {/* Nodes and Labels */}
        {data.map((d, i) => {
          const sp = spendPoints[i];
          const lp = leadPoints[i];
          return (
            <g key={i}>
              {/* Spend Node */}
              <circle
                cx={sp.x}
                cy={sp.y}
                r="4"
                fill="#ffffff"
                stroke="#06b6d4"
                strokeWidth="2"
              />
              {/* Leads Node */}
              <circle
                cx={lp.x}
                cy={lp.y}
                r="4"
                fill="#ffffff"
                stroke="#10b981"
                strokeWidth="2"
              />
              {/* Label */}
              <text
                x={sp.x}
                y={height - 8}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="9"
                fontWeight="bold"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CustomDonutPizzaChart({
  waiting,
  inProgress,
  quoted,
  sold,
  lost
}: {
  waiting: number;
  inProgress: number;
  quoted: number;
  sold: number;
  lost: number;
}) {
  const total = (waiting + inProgress + quoted + sold + lost) || 1;
  const slices = [
    { label: 'Aguardando', value: waiting, color: '#a78bfa' },
    { label: 'Negociação', value: inProgress, color: '#f59e0b' },
    { label: 'Proposta', value: quoted, color: '#38bdf8' },
    { label: 'Vendas', value: sold, color: '#10b981' },
    { label: 'Sem interesse', value: lost, color: '#64748b' }
  ].filter(s => s.value > 0);

  // Default demo values if all are zero
  const displaySlices = slices.length > 0 ? slices : [
    { label: 'Aguardando', value: 1, color: '#a78bfa' },
    { label: 'Negociação', value: 2, color: '#f59e0b' },
    { label: 'Proposta', value: 1, color: '#38bdf8' }
  ];
  const displayTotal = displaySlices.reduce((a, b) => a + b.value, 0);

  const radius = 40;
  const circ = 2 * Math.PI * radius; // ~251.3
  
  let accumulatedPercent = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 justify-center">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {displaySlices.map((slice, i) => {
            const percent = slice.value / displayTotal;
            const strokeDasharray = `${percent * circ} ${circ}`;
            const strokeDashoffset = -accumulatedPercent * circ;
            accumulatedPercent += percent;

            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={radius}
                fill="transparent"
                stroke={slice.color}
                strokeWidth="10"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-500 hover:stroke-[12px]"
                style={{
                  filter: `drop-shadow(0 0 3px ${slice.color}44)`
                }}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Total</p>
          <p className="mt-1 text-lg font-black text-white leading-none">{slices.length > 0 ? total : 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-left">
        {displaySlices.map((slice, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: slice.color }} />
            <div>
              <p className="font-extrabold text-white leading-tight">{slice.label}</p>
              <p className="text-[10px] font-bold text-slate-400">
                {slice.value} ({((slice.value / displayTotal) * 100).toFixed(0)}%)
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

