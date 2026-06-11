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
  ArrowLeft,
  GraduationCap,
  CalendarDays,
  Target,
  MessageSquare,
  Info,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ShieldAlert,
  CheckCircle2,
  type LucideIcon
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getTeamMemberPhoto } from '@/lib/orionTeam';
import OrionMark from '@/components/ui/OrionMark';
import { useRouter } from 'next/navigation';
import OrionFunnel from '@/components/ui/OrionFunnel';
import { motion } from 'framer-motion';
import { normalizeLeadStatus } from '@/lib/leadStatus';

type CorretorDashboardData = {
  id: string;
  nome: string;
  nome_empresa?: string | null;
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
  responsavel_profile_id?: string | null;
  cadencia_ativa?: boolean | null;
  cadencia_inicio?: string | null;
  cadencia_fim?: string | null;
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

function getMetaCompatibleRange(since: string, until: string) {
  const end = until || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const endDate = new Date(`${end}T00:00:00`);
  const minDate = new Date(endDate.getFullYear(), endDate.getMonth() - 36, 1);
  const minSince = minDate.toISOString().slice(0, 10);

  return {
    since: since && since > minSince ? since : minSince,
    until: end,
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
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - (total - 1 - index));
    return {
      key: dayKey(date),
      label: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      leads: 0,
    };
  });
}

function getBrokerMetaStatus(account: any, cplPeriodo: number | null, periodLabelText: string) {
  if (!account) return null;
  const isCard = String(account.forma_pagamento || '').toLowerCase().includes('cartao') || 
                 String(account.forma_pagamento || '').toLowerCase().includes('cartão') ||
                 String(account.forma_pagamento || '').toLowerCase().includes('card') ||
                 String(account.forma_pagamento || '').toLowerCase().includes('visa') ||
                 String(account.forma_pagamento || '').toLowerCase().includes('mastercard');

  const hasPaymentError = account.error && (
    /pagamento|payment|recusad|failed|declined|settle|cobrança|cobranca|cartao|cartão|card|invoice|unpaid|error/i.test(String(account.error))
  );

  // 1. CPL alto
  if (cplPeriodo !== null && cplPeriodo > 25) {
    return {
      status: 'cpl_alto',
      title: 'CPL Elevado',
      detail: `CPL ${periodLabelText} de R$ ${Number(cplPeriodo).toFixed(2).replace('.', ',')} esta acima do ideal de R$ 25,00.`,
      tone: 'red',
    };
  }

  // 2. Erro no Pagamento (Cartão)
  if (isCard && hasPaymentError) {
    return {
      status: 'erro_pagamento',
      title: 'Erro no Pagamento',
      detail: 'Ocorreu um erro no processamento da cobrança do cartão de crédito da sua conta.',
      tone: 'red',
    };
  }

  // 3. Sem Saldo (Pré-pago)
  if (!isCard && account.saldo !== null && account.saldo <= 0) {
    return {
      status: 'sem_saldo',
      title: 'Sem Saldo',
      detail: 'Sua conta está sem saldo de anúncio. Insira créditos para continuar recebendo leads.',
      tone: 'red',
    };
  }

  // 4. Saldo Baixo (Pré-pago)
  if (!isCard && account.saldo !== null && account.saldo < 100) {
    return {
      status: 'saldo_baixo',
      title: 'Saldo Baixo',
      detail: `Seu saldo está em R$ ${Number(account.saldo).toFixed(2).replace('.', ',')}. Recarregue para evitar pausa nas campanhas.`,
      tone: 'amber',
    };
  }

  // 5. Erro Geral
  if (account.error) {
    return {
      status: 'erro_meta',
      title: 'Alerta de Integração',
      detail: account.error,
      tone: 'amber',
    };
  }

  // 6. Com Saldo (Normal)
  return {
    status: 'com_saldo',
    title: isCard ? 'Cartao Ativo' : 'Com Saldo',
    detail: isCard ? 'Seu cartão está ativo para cobrança automática.' : 'Saldo suficiente para veiculação de anúncios.',
    tone: 'emerald',
  };
}

function normalizeCityName(city: string): string {
  const trimmed = String(city || '').trim();
  if (!trimmed || trimmed === '-') return '';
  
  // Convert to lowercase and remove accents
  const normalized = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Handle Brasília variations
  if (normalized === 'brasilia' || normalized === 'brasilia df' || normalized === 'distrito federal' || normalized === 'df') {
    return 'Brasília';
  }
  
  // Handle São Paulo variations
  if (normalized === 'sao paulo' || normalized === 'sao paulo sp' || normalized === 'sp') {
    return 'São Paulo';
  }

  // Handle Rio de Janeiro variations
  if (normalized === 'rio de janeiro' || normalized === 'rio de janeiro rj' || normalized === 'rj') {
    return 'Rio de Janeiro';
  }

  // Return standard capitalized title case for other cities
  return trimmed
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      // Keep small prepositions in lowercase
      if (['de', 'da', 'do', 'dos', 'das', 'e', 'em'].includes(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export default function DashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [hoveredTier, setHoveredTier] = useState<number | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [corretorData, setCorretorData] = useState<CorretorDashboardData | null>(null);
  const [metaAccount, setMetaAccount] = useState<any>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    waiting: 0,
    inicio: 0,
    contactMade: 0,
    inProgress: 0,
    quoted: 0,
    sold: 0,
    soldThisMonth: 0,
    stale: 0,
    lost: 0,
    invalid: 0,
    unavailableRegion: 0,
    cadence: 0,
    tasksOpen: 0,
    tasksToday: 0,
    revenueRealized: 0,
    salesRealized: 0,
    salesPotential: 0
  });
  const [monthlyPerformance, setMonthlyPerformance] = useState<MonthlyPerformance[]>(getLastMonths());
  const [weeklyLeads, setWeeklyLeads] = useState(getLastDays());
  const [topCities, setTopCities] = useState<Array<{ city: string; leads: number }>>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [chartHovering, setChartHovering] = useState(false);

  const [allTimeStats, setAllTimeStats] = useState({
    total: 0,
    sold: 0,
    revenueRealized: 0,
    salesRealized: 0,
    salesPotential: 0
  });
  const [periodSpend, setPeriodSpend] = useState(0);
  const [chartAnimate, setChartAnimate] = useState(false);

  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [oldestDate, setOldestDate] = useState('');

  useEffect(() => {
    async function initializeDefaultDates() {
      if (!profile || !['corretor', 'corretor_admin', 'corretor_membro'].includes(profile.tipo_usuario)) return;
      if (!profile.corretor_id) return;
      
      try {
        let idsToFetch = [profile.corretor_id];
        if (profile.nome_empresa) {
          const { data: siblings } = await supabase
            .from('corretores')
            .select('id')
            .eq('nome_empresa', profile.nome_empresa);
          if (siblings && siblings.length > 0) {
            idsToFetch = siblings.map((s) => s.id);
          }
        }

        const { data: oldestLeadData } = await supabase
          .from('leads')
          .select('data_entrada')
          .in('corretor_id', idsToFetch)
          .order('data_entrada', { ascending: true })
          .limit(1)
          .maybeSingle();

        let firstLeadDate = '2026-01-01';
        if (oldestLeadData?.data_entrada) {
          firstLeadDate = oldestLeadData.data_entrada.slice(0, 10);
        }
        
        setOldestDate(firstLeadDate);
        setDataInicio(firstLeadDate);
        setDataFim(toLocalDateString(getSaoPauloToday()));
      } catch (err) {
        console.error('Error fetching oldest lead date:', err);
      }
    }

    initializeDefaultDates();
  }, [profile?.id, profile?.corretor_id, profile?.nome_empresa]);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [presetLabel, setPresetLabel] = useState('Todo o período');

  const formatDateDisplay = (start: string, end: string) => {
    if (!start || !end) return '';
    const [sYear, sMonth, sDay] = start.split('-');
    const [eYear, eMonth, eDay] = end.split('-');
    return `${sDay}/${sMonth}/${sYear} a ${eDay}/${eMonth}/${eYear}`;
  };

  const toLocalDateString = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const addDays = (date: Date, days: number) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

  const getSaoPauloToday = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    return new Date(year, month - 1, day);
  };

  const getYesterday = () => {
    return addDays(getSaoPauloToday(), -1);
  };

  const applyPreset = (preset: string) => {
    if (preset === 'todo_periodo') {
      setDataInicio(oldestDate || '2026-01-01');
      setDataFim(toLocalDateString(getSaoPauloToday()));
      setPresetLabel('Todo o período');
      setShowDatePicker(false);
      return;
    }

    const d = getSaoPauloToday();
    let start = new Date(d);
    let end = new Date(d);

    switch (preset) {
      case 'hoje':
        setPresetLabel('Hoje');
        break;
      case 'ontem':
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
        end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
        setPresetLabel('Ontem');
        break;
      case '7dias':
        end = d;
        start = addDays(end, -6);
        setPresetLabel('Últimos 7 dias');
        break;
      case '30dias':
        end = d;
        start = addDays(end, -29);
        setPresetLabel('Últimos 30 dias');
        break;
      case 'este_mes':
        start = new Date(d.getFullYear(), d.getMonth(), 1);
        end = d;
        setPresetLabel('Este mês');
        break;
      case 'mes_passado':
        start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        end = new Date(d.getFullYear(), d.getMonth(), 0);
        setPresetLabel('Mês passado');
        break;
      default:
        break;
    }

    const startStr = toLocalDateString(start);
    const endStr = toLocalDateString(end);
    
    setDataInicio(startStr);
    setDataFim(endStr);
    setShowDatePicker(false);
  };

  useEffect(() => {
    async function fetchCorretorData() {
      if (!profile || !['corretor', 'corretor_admin', 'corretor_membro'].includes(profile.tipo_usuario)) {
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
          .select("id, nome, nome_empresa, email, telefone, link_pagina, gestor_trafego_id, time_operacional")
          .eq("id", profile.corretor_id)
          .maybeSingle();

        if (corretorError) {
          console.error("Erro ao buscar corretor do dashboard:", JSON.stringify(corretorError, null, 2));
          throw corretorError;
        }

        setCorretorData(data);

        // 2. Buscar Todos os Estatísticas de Leads (Sem filtro de data na query)
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        let allLeads: LeadMetricRow[] = [];
        let pageNum = 0;
        const limitNum = 1000;
        let keepFetching = true;

        const companyName = data?.nome_empresa || profile.nome_empresa;
        let idsToFetch = [profile.corretor_id];
        if (companyName) {
          const { data: siblings } = await supabase
            .from('corretores')
            .select('id')
            .eq('nome_empresa', companyName);
          if (siblings && siblings.length > 0) {
            idsToFetch = siblings.map((s) => s.id);
          }
        }

        while (keepFetching) {
          const from = pageNum * limitNum;
          const to = from + limitNum - 1;
          let statsRequest = supabase
            .from('leads')
            .select('status, data_entrada, cidade, valor_negociacao, valor_comissao, responsavel_profile_id, cadencia_ativa, cadencia_inicio, cadencia_fim')
            .in('corretor_id', idsToFetch)
            .range(from, to);

          if (profile.tipo_usuario === 'corretor_membro') {
            statsRequest = statsRequest.eq('responsavel_profile_id', profile.id);
          }

          const statsQuery = await statsRequest;

          if (statsQuery.error) throw statsQuery.error;

          const dataRows = statsQuery.data || [];
          allLeads = [...allLeads, ...(dataRows as LeadMetricRow[])];

          if (dataRows.length < limitNum) {
            keepFetching = false;
          } else {
            pageNum += 1;
          }
        }

        // Calculate all-time summary (used for the 4 financial cards step 3)
        const allTimeSoldLeads = allLeads.filter(l => normalizeLeadStatus(l.status) === 'Venda realizada');
        const activeRevenueStatuses = ['Em negociação', 'Cotação enviada', 'Contato feito', 'Aguardando atendimento'];
        
        setAllTimeStats({
          total: allLeads.length,
          sold: allTimeSoldLeads.length,
          revenueRealized: allTimeSoldLeads.reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_comissao), 0),
          salesRealized: allTimeSoldLeads.reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_negociacao), 0),
          salesPotential: allLeads
            .filter((lead) => activeRevenueStatuses.includes(normalizeLeadStatus(lead.status)))
            .reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_negociacao), 0)
        });

        // Calculate current month summary (used for the progress bars step 6)
        const thisMonthKey = monthKey(new Date());

        // Compute static 6-month performance timeline
        const months = getLastMonths();
        const monthMap = new Map(months.map((month) => [month.key, { ...month }]));
        allLeads.forEach((lead) => {
          if (!lead.data_entrada) return;
          if (dataFim && lead.data_entrada.slice(0, 10) > dataFim) return;
          const current = monthMap.get(monthKey(new Date(lead.data_entrada)));
          if (current) current.leads += 1;
        });

        // Compute static 7-day weekly leads rhythm
        const days = getLastDays();
        const dayMap = new Map(days.map((day) => [day.key, { ...day }]));
        allLeads.forEach((lead) => {
          if (!lead.data_entrada) return;
          if (dataFim && lead.data_entrada.slice(0, 10) > dataFim) return;
          const current = dayMap.get(dayKey(new Date(lead.data_entrada)));
          if (current) current.leads += 1;
        });
        setWeeklyLeads(Array.from(dayMap.values()));

        // Compute static top cities ranking (with canonical normalization)
        const cityMap = new Map<string, number>();
        allLeads.forEach((lead) => {
          const rawCity = String(lead.cidade || '').trim();
          const city = normalizeCityName(rawCity);
          if (!city) return;
          cityMap.set(city, (cityMap.get(city) || 0) + 1);
        });
        setTopCities(
          Array.from(cityMap.entries())
            .map(([city, leads]) => ({ city, leads }))
            .sort((a, b) => b.leads - a.leads || a.city.localeCompare(b.city))
            .slice(0, 5)
        );

        // Fetch exact period Meta spend
        let currentPeriodSpend = 0;
        if (accessToken && profile.corretor_id && dataInicio && dataFim) {
          try {
            const metaRange = getMetaCompatibleRange(dataInicio, dataFim);
            const spendResponse = await fetch('/api/integrations/meta/spend', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                corretor_id: profile.corretor_id,
                data_inicio: metaRange.since,
                data_fim: metaRange.until,
              }),
            });

            if (spendResponse.ok) {
              const spendPayload = await spendResponse.json();
              currentPeriodSpend = Number(spendPayload.spend || 0);
            }
          } catch (error) {
            console.error('Erro ao buscar investimento Meta do periodo:', error);
          }
        }
        setPeriodSpend(currentPeriodSpend);

        // Fetch monthly Meta spends (static 6-months)
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

        // Filter leads in memory for active date filter (used for status, pizza, funnel)
        let statsRes = allLeads;
        if (dataInicio || dataFim) {
          statsRes = allLeads.filter(lead => {
            if (!lead.data_entrada) return false;
            const entryTime = new Date(lead.data_entrada).getTime();
            if (dataInicio) {
              const startLimit = new Date(`${dataInicio}T00:00:00.000Z`).getTime();
              if (entryTime < startLimit) return false;
            }
            if (dataFim) {
              const endLimit = new Date(`${dataFim}T23:59:59.999Z`).getTime();
              if (entryTime > endLimit) return false;
            }
            return true;
          });
        }

        const soldLeads = statsRes.filter(l => normalizeLeadStatus(l.status) === 'Venda realizada');
        let pendingTasks: Array<{ id: string; vencimento: string | null }> = [];
        if (idsToFetch.length > 0) {
          let tasksRequest = supabase
            .from('lead_tarefas')
            .select('id, vencimento')
            .in('corretor_id', idsToFetch)
            .eq('status', 'pendente');

          if (profile.tipo_usuario === 'corretor_membro') {
            tasksRequest = tasksRequest.eq('responsavel_profile_id', profile.id);
          }

          const tasksResult = await tasksRequest;
          if (!tasksResult.error) {
            pendingTasks = tasksResult.data || [];
          }
        }
        const todayDate = new Date().toDateString();
        
        // Categorizar os status secundários nas 5 categorias primárias do painel
        const waitingLeads = statsRes.filter(l => {
          const s = normalizeLeadStatus(l.status);
          return s === 'Aguardando atendimento';
        });

        const inicioLeads = statsRes.filter(l => {
          const s = normalizeLeadStatus(l.status);
          return s === 'Inicio';
        });

        const contactMadeLeads = statsRes.filter(l => {
          const s = normalizeLeadStatus(l.status);
          return s === 'Contato feito';
        });
        
        const inProgressLeads = statsRes.filter(l => {
          const s = normalizeLeadStatus(l.status);
          return s === 'Em negociação' || s === 'Chamou duas vezes';
        });
        
        const quotedLeads = statsRes.filter(l => {
          const s = normalizeLeadStatus(l.status);
          return s === 'Cotação enviada';
        });
        
        const lostLeads = statsRes.filter(l => {
          const s = normalizeLeadStatus(l.status);
          return s === 'Sem interesse';
        });

        const invalidPhoneLeads = statsRes.filter(l => {
          const s = String(normalizeLeadStatus(l.status)).toLowerCase();
          return s.includes('telefone');
        });

        const unavailableRegionLeads = statsRes.filter(l => {
          const s = String(normalizeLeadStatus(l.status)).toLowerCase();
          return s.includes('regi') && s.includes('comercializa');
        });
        
        setStats({
          total: statsRes.length,
          waiting: waitingLeads.length,
          inicio: inicioLeads.length,
          contactMade: contactMadeLeads.length,
          inProgress: inProgressLeads.length,
          quoted: quotedLeads.length,
          sold: soldLeads.length,
          soldThisMonth: statsRes.filter(l => normalizeLeadStatus(l.status) === 'Venda realizada' && l.data_entrada && monthKey(new Date(l.data_entrada)) === thisMonthKey).length,
          stale: statsRes.filter(l => {
            if (normalizeLeadStatus(l.status) !== 'Aguardando atendimento' || !l.data_entrada) return false;
            return Date.now() - new Date(l.data_entrada).getTime() > 20 * 60 * 1000;
          }).length,
          lost: lostLeads.length,
          invalid: invalidPhoneLeads.length,
          unavailableRegion: unavailableRegionLeads.length,
          cadence: statsRes.filter((lead) => lead.cadencia_ativa === true).length,
          tasksOpen: pendingTasks.length,
          tasksToday: pendingTasks.filter((task) => task.vencimento && new Date(task.vencimento).toDateString() === todayDate).length,
          revenueRealized: soldLeads.reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_comissao), 0),
          salesRealized: soldLeads.reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_negociacao), 0),
          salesPotential: statsRes
            .filter((lead) => activeRevenueStatuses.includes(normalizeLeadStatus(lead.status)))
            .reduce((sum, lead) => sum + parseCurrencyValue(lead.valor_negociacao), 0)
        });

        // Fetch Meta Account alerts for this broker specifically
        if (profile.corretor_id && accessToken) {
          setLoadingMeta(true);
          try {
            const response = await fetch('/api/integrations/meta/alerts', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                corretor_id: profile.corretor_id
              }),
            });
            if (response.ok) {
              const payload = await response.json();
              if (payload.accounts && payload.accounts.length > 0) {
                const matchingAcc = payload.accounts.find((acc: any) => acc.corretor_id === profile.corretor_id);
                setMetaAccount(matchingAcc || null);
              } else {
                setMetaAccount(null);
              }
            }
          } catch (err) {
            console.error('Error fetching broker meta status:', err);
          } finally {
            setLoadingMeta(false);
          }
        }

      } catch (err: unknown) {
        console.error("Dashboard general error:", err);
      } finally {
        setLoadingData(false);
      }
    }

    fetchCorretorData();
  }, [profile, dataInicio, dataFim]);

  const firstName = profile?.nome ? profile.nome.split(' ')[0] : '';
  const isDataLoading = authLoading || loadingData;

  useEffect(() => {
    if (!isDataLoading) {
      setChartAnimate(false);
      const timer = setTimeout(() => setChartAnimate(true), 150);
      return () => clearTimeout(timer);
    }
  }, [isDataLoading, stats]);

  const timeOperacional = Array.isArray(corretorData?.time_operacional)
    ? corretorData.time_operacional
    : [];

  const prevSlide = () => {
    if (timeOperacional.length <= 1) return;
    setCarouselIndex((prev) => (prev - 1 + timeOperacional.length) % timeOperacional.length);
  };

  const nextSlide = () => {
    if (timeOperacional.length <= 1) return;
    setCarouselIndex((prev) => (prev + 1) % timeOperacional.length);
  };

  useEffect(() => {
    if (timeOperacional.length <= 1) return;
    const interval = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % timeOperacional.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [timeOperacional.length]);

  const staleOpportunityCount = stats.stale;
  const maxCurrentMonthMetric = Math.max(
    stats.waiting,
    stats.inicio,
    stats.contactMade,
    stats.inProgress,
    stats.quoted,
    stats.sold,
    1
  );

  const performanceBars = [
    { 
      label: 'Início', 
      value: stats.inicio, 
      gradient: 'from-cyan-400 via-sky-400 to-blue-500', 
      glowColor: 'rgba(34, 211, 238, 0.4)' 
    },
    { 
      label: 'Contato feito', 
      value: stats.contactMade, 
      gradient: 'from-purple-500 via-pink-500 to-indigo-500', 
      glowColor: 'rgba(168, 85, 247, 0.4)' 
    },
    { 
      label: 'Em negociação', 
      value: stats.inProgress, 
      gradient: 'from-amber-500 via-orange-500 to-red-500', 
      glowColor: 'rgba(249, 115, 22, 0.4)' 
    },
    { 
      label: 'Cotações', 
      value: stats.quoted, 
      gradient: 'from-cyan-400 via-sky-500 to-blue-500', 
      glowColor: 'rgba(34, 211, 238, 0.4)' 
    },
    { 
      label: 'Vendas', 
      value: stats.sold, 
      gradient: 'from-emerald-400 via-teal-500 to-green-500', 
      glowColor: 'rgba(16, 185, 129, 0.4)' 
    },
  ];
  const maxMonthlyLeads = Math.max(...monthlyPerformance.map((month) => month.leads), 1);
  const maxMonthlySpend = Math.max(...monthlyPerformance.map((month) => month.spend), 1);
  const currentMonth = monthlyPerformance[monthlyPerformance.length - 1] || { leads: 0, spend: 0 };



  const periodCpl = stats.total > 0 ? periodSpend / stats.total : 0;
  const periodConversion = stats.total > 0 ? (stats.sold / stats.total) * 100 : 0;

  const periodLabelText = presetLabel === 'Todo o período'
    ? 'no período'
    : presetLabel === 'Este mês'
      ? 'deste mês'
      : presetLabel === 'Mês passado'
        ? 'do mês passado'
        : `de ${presetLabel.toLowerCase()}`;
  const displayPeriodCpl = stats.total > 0 ? periodCpl : null;

  const salesConversionRate = stats.total > 0 ? (stats.sold / stats.total) * 100 : 0;
  const allTimeSalesConversionRate = allTimeStats.total > 0 ? (allTimeStats.sold / allTimeStats.total) * 100 : 0;
  const chartHeight = 176;
  const maxWeeklyLeads = Math.max(...weeklyLeads.map((day) => day.leads), 1);
  const weeklyTotal = weeklyLeads.reduce((sum, day) => sum + day.leads, 0);
  const bestWeeklyDay = weeklyLeads.reduce((best, day) => day.leads > best.leads ? day : best, weeklyLeads[0] || { label: '-', leads: 0 });
  const maxCityLeads = Math.max(...topCities.map((city) => city.leads), 1);
  const activePipeline = stats.inicio + stats.contactMade + stats.inProgress + stats.quoted + stats.sold;
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
      detail: 'em atendimento',
      href: '/leads?status=Contato%20feito',
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
      detail: 'em atendimento',
      href: '/leads?status=Contato%20feito',
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
  ].filter((action) => {
    if (profile?.tipo_usuario === 'corretor_membro') {
      return !['Ajuda Orion', 'Treinamento', 'Reunião Alinhamento'].includes(action.label);
    }
    return true;
  });

  return (
    <InternalLayout>
      {/* Header Section */}
      <div className="mb-10 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-700">
        <div>
          <h1 className="mb-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl flex flex-wrap items-center gap-3">
            {isDataLoading ? (
              <span className="inline-block w-48 h-10 bg-gray-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span>Olá, {firstName}</span>
                {profile?.nome_empresa && (
                  <span className="text-sm font-black uppercase tracking-widest bg-blue-600/10 text-blue-400 border border-blue-500/20 px-3.5 py-1.5 rounded-2xl ml-2">
                    {profile.nome_empresa}
                  </span>
                )}
              </>
            )}
          </h1>
          <p className="text-base font-bold text-blue-600 sm:text-lg">Painel de crescimento comercial e aceleração de vendas</p>
        </div>
        <div className="relative flex flex-wrap items-center gap-3 shrink-0">
          
          {/* Custom Date Range Popover Button (Meta style) */}
          <div className="relative">
            <button
              onClick={() => setShowDatePicker((prev) => !prev)}
              className="flex items-center gap-3 bg-white/5 border border-white/5 hover:bg-white/10 transition px-5 py-3 rounded-2xl text-xs font-black text-white cursor-pointer select-none outline-none"
            >
              <CalendarDays size={16} className="text-blue-400 shrink-0" />
              <span className="font-extrabold">{presetLabel} {dataInicio && dataFim ? `(${formatDateDisplay(dataInicio, dataFim)})` : ''}</span>
              <ChevronDown size={14} className="text-slate-400 shrink-0" />
            </button>

            {/* Popover Dropdown Panel */}
            {showDatePicker && (
              <>
                <div 
                  className="fixed inset-0 z-40 cursor-default" 
                  onClick={() => setShowDatePicker(false)}
                />
                <div className="absolute right-0 top-14 z-50 flex flex-col md:flex-row gap-4 p-5 rounded-3xl bg-[#0b1324] border border-white/5 shadow-2xl shadow-slate-950/80 w-[95vw] sm:w-[480px] animate-in fade-in slide-in-from-top-2 duration-200">
                  
                  {/* Presets List */}
                  <div className="flex flex-col gap-1 md:w-44 border-r border-white/5 pr-3 shrink-0">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 pl-2">Atalhos rápidos</p>
                    {[
                      { id: 'todo_periodo', label: 'Todo o período' },
                      { id: 'hoje', label: 'Hoje' },
                      { id: 'ontem', label: 'Ontem' },
                      { id: '7dias', label: 'Últimos 7 dias' },
                      { id: '30dias', label: 'Últimos 30 dias' },
                      { id: 'este_mes', label: 'Este mês' },
                      { id: 'mes_passado', label: 'Mês passado' },
                    ].map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset.id)}
                        className="text-left w-full text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 px-3 py-2.5 rounded-xl transition cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom Input Range */}
                  <div className="flex-1 flex flex-col justify-between gap-4">
                    <div>
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Período Personalizado</p>
                      <div className="grid gap-3">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-400">Data de Início</span>
                          <div className="relative bg-white/5 border border-white/5 px-4 py-3 rounded-2xl flex items-center justify-between">
                            <span className="text-xs font-bold text-white">
                              {dataInicio ? formatDateDisplay(dataInicio, dataInicio).split(' a ')[0] : 'Selecione...'}
                            </span>
                            <CalendarDays size={14} className="text-slate-500" />
                            <input
                              type="date"
                              value={dataInicio}
                              onChange={(e) => {
                                setDataInicio(e.target.value);
                                setPresetLabel('Personalizado');
                              }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-400">Data de Fim</span>
                          <div className="relative bg-white/5 border border-white/5 px-4 py-3 rounded-2xl flex items-center justify-between">
                            <span className="text-xs font-bold text-white">
                              {dataFim ? formatDateDisplay(dataFim, dataFim).split(' a ')[0] : 'Selecione...'}
                            </span>
                            <CalendarDays size={14} className="text-slate-500" />
                            <input
                              type="date"
                              value={dataFim}
                              onChange={(e) => {
                                setDataFim(e.target.value);
                                setPresetLabel('Personalizado');
                              }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 border-t border-white/5 pt-3 mt-2">
                      <button
                        type="button"
                        onClick={() => setShowDatePicker(false)}
                        className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDatePicker(false)}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition shadow-lg shadow-blue-600/10 cursor-pointer"
                      >
                        Aplicar
                      </button>
                    </div>
                  </div>

                </div>
              </>
            )}
          </div>

          <Link href="/leads" className="bg-blue-600 text-white px-5 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-500/20 text-xs sm:text-sm whitespace-nowrap">
            Ver meus leads <ArrowRight size={16} />
          </Link>
          <Link href="/kanban" className="bg-white/5 text-white border border-white/5 px-5 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-white/10 transition-all text-xs sm:text-sm whitespace-nowrap">
            Abrir Kanban
          </Link>
        </div>
      </div>

      {/* Meta Ads Account Financial Status Bar */}
      {metaAccount && profile?.tipo_usuario !== 'corretor_membro' && (() => {
        const metaStatus = getBrokerMetaStatus(metaAccount, displayPeriodCpl, periodLabelText);
        if (!metaStatus) return null;

        const isCard = String(metaAccount.forma_pagamento || '').toLowerCase().includes('cartao') || 
                       String(metaAccount.forma_pagamento || '').toLowerCase().includes('cartão') ||
                       String(metaAccount.forma_pagamento || '').toLowerCase().includes('card') ||
                       String(metaAccount.forma_pagamento || '').toLowerCase().includes('visa') ||
                       String(metaAccount.forma_pagamento || '').toLowerCase().includes('mastercard');

        return (
          <div className={`mb-8 p-5 sm:p-6 rounded-[1.5rem] border backdrop-blur-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-all duration-300 animate-in fade-in slide-in-from-top-2 ${
            metaStatus.tone === 'red'
              ? 'bg-red-500/5 border-red-500/20 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.05)]'
              : metaStatus.tone === 'amber'
                ? 'bg-amber-500/5 border-amber-500/20 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.05)]'
                : 'bg-emerald-500/5 border-emerald-500/10 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.02)]'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                metaStatus.tone === 'red'
                  ? 'bg-red-500/10 text-red-400'
                  : metaStatus.tone === 'amber'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-emerald-500/10 text-emerald-400'
              }`}>
                {metaStatus.tone === 'red' ? (
                  <ShieldAlert size={22} className="animate-pulse" />
                ) : metaStatus.tone === 'amber' ? (
                  <AlertTriangle size={22} />
                ) : (
                  <CheckCircle2 size={22} />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-widest leading-none px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                    Status Meta Ads
                  </span>
                  <span className={`text-[10px] font-black uppercase tracking-widest leading-none px-2 py-0.5 rounded-full ${
                    metaStatus.tone === 'red'
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : metaStatus.tone === 'amber'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}>
                    {metaStatus.title}
                  </span>
                </div>
                <p className="mt-2 text-sm font-bold text-slate-200">{metaStatus.detail}</p>
              </div>
            </div>
            <div className="grid min-w-[180px] shrink-0 grid-cols-1 gap-3 border-t border-white/5 pt-3 text-left sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CPL {periodLabelText}</p>
                <p className="mt-1 text-xl font-black text-white">
                  {displayPeriodCpl === null
                    ? 'N/A'
                    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: metaAccount.currency || 'BRL' }).format(displayPeriodCpl)}
                </p>
              </div>
              {!isCard && metaAccount.saldo !== null && (
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Saldo da Conta</p>
                  <p className="mt-1 text-xl font-black text-white">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: metaAccount.currency || 'BRL' }).format(metaAccount.saldo)}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 🚀 STEP 1: KEY NUMBERS AT THE VERY TOP (Swapped General Performance StatCards here!) */}
      <div className="mb-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-4">
          <Link href="/leads">
            <StatCard title="Leads recebidos" value={stats.total} icon={Users} color="blue" loading={isDataLoading} />
          </Link>
          <Link href="/leads?status=Inicio">
            <StatCard title="Início" value={stats.inicio} icon={MessageSquare} color="cyan" loading={isDataLoading} />
          </Link>
          <Link href="/leads?status=Contato feito">
            <StatCard title="Contato feito" value={stats.contactMade} icon={Target} color="purple" loading={isDataLoading} />
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
          <Link href="/leads?status=Sem interesse">
            <StatCard title="Vendas perdidas" value={stats.lost} icon={ShieldAlert} color="red" loading={isDataLoading} />
          </Link>
          <Link href="/crm?filtro=tarefas">
            <StatCard title="Follow up" value={stats.tasksOpen} icon={CalendarDays} color="blue" loading={isDataLoading} />
          </Link>
        </div>
      </div>

      {/* 🚀 STEP 2: THE GORGEOUS 2-COLUMN MAIN CHARTS SECTION */}
      <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Column 1: SVG Curved Area Growth Chart (Meta Ads x Leads Growth) */}
        {profile?.tipo_usuario !== 'corretor_membro' && (
          <div className="rounded-[1.5rem] border border-slate-100 bg-[#090e1a] p-5 shadow-xl sm:rounded-[2rem] sm:p-6 lg:col-span-3">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="mb-1 text-xs sm:text-sm font-black uppercase tracking-[0.2em] text-cyan-400">Evolução Mensal</p>
                <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">Investimento Meta x Leads</h2>
              </div>
              <div className="text-right">
                <p className="text-xs sm:text-sm font-bold text-slate-400 uppercase tracking-wider">Últimos 6 meses</p>
                <div className="mt-2 flex items-center gap-5 text-xs sm:text-sm font-extrabold uppercase">
                  <span className="flex items-center gap-2 text-cyan-400">
                    <span className="h-3 w-3 rounded-full bg-cyan-400" /> Investimento
                  </span>
                  <span className="flex items-center gap-2 text-emerald-400">
                    <span className="h-3 w-3 rounded-full bg-emerald-400" /> Leads
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
        )}

        {/* Column 2: Gorgeous concentric glowing SVG Pizza (Donut) Chart */}
        <div className={`rounded-[1.5rem] border border-slate-100 bg-[#090e1a] p-5 shadow-xl sm:rounded-[2rem] sm:p-6 ${
          profile?.tipo_usuario === 'corretor_membro' ? 'lg:col-span-5' : 'lg:col-span-2'
        }`}>
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-purple-400">Distribuição de Leads</p>
              <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">Leads por Etapa</h2>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/5 px-4 py-2.5 text-right shrink-0">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Total Geral</p>
              <p className="mt-1.5 text-lg font-black text-white leading-none">
                {stats.waiting + stats.inicio + stats.contactMade + stats.inProgress + stats.quoted + stats.sold + stats.lost}
              </p>
            </div>
          </div>
          <div className="min-h-[220px] flex items-center justify-center">
            {isDataLoading ? (
              <Loader2 className="animate-spin text-purple-500" size={32} />
            ) : (
              <CustomDonutPizzaChart
                oportunidade={stats.waiting}
                inicio={stats.inicio}
                contactMade={stats.contactMade}
                inProgress={stats.inProgress}
                quoted={stats.quoted}
                sold={stats.sold}
                lost={stats.lost}
                invalid={stats.invalid}
                unavailableRegion={stats.unavailableRegion}
              />
            )}
          </div>
        </div>
      </div>

      {/* 🚀 STEP 3: FINANCIAL INDICATORS GRID WITH GLOWING ACCENTS OR OPERATIONAL STATS FOR MEMBERS */}
      {profile?.tipo_usuario === 'corretor_membro' ? (
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[1.5rem] border border-slate-200 dark:border-white/5 bg-white dark:bg-[#090e1a] p-5 shadow-md hover:-translate-y-1 hover:border-blue-500/20 transition-all duration-300">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Leads Atribuídos</p>
              <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
                <Users size={16} />
              </div>
            </div>
            <p className="text-3xl font-black text-slate-900 dark:text-white">{stats.total}</p>
            <div className="mt-2.5 text-[10px] font-bold text-slate-400 border-t border-slate-100 dark:border-white/5 pt-2">
              total de leads no seu projeto
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 dark:border-white/5 bg-white dark:bg-[#090e1a] p-5 shadow-md hover:-translate-y-1 hover:border-amber-500/20 transition-all duration-300">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Aguardando Resposta</p>
              <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
                <Clock size={16} />
              </div>
            </div>
            <p className="text-3xl font-black text-slate-900 dark:text-white">{stats.waiting}</p>
            <div className="mt-2.5 text-[10px] font-bold text-amber-500 border-t border-slate-100 dark:border-white/5 pt-2">
              leads aguardando primeiro atendimento
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 dark:border-white/5 bg-white dark:bg-[#090e1a] p-5 shadow-md hover:-translate-y-1 hover:border-purple-500/20 transition-all duration-300">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Últimos 7 dias</p>
              <div className="p-2 bg-purple-500/10 text-purple-400 rounded-xl">
                <CalendarDays size={16} />
              </div>
            </div>
            <p className="text-3xl font-black text-slate-900 dark:text-white">
              {weeklyLeads.reduce((sum, item) => sum + item.leads, 0)}
            </p>
            <div className="mt-2.5 text-[10px] font-bold text-purple-400 border-t border-slate-100 dark:border-white/5 pt-2">
              novos leads recebidos nesta semana
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 dark:border-white/5 bg-white dark:bg-[#090e1a] p-5 shadow-md hover:-translate-y-1 hover:border-emerald-500/20 transition-all duration-300">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Minhas Tarefas</p>
              <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                <CheckCircle2 size={16} />
              </div>
            </div>
            <p className="text-3xl font-black text-slate-900 dark:text-white">{stats.tasksOpen}</p>
            <div className="mt-2.5 flex items-center justify-between text-[10px] font-bold text-slate-400 border-t border-slate-100 dark:border-white/5 pt-2">
              <span>{stats.tasksToday} para hoje</span>
              <span className="text-emerald-500">follow-ups agendados</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-md hover:-translate-y-1 hover:border-cyan-500/20 transition-all duration-300">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Taxa de Conversão</p>
              <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-xl">
                <Target size={16} />
              </div>
            </div>
            <p className="text-3xl font-black text-white">{allTimeSalesConversionRate.toFixed(1).replace('.', ',')}%</p>
            <div className="mt-2.5 flex items-center justify-between text-[10px] font-bold text-slate-400 border-t border-white/5 pt-2">
              <span>✓ {allTimeStats.sold} vendas</span>
              <span>{allTimeStats.total} leads</span>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-md hover:-translate-y-1 hover:border-emerald-500/20 transition-all duration-300">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Comissão Vendida</p>
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
                <DollarSign size={16} />
              </div>
            </div>
            <p className="text-3xl font-black text-white">{formatCurrency(allTimeStats.revenueRealized)}</p>
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
            <p className="text-3xl font-black text-white">{formatCurrency(allTimeStats.salesPotential)}</p>
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
            <p className="text-3xl font-black text-white">{formatCurrency(allTimeStats.salesRealized)}</p>
            <div className="mt-2.5 text-[10px] font-bold text-blue-400 border-t border-white/5 pt-2">
              soma das vendas realizadas
            </div>
          </div>
        </div>
      )}

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

        <div className="grid gap-6 grid-cols-1 xl:grid-cols-[1.35fr_0.65fr] p-4 sm:p-6">
          {/* Left: Responsive 3D Glass Interactive Funnel */}
          <div className="rounded-[1.5rem] border border-white/5 bg-[#090e1a] p-5 shadow-xl sm:rounded-[2rem] sm:p-7 flex flex-col justify-between">
            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
                <Target size={24} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-400">Funil comercial</p>
                <h3 className="text-2xl font-black tracking-tight text-white">Performance por etapa</h3>
              </div>
            </div>

            <OrionFunnel
              total={stats.total}
              activePipeline={activePipeline}
              quotedAndSold={stats.quoted + stats.sold}
              sold={stats.sold}
            />
          </div>

          {/* Right: Monthly Commercial Context & Connected Broker */}
          <div className="rounded-[1.5rem] border border-white/5 bg-[#090e1a] p-5 shadow-xl sm:rounded-[2rem] sm:p-7 flex flex-col justify-between">
            <div>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="mb-1 text-xs font-black uppercase tracking-widest text-cyan-400">Resumo {periodLabelText}</p>
                  <h2 className="text-xl font-black text-white">Perfil comercial</h2>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
                  <BarChart3 size={20} />
                </div>
              </div>
              {profile?.tipo_usuario === 'corretor_membro' ? (
                <div className="grid grid-cols-2 gap-3">
                  <MiniMetric icon={Users} label={`Leads ${periodLabelText}`} value={stats.total} />
                  <MiniMetric icon={Clock} label="Aguardando Resposta" value={stats.waiting} />
                  <MiniMetric icon={CalendarDays} label="Follow up" value={stats.tasksOpen} />
                  <MiniMetric icon={TrendingUp} label={`Conversão ${periodLabelText}`} value={`${periodConversion.toFixed(1).replace('.', ',')}%`} />
                  <MiniMetric icon={Clock} label="Em negociação" value={stats.inProgress} />
                  <MiniMetric icon={TrendingUp} label="Vendas" value={stats.sold} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <MiniMetric icon={Users} label={`Leads ${periodLabelText}`} value={stats.total} />
                  <MiniMetric icon={DollarSign} label={`Investido ${periodLabelText}`} value={formatCurrency(periodSpend)} />
                  <MiniMetric icon={Target} label={`CPL ${periodLabelText}`} value={displayPeriodCpl === null ? 'N/A' : formatCurrency(displayPeriodCpl)} />
                  <MiniMetric icon={TrendingUp} label={`Conversão ${periodLabelText}`} value={`${periodConversion.toFixed(1).replace('.', ',')}%`} />
                  <MiniMetric icon={Clock} label="Em negociação" value={stats.inProgress} />
                  <MiniMetric icon={TrendingUp} label="Vendas" value={stats.sold} />
                </div>
              )}
            </div>
            <div className="mt-8 rounded-2xl bg-[#0b1324] border border-white/5 p-4 text-left">
              <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Corretor Conectado</p>
              <p className="text-sm font-black text-white">{corretorData?.nome || profile?.nome || '-'}</p>
              {(corretorData?.nome_empresa || profile?.nome_empresa) && (
                <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-cyan-300">
                  {corretorData?.nome_empresa || profile?.nome_empresa}
                </p>
              )}
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
            {performanceBars.map((bar, index) => {
              const barWidth = chartAnimate 
                ? `${(bar.value / maxCurrentMonthMetric) * 100}%` 
                : '0%';

              return (
                <div key={bar.label} className="group/stage">
                  <div className="mb-2 flex justify-between text-xs font-bold text-slate-400">
                    <span className="font-extrabold text-white">{bar.label}</span>
                    <span>{bar.value}</span>
                  </div>
                  <div className="h-3.5 overflow-hidden rounded-full bg-[#070b13] border border-white/5 relative shadow-inner">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${bar.gradient} transition-all duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/stage:brightness-110`}
                      style={{
                        width: barWidth,
                        boxShadow: `0 0 10px ${bar.glowColor}`,
                        transitionDelay: `${index * 80}ms`
                      }}
                    />
                  </div>
                </div>
              );
            })}
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

      {/* 🚀 STEP 8: OPERATIONAL TEAM SECTION (With Carousel & Large full-body photos) */}
      <div className="mb-10 rounded-[2rem] border border-white/5 bg-[#090e1a] p-5 sm:rounded-[3rem] sm:p-10 overflow-hidden">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight mb-2">Seu time Orion</h2>
            <p className="text-slate-400 font-medium">Por tras de toda concessionaria campea, existe um time jogando junto.</p>
          </div>
        </div>

        {isDataLoading ? (
          <div className="flex gap-6 overflow-hidden">
             <div className="w-[300px] h-[460px] bg-[#070b13] border border-white/5 rounded-[2.5rem] animate-pulse flex-shrink-0" />
             <div className="w-[300px] h-[460px] bg-[#070b13] border border-white/5 rounded-[2.5rem] animate-pulse flex-shrink-0" />
             <div className="w-[300px] h-[460px] bg-[#070b13] border border-white/5 rounded-[2.5rem] animate-pulse flex-shrink-0" />
          </div>
        ) : timeOperacional.length === 0 ? (
          <div className="bg-[#070b13] p-8 rounded-[2rem] border border-white/5 text-center">
             <p className="text-slate-400 font-bold italic">Seu time operacional ainda não foi definido. Fale com a Orion.</p>
          </div>
        ) : (
          <div className="relative w-full overflow-hidden py-2 px-1">
            <style>{`
              @keyframes marqueeContinuous {
                0% {
                  transform: translateX(0);
                }
                100% {
                  transform: translateX(-33.3333%);
                }
              }
              .animate-marquee-continuous {
                display: flex;
                gap: 1.5rem;
                width: max-content;
                animation: marqueeContinuous 35s linear infinite;
              }
              .animate-marquee-continuous:hover {
                animation-play-state: paused;
              }
            `}</style>
            <div className="animate-marquee-continuous">
              {[...timeOperacional, ...timeOperacional, ...timeOperacional].map((membro, index: number) => {
                const foto = getTeamMemberPhoto(membro.nome);

                return (
                  <div 
                    key={`${membro.nome}-${index}`} 
                    className="bg-[#070b13] p-5 rounded-[2.5rem] border border-white/5 shadow-2xl flex flex-col justify-between h-[460px] group hover:scale-[1.02] hover:border-blue-500/25 transition-all duration-500 hover:shadow-blue-500/5 select-none shrink-0 w-[300px]"
                  >
                    {/* Large Full-Body/Portrait Photo (Not cropped in a small square, beautiful rounded container) */}
                    <div className="w-full h-[340px] relative rounded-[2rem] overflow-hidden border border-white/5 bg-[#090f1d] mb-4">
                      {foto ? (
                        <img 
                          src={foto} 
                          alt={membro.nome}
                          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-700 pointer-events-none"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-black text-6xl shadow-inner select-none pointer-events-none">
                          {membro.nome?.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Team Details */}
                    <div className="text-center pb-2">
                      <h3 className="font-black text-lg text-white mb-1 leading-tight group-hover:text-blue-400 transition-colors">{membro.nome}</h3>
                      <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{membro.cargo}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}

function MiniMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#0b1324] p-4 shadow-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-blue-400">
        <Icon size={17} />
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-lg sm:text-xl font-black text-white">{value}</p>
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    let start: number;
    const duration = 1600; // Smooth 1.6s transition
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / duration, 1);
      // Nice organic cubic ease
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
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

  // Calculate animated points rising up staggered from left to right (climbing effect)
  const spendPoints = baseSpendPoints.map((p, i) => {
    const startPct = (i / Math.max(data.length, 1)) * 0.45; // Stagger start from 0 to 0.45
    const pointProgress = Math.max(0, Math.min(1, (animationProgress - startPct) / 0.55));
    const pointEase = 1 - Math.pow(1 - pointProgress, 3); // ease out cubic
    const animatedY = 170 - (170 - p.y) * pointEase;
    return { x: p.x, y: animatedY };
  });

  const leadPoints = baseLeadPoints.map((p, i) => {
    const startPct = (i / Math.max(data.length, 1)) * 0.45;
    const pointProgress = Math.max(0, Math.min(1, (animationProgress - startPct) / 0.55));
    const pointEase = 1 - Math.pow(1 - pointProgress, 3);
    const animatedY = 170 - (170 - p.y) * pointEase;
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

        {/* Vertical Highlight dashed line on active month hover */}
        {hoveredIndex !== null && (
          <line
            x1={spendPoints[hoveredIndex].x}
            y1={padding}
            x2={spendPoints[hoveredIndex].x}
            y2={height - padding}
            stroke="rgba(255, 255, 255, 0.15)"
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Neon Stroke Lines */}
        <path
          d={getLinePath(spendPoints)}
          fill="none"
          stroke="#06b6d4"
          strokeWidth="3.5"
          strokeLinecap="round"
          filter="drop-shadow(0 0 5px rgba(6, 182, 212, 0.55))"
        />
        <path
          d={getLinePath(leadPoints)}
          fill="none"
          stroke="#10b981"
          strokeWidth="3.5"
          strokeLinecap="round"
          filter="drop-shadow(0 0 5px rgba(16, 185, 129, 0.55))"
        />

        {/* Nodes and Labels */}
        {data.map((d, i) => {
          const sp = spendPoints[i];
          const lp = leadPoints[i];
          
          // Staggered node opacity and scaling based on left-to-right timeline
          const startPct = (i / Math.max(data.length, 1)) * 0.45;
          const pointProgress = Math.max(0, Math.min(1, (animationProgress - startPct) / 0.55));
          const pointEase = 1 - Math.pow(1 - pointProgress, 3);
          const nodeOpacity = pointProgress;
          const nodeScale = 0.3 + 0.7 * pointEase;

          const isHovered = hoveredIndex === i;

          return (
            <g key={i} style={{ opacity: nodeOpacity }}>
              {/* Spend Node */}
              <circle
                cx={sp.x}
                cy={sp.y}
                r={isHovered ? "6" : "5"}
                fill="#ffffff"
                stroke="#06b6d4"
                strokeWidth="2.5"
                style={{ 
                  filter: 'drop-shadow(0 0 5px rgba(6, 182, 212, 0.8))',
                  transform: `scale(${nodeScale})`,
                  transformOrigin: `${sp.x}px ${sp.y}px`,
                  transition: 'all 0.15s ease'
                }}
              />

              {/* Leads Node */}
              <circle
                cx={lp.x}
                cy={lp.y}
                r={isHovered ? "6" : "5"}
                fill="#ffffff"
                stroke="#10b981"
                strokeWidth="2.5"
                style={{ 
                  filter: 'drop-shadow(0 0 5px rgba(16, 185, 129, 0.8))',
                  transform: `scale(${nodeScale})`,
                  transformOrigin: `${lp.x}px ${lp.y}px`,
                  transition: 'all 0.15s ease'
                }}
              />

              {/* Month Label */}
              <text
                x={sp.x}
                y={height - 4}
                textAnchor="middle"
                fill={isHovered ? "#ffffff" : "#cbd5e1"}
                fontSize="12"
                fontWeight="900"
                className="uppercase tracking-wider font-extrabold select-none transition-colors duration-200"
              >
                {d.label}
              </text>
            </g>
          );
        })}

        {/* Large Transparent Full-Height Vertical Hover Columns */}
        {data.map((d, i) => {
          const sp = spendPoints[i];
          const colW = chartW / Math.max(data.length - 1, 1);
          const x = sp.x - colW / 2;
          
          return (
            <rect
              key={i}
              x={x}
              y={padding}
              width={colW}
              height={chartH}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          );
        })}
      </svg>

      {/* Premium Combined Unified Tooltip */}
      {hoveredIndex !== null && (() => {
        const d = data[hoveredIndex];
        const sp = spendPoints[hoveredIndex];
        const lp = leadPoints[hoveredIndex];
        const tooltipX = sp.x;
        const tooltipY = Math.min(sp.y, lp.y) - 20;

        return (
          <div
            className="absolute z-30 pointer-events-none rounded-2xl bg-slate-950/95 border border-white/10 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-150 flex flex-col gap-1.5 text-left min-w-[170px]"
            style={{
              left: `${(tooltipX / width) * 100}%`,
              top: `${(tooltipY / height) * 100}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 border-b border-white/5 pb-1.5 mb-1.5 leading-none">
              {d.label}
            </p>
            <div className="flex items-center gap-4 text-xs justify-between leading-none">
              <span className="text-cyan-400 flex items-center gap-1.5 font-extrabold uppercase tracking-wider text-[10px]">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shrink-0" /> Investimento
              </span>
              <span className="text-white font-black">{formatCurrency(d.spend)}</span>
            </div>
            <div className="flex items-center gap-4 text-xs justify-between leading-none">
              <span className="text-emerald-400 flex items-center gap-1.5 font-extrabold uppercase tracking-wider text-[10px]">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shrink-0" /> Leads
              </span>
              <span className="text-white font-black">{d.leads} leads</span>
            </div>
            {/* Arrow */}
            <div className="absolute left-1/2 bottom-0 h-2 w-2 -translate-x-1/2 translate-y-1/2 rotate-45 border-r border-b border-white/10 bg-slate-950" />
          </div>
        );
      })()}
    </div>
  );
}

function CustomDonutPizzaChart({
  oportunidade,
  inicio,
  contactMade,
  inProgress,
  quoted,
  sold,
  lost,
  invalid,
  unavailableRegion
}: {
  oportunidade: number;
  inicio: number;
  contactMade: number;
  inProgress: number;
  quoted: number;
  sold: number;
  lost: number;
  invalid: number;
  unavailableRegion: number;
}) {
  const [animatedTotal, setAnimatedTotal] = useState(0);

  const total = (oportunidade + inicio + contactMade + inProgress + quoted + sold + lost + invalid + unavailableRegion) || 0;
  const slices = [
    { label: 'Oportunidade', value: oportunidade, color: '#3b82f6' },
    { label: 'Início', value: inicio, color: '#06b6d4' },
    { label: 'Contato feito', value: contactMade, color: '#a78bfa' },
    { label: 'Negociação', value: inProgress, color: '#f59e0b' },
    { label: 'Proposta', value: quoted, color: '#38bdf8' },
    { label: 'Vendas', value: sold, color: '#10b981' },
    { label: 'Vendas perdidas', value: lost, color: '#64748b' },
    { label: 'Telefone invalido', value: invalid, color: '#ef4444' },
    { label: 'Regiao indisponivel', value: unavailableRegion, color: '#94a3b8' }
  ].filter(s => s.value > 0);

  // Default values if all are zero
  const displaySlices = slices.length > 0 ? slices : [
    { label: 'Oportunidade', value: 0, color: '#3b82f6' },
    { label: 'Início', value: 0, color: '#06b6d4' },
    { label: 'Contato feito', value: 0, color: '#a78bfa' },
    { label: 'Negociação', value: 0, color: '#f59e0b' },
    { label: 'Proposta', value: 0, color: '#38bdf8' }
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
    <div className="flex flex-col items-center gap-8 justify-center w-full py-2">
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

      {/* Enlarged premium detailed data legend (Centered below the Orb with full width columns) */}
      <div className="grid grid-cols-2 gap-3 text-left w-full max-w-sm sm:max-w-md">
        {displaySlices.map((slice, i) => (
          <div 
            key={i} 
            className="flex items-center gap-3 text-xs p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-300 shadow-md min-w-0"
            title={`${slice.label}: ${slice.value} leads`}
          >
            <span 
              className="h-3 w-3 rounded-full shrink-0 animate-pulse shadow-sm" 
              style={{ 
                backgroundColor: slice.color,
                boxShadow: `0 0 8px ${slice.color}`
              }} 
            />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-white leading-tight text-xs sm:text-sm truncate" title={slice.label}>{slice.label}</p>
              <p className="text-[10px] font-bold text-slate-300 mt-0.5">
                {slice.value} leads <span className="text-slate-400 font-bold">({displayTotal > 0 ? ((slice.value / displayTotal) * 100).toFixed(0) : '0'}%)</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

