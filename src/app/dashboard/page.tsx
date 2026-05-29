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
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
  const [hoveredTier, setHoveredTier] = useState<number | null>(null);
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
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-purple-400">Distribuição de Leads</p>
              <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">Leads por Etapa</h2>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/5 px-4 py-2.5 text-right shrink-0">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Total Geral</p>
              <p className="mt-1.5 text-lg font-black text-white leading-none">
                {stats.waiting + stats.inProgress + stats.quoted + stats.sold + stats.lost}
              </p>
            </div>
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
                  {/* Neon Glow Filters */}
                  <filter id="funnelGlow1" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#00bcff" floodOpacity="0.6" />
                  </filter>
                  <filter id="funnelGlow2" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#00c2ff" floodOpacity="0.6" />
                  </filter>
                  <filter id="funnelGlow3" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#7822d5" floodOpacity="0.6" />
                  </filter>
                  <filter id="funnelGlow4" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#00b4af" floodOpacity="0.6" />
                  </filter>

                  {/* Glass Gradients for Mouth Interiors */}
                  <linearGradient id="funnelMouth1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#08224b" />
                    <stop offset="100%" stopColor="#004da3" />
                  </linearGradient>
                  <linearGradient id="funnelMouth2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#002d3c" />
                    <stop offset="100%" stopColor="#006385" />
                  </linearGradient>
                  <linearGradient id="funnelMouth3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2c0650" />
                    <stop offset="100%" stopColor="#4f127e" />
                  </linearGradient>
                  <linearGradient id="funnelMouth4" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#002d2c" />
                    <stop offset="100%" stopColor="#005d5a" />
                  </linearGradient>

                  {/* Body Gradients */}
                  <linearGradient id="funnelBody1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f62e6" />
                    <stop offset="100%" stopColor="#002b78" />
                  </linearGradient>
                  <linearGradient id="funnelBody2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00a8e0" />
                    <stop offset="100%" stopColor="#005978" />
                  </linearGradient>
                  <linearGradient id="funnelBody3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6719cd" />
                    <stop offset="100%" stopColor="#3c0b78" />
                  </linearGradient>
                  <linearGradient id="funnelBody4" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00a39e" />
                    <stop offset="100%" stopColor="#005956" />
                  </linearGradient>

                  {/* Glossy Overlay Reflective shine */}
                  <linearGradient id="funnelGlossShine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                    <stop offset="35%" stopColor="#ffffff" stopOpacity="0.10" />
                    <stop offset="70%" stopColor="#ffffff" stopOpacity="0.0" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.15" />
                  </linearGradient>
                </defs>

                {/* BACKGROUND GLOW */}
                <circle cx="260" cy="300" r="180" fill="#007cff" opacity="0.06" filter="blur(80px)" pointerEvents="none" />

                {/* TIER 1 (Leads / Entradas captadas) */}
                <g
                  onMouseEnter={() => setHoveredTier(1)}
                  onMouseLeave={() => setHoveredTier(null)}
                  onClick={() => router.push('/leads')}
                  className="cursor-pointer select-none"
                  style={{
                    transform: hoveredTier === 1 ? 'scale(1.04) translateY(-4px)' : 'scale(1) translateY(0px)',
                    transformOrigin: '260px 160px',
                    filter: hoveredTier === 1 ? 'url(#funnelGlow1) brightness(1.1)' : 'none',
                    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  {/* Inside Rim */}
                  <ellipse cx="260" cy="100" rx="200" ry="38" fill="url(#funnelMouth1)" stroke="#58aeff" strokeWidth="2.5" />
                  
                  {/* Tier 3D Truncated Cone Body */}
                  <path
                    d="M 60 100 A 200 38 0 0 0 460 100 L 385 210 A 125 22 0 0 1 135 210 Z"
                    fill="url(#funnelBody1)"
                    stroke="#2b88ff"
                    strokeWidth="1.5"
                  />
                  {/* Glossy highlight path overlay */}
                  <path
                    d="M 60 100 A 200 38 0 0 0 460 100 L 385 210 A 125 22 0 0 1 135 210 Z"
                    fill="url(#funnelGlossShine)"
                    pointerEvents="none"
                  />

                  {/* Value Text (Very bold and large) */}
                  <text x="260" y="166" textAnchor="middle" fill="#ffffff" fontSize="46" fontWeight="900" style={{ textShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                    {stats.total}
                  </text>

                  {/* Connector Line, Dots & Label */}
                  <g className="transition-opacity duration-300" style={{ opacity: hoveredTier !== null && hoveredTier !== 1 ? 0.45 : 1 }}>
                    <circle cx="420" cy="150" r="3.5" fill="#00bcff" style={{ filter: 'drop-shadow(0 0 4px #00bcff)' }} />
                    <line x1="420" y1="150" x2="560" y2="150" stroke="#00bcff" strokeWidth="1.5" />
                    <circle cx="560" cy="150" r="3.5" fill="#00bcff" style={{ filter: 'drop-shadow(0 0 4px #00bcff)' }} />
                    <text x="576" y="154" fill="#f8fafc" fontSize="12" fontWeight="900" className="tracking-wide">
                      Entradas captadas
                    </text>
                  </g>
                </g>

                {/* TIER 2 (Atendimento / Em funil comercial) */}
                <g
                  onMouseEnter={() => setHoveredTier(2)}
                  onMouseLeave={() => setHoveredTier(null)}
                  onClick={() => router.push('/leads?status=Aguardando%20atendimento')}
                  className="cursor-pointer select-none"
                  style={{
                    transform: hoveredTier === 2 ? 'scale(1.04) translateY(-3px)' : 'scale(1) translateY(0px)',
                    transformOrigin: '260px 280px',
                    filter: hoveredTier === 2 ? 'url(#funnelGlow2) brightness(1.15)' : 'none',
                    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  {/* Top Lip Rim */}
                  <ellipse cx="260" cy="220" rx="125" ry="22" fill="url(#funnelMouth2)" stroke="#22d3ee" strokeWidth="2.5" />
                  
                  {/* Truncated Cone Body */}
                  <path
                    d="M 135 220 A 125 22 0 0 0 385 220 L 330 320 A 70 14 0 0 1 190 320 Z"
                    fill="url(#funnelBody2)"
                    stroke="#00c8e6"
                    strokeWidth="1.5"
                  />
                  {/* Glossy highlight */}
                  <path
                    d="M 135 220 A 125 22 0 0 0 385 220 L 330 320 A 70 14 0 0 1 190 320 Z"
                    fill="url(#funnelGlossShine)"
                    pointerEvents="none"
                  />

                  {/* Value Text */}
                  <text x="260" y="284" textAnchor="middle" fill="#ffffff" fontSize="40" fontWeight="900" style={{ textShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>
                    {activePipeline}
                  </text>

                  {/* Connector Line, Dots & Label */}
                  <g className="transition-opacity duration-300" style={{ opacity: hoveredTier !== null && hoveredTier !== 2 ? 0.45 : 1 }}>
                    <circle cx="356" cy="270" r="3.5" fill="#00c2ff" style={{ filter: 'drop-shadow(0 0 4px #00c2ff)' }} />
                    <line x1="356" y1="270" x2="560" y2="270" stroke="#00c2ff" strokeWidth="1.5" />
                    <circle cx="560" cy="270" r="3.5" fill="#00c2ff" style={{ filter: 'drop-shadow(0 0 4px #00c2ff)' }} />
                    <text x="576" y="274" fill="#f8fafc" fontSize="12" fontWeight="900" className="tracking-wide">
                      Em funil comercial
                    </text>
                  </g>
                </g>

                {/* TIER 3 (Cotação / Propostas e vendas) */}
                <g
                  onMouseEnter={() => setHoveredTier(3)}
                  onMouseLeave={() => setHoveredTier(null)}
                  onClick={() => router.push('/leads?status=Cota%C3%A7%C3%A3o%20enviada')}
                  className="cursor-pointer select-none"
                  style={{
                    transform: hoveredTier === 3 ? 'scale(1.04) translateY(-2px)' : 'scale(1) translateY(0px)',
                    transformOrigin: '260px 390px',
                    filter: hoveredTier === 3 ? 'url(#funnelGlow3) brightness(1.15)' : 'none',
                    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  {/* Top Lip Rim */}
                  <ellipse cx="260" cy="330" rx="76" ry="14" fill="url(#funnelMouth3)" stroke="#a78bfa" strokeWidth="2.5" />
                  
                  {/* Truncated Cone Body */}
                  <path
                    d="M 184 330 A 76 14 0 0 0 336 330 L 306 430 A 46 9 0 0 1 214 430 Z"
                    fill="url(#funnelBody3)"
                    stroke="#8d42f5"
                    strokeWidth="1.5"
                  />
                  {/* Glossy Highlight */}
                  <path
                    d="M 184 330 A 76 14 0 0 0 336 330 L 306 430 A 46 9 0 0 1 214 430 Z"
                    fill="url(#funnelGlossShine)"
                    pointerEvents="none"
                  />

                  {/* Value Text */}
                  <text x="260" y="392" textAnchor="middle" fill="#ffffff" fontSize="34" fontWeight="900" style={{ textShadow: '0 4px 8px rgba(0,0,0,0.5)' }}>
                    {stats.quoted + stats.sold}
                  </text>

                  {/* Connector Line, Dots & Label */}
                  <g className="transition-opacity duration-300" style={{ opacity: hoveredTier !== null && hoveredTier !== 3 ? 0.45 : 1 }}>
                    <circle cx="308" cy="380" r="3.5" fill="#a78bfa" style={{ filter: 'drop-shadow(0 0 4px #a78bfa)' }} />
                    <line x1="308" y1="380" x2="560" y2="380" stroke="#a78bfa" strokeWidth="1.5" />
                    <circle cx="560" cy="380" r="3.5" fill="#a78bfa" style={{ filter: 'drop-shadow(0 0 4px #a78bfa)' }} />
                    <text x="576" y="384" fill="#f8fafc" fontSize="12" fontWeight="900" className="tracking-wide">
                      Propostas e vendas
                    </text>
                  </g>
                </g>

                {/* TIER 4 (Vendas / Conversões fechadas) */}
                <g
                  onMouseEnter={() => setHoveredTier(4)}
                  onMouseLeave={() => setHoveredTier(null)}
                  onClick={() => router.push('/leads?status=Venda%20realizada')}
                  className="cursor-pointer select-none"
                  style={{
                    transform: hoveredTier === 4 ? 'scale(1.04) translateY(2px)' : 'scale(1) translateY(0px)',
                    transformOrigin: '260px 500px',
                    filter: hoveredTier === 4 ? 'url(#funnelGlow4) brightness(1.2)' : 'none',
                    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  {/* Top Lip Rim */}
                  <ellipse cx="260" cy="440" rx="48" ry="9" fill="url(#funnelMouth4)" stroke="#2dd4bf" strokeWidth="2" />
                  
                  {/* Extruded Rounded Bottom Capsule Cone Tip */}
                  <path
                    d="M 212 440 A 48 9 0 0 0 308 440 C 308 440 295 560 260 570 C 225 560 212 440 212 440 Z"
                    fill="url(#funnelBody4)"
                    stroke="#00c2be"
                    strokeWidth="1.5"
                  />
                  {/* Glossy Highlight */}
                  <path
                    d="M 212 440 A 48 9 0 0 0 308 440 C 308 440 295 560 260 570 C 225 560 212 440 212 440 Z"
                    fill="url(#funnelGlossShine)"
                    pointerEvents="none"
                  />

                  {/* Value Text */}
                  <text x="260" y="500" textAnchor="middle" fill="#ffffff" fontSize="26" fontWeight="900" style={{ textShadow: '0 4px 6px rgba(0,0,0,0.5)' }}>
                    {stats.sold}
                  </text>

                  {/* Connector Line, Dots & Label */}
                  <g className="transition-opacity duration-300" style={{ opacity: hoveredTier !== null && hoveredTier !== 4 ? 0.45 : 1 }}>
                    <circle cx="278" cy="500" r="3.5" fill="#2dd4bf" style={{ filter: 'drop-shadow(0 0 4px #2dd4bf)' }} />
                    <line x1="278" y1="500" x2="560" y2="500" stroke="#2dd4bf" strokeWidth="1.5" />
                    <circle cx="560" cy="500" r="3.5" fill="#2dd4bf" style={{ filter: 'drop-shadow(0 0 4px #2dd4bf)' }} />
                    <text x="576" y="504" fill="#f8fafc" fontSize="12" fontWeight="900" className="tracking-wide">
                      Conversões fechadas
                    </text>
                  </g>
                </g>
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
  const [animationProgress, setAnimationProgress] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<{ x: number; y: number; value: string; label: string; color: string } | null>(null);

  useEffect(() => {
    let start: number;
    const duration = 1200; // 1.2 seconds
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4); // easeOutQuart
      setAnimationProgress(ease);
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, [data]);

  const maxSpend = Math.max(...data.map(d => d.spend), 1);
  const maxLeads = Math.max(...data.map(d => d.leads), 1);
  
  const width = 500;
  const height = 200;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  
  // Calculate raw points
  const baseSpendPoints = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padding + chartH - (d.spend / maxSpend) * chartH;
    return { x, y };
  });

  const baseLeadPoints = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padding + chartH - (d.leads / maxLeads) * chartH;
    return { x, y };
  });

  // Calculate animated points rising up from bottom baseline (170)
  const spendPoints = baseSpendPoints.map(p => {
    const animatedY = 170 - (170 - p.y) * animationProgress;
    return { x: p.x, y: animatedY };
  });

  const leadPoints = baseLeadPoints.map(p => {
    const animatedY = 170 - (170 - p.y) * animationProgress;
    return { x: p.x, y: animatedY };
  });

  const getAreaPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    let d = `M ${first.x} ${first.y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    d += ` L ${last.x} 170 L ${first.x} 170 Z`;
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
    <div className="w-full relative">
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
                className="transition-all duration-300 hover:scale-150 cursor-pointer"
                style={{ filter: 'drop-shadow(0 0 4px rgba(6, 182, 212, 0.6))' }}
              />
              {/* Spend Node Hover Trigger Area */}
              <circle
                cx={sp.x}
                cy={sp.y}
                r="14"
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredNode({
                  x: sp.x,
                  y: sp.y,
                  value: formatCurrency(d.spend),
                  label: 'Investimento',
                  color: '#06b6d4'
                })}
                onMouseLeave={() => setHoveredNode(null)}
              />

              {/* Leads Node */}
              <circle
                cx={lp.x}
                cy={lp.y}
                r="4"
                fill="#ffffff"
                stroke="#10b981"
                strokeWidth="2"
                className="transition-all duration-300 hover:scale-150 cursor-pointer"
                style={{ filter: 'drop-shadow(0 0 4px rgba(16, 185, 129, 0.6))' }}
              />
              {/* Leads Node Hover Trigger Area */}
              <circle
                cx={lp.x}
                cy={lp.y}
                r="14"
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredNode({
                  x: lp.x,
                  y: lp.y,
                  value: `${d.leads} leads`,
                  label: 'Leads',
                  color: '#10b981'
                })}
                onMouseLeave={() => setHoveredNode(null)}
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

      {/* Floating Tooltip */}
      {hoveredNode && (
        <div
          className="absolute z-30 pointer-events-none rounded-xl bg-slate-950/95 border border-white/10 px-3 py-2 text-xs font-black shadow-2xl backdrop-blur-md transition-all duration-200"
          style={{
            left: `${(hoveredNode.x / width) * 100}%`,
            top: `${(hoveredNode.y / height) * 100 - 15}%`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <p className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">{hoveredNode.label}</p>
          <p className="mt-0.5 text-sm font-black" style={{ color: hoveredNode.color }}>{hoveredNode.value}</p>
          {/* Arrow */}
          <div className="absolute left-1/2 bottom-0 h-2 w-2 -translate-x-1/2 translate-y-1/2 rotate-45 border-r border-b border-white/10 bg-slate-950" />
        </div>
      )}
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
  const [animatedTotal, setAnimatedTotal] = useState(0);

  const total = (waiting + inProgress + quoted + sold + lost) || 0;
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

  useEffect(() => {
    let start: number;
    const duration = 1200; // 1.2s
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4); // easeOutQuart
      
      setAnimatedTotal(Math.floor(ease * total));
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, [total]);

  return (
    <div className="flex flex-col lg:flex-row items-center gap-12 justify-center w-full py-6">
      {/* Spectacular Glowing Total Orb */}
      <div className="relative w-48 h-48 flex items-center justify-center select-none group shrink-0">
        {/* Animated Radial Pulse Rings in the background */}
        <div className="absolute inset-4 rounded-full bg-gradient-to-tr from-purple-600 via-pink-600 to-cyan-500 opacity-20 blur-xl group-hover:opacity-40 group-hover:scale-110 transition-all duration-700 animate-pulse" />
        <div className="absolute inset-8 rounded-full border border-purple-500/30 animate-[spin_8s_linear_infinite] opacity-60" style={{ borderStyle: 'dashed' }} />
        <div className="absolute inset-12 rounded-full border border-cyan-400/20 animate-[spin_12s_linear_infinite_reverse] opacity-40" />

        {/* Outer glowing animated neon ring (SVG) */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full animate-[spin_16s_linear_infinite] pointer-events-none">
          <defs>
            <linearGradient id="orbGlowGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#c084fc" />
              <stop offset="50%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="transparent"
            stroke="url(#orbGlowGrad)"
            strokeWidth="2.5"
            strokeDasharray="60 120 40 40"
            strokeLinecap="round"
            style={{
              filter: 'drop-shadow(0 0 6px rgba(236, 72, 153, 0.45))'
            }}
          />
        </svg>

        {/* Core Glassmorphic Floating Orb */}
        <div className="relative rounded-full h-32 w-32 bg-[#090e1a]/85 border border-white/10 flex flex-col items-center justify-center shadow-2xl backdrop-blur-md transform group-hover:scale-105 group-hover:border-purple-500/30 transition-all duration-500 select-none">
          {/* Inner ambient glow */}
          <div className="absolute inset-2 rounded-full bg-gradient-to-tr from-purple-500/10 to-cyan-400/10 opacity-50 pointer-events-none" />
          
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 leading-none">Total Geral</p>
          
          {/* Premium Gradient Number with Rolling Counter */}
          <p className="mt-2.5 text-4xl font-black tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-500 to-cyan-400 drop-shadow-[0_0_12px_rgba(236, 72, 153, 0.3)]">
            {animatedTotal}
          </p>
          
          <p className="mt-1 text-[9px] font-bold text-slate-500 tracking-wider leading-none">leads ativos</p>
        </div>
      </div>

      {/* Enlarged premium detailed data legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-left w-full max-w-sm sm:max-w-md">
        {displaySlices.map((slice, i) => (
          <div 
            key={i} 
            className="flex items-center gap-3 text-xs p-2.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-300 shadow-md"
            title={`${slice.label}: ${slice.value} leads`}
          >
            <span 
              className="h-3 w-3 rounded-full shrink-0 animate-pulse shadow-sm" 
              style={{ 
                backgroundColor: slice.color,
                boxShadow: `0 0 8px ${slice.color}`
              }} 
            />
            <div>
              <p className="font-extrabold text-white leading-tight text-xs sm:text-sm">{slice.label}</p>
              <p className="text-[10px] font-bold text-slate-300 mt-0.5">
                {slice.value} leads <span className="text-slate-400 font-bold">({((slice.value / displayTotal) * 100).toFixed(0)}%)</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

