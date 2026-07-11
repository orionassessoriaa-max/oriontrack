'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Users, 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  ArrowRight,
  UserPlus,
  Loader2,
  Calendar,
  AlertTriangle,
  Globe,
  FileSearch,
  CheckCircle2,
  ChevronRight,
  ShieldAlert,
  Sparkles,
  Trophy,
  Clock,
  RefreshCw,
  Activity,
  MousePointerClick,
  Eye
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import Link from 'next/link';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getOnboardingStatus } from '@/lib/onboarding';
import MetaDatePicker from '@/components/ui/MetaDatePicker';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

type Corretor = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  link_pagina: string | null;
  gestor_trafego_id: string | null;
  campanhas_ativas: boolean;
  onboarding_status: 'pendente' | 'dados_completos' | 'campanhas_ativas' | null | undefined;
  time_operacional: any;
  created_at: string;
};

type MetaAccountAlert = {
  corretor_id: string;
  corretor_nome: string;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
  ctr: number;
  cpc?: number;
  cpm?: number;
  frequency?: number;
  link_clicks?: number;
  landing_page_views?: number;
  cost_per_link_click?: number;
  cost_per_landing_page_view?: number;
  saldo: number | null;
  currency: string;
  forma_pagamento?: string;
  alerta_cpl_alto: boolean;
  alerta_cpl_atencao?: boolean;
  alerta_metricas_secundarias?: boolean;
  alerta_saldo_baixo: boolean;
  dados_crm_pendentes?: boolean;
  error?: string;
};

function formatCurrency(value: number | null | undefined, currency = 'BRL') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0,00%';
  return `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function classifyMetaAccount(account: MetaAccountAlert) {
  const paymentText = String(account.forma_pagamento || '').toLowerCase();
  const isCard = paymentText.includes('cartao') || paymentText.includes('cartão') || paymentText.includes('card') || paymentText.includes('visa') || paymentText.includes('mastercard');
  const hasPaymentError = account.error && /pagamento|payment|recusad|failed|declined|settle|cobrança|cobranca|cartao|cartão|card|invoice|unpaid|error/i.test(String(account.error));

  if (account.error && !hasPaymentError) return { label: 'Erro Meta', tone: 'amber', detail: account.error };
  if (isCard && hasPaymentError) return { label: 'Erro pagamento', tone: 'red', detail: 'Falha no processamento do cartão. Admin deve acompanhar.' };
  if (!isCard && account.saldo !== null && account.saldo <= 0) return { label: 'Sem saldo', tone: 'red', detail: 'Conta pré-paga sem saldo. Admin deve ser avisado.' };
  if (account.alerta_cpl_alto) return { label: 'CPL crítico', tone: 'red', detail: 'CPL chegou a R$ 28,00 ou mais. Revisão obrigatória antes de qualquer ação.' };
  if (account.dados_crm_pendentes) return { label: 'CRM pendente', tone: 'blue', detail: 'Existe investimento na Meta, mas nenhum lead no CRM. Conferir importação antes de julgar o CPL.' };
  if (account.alerta_cpl_atencao || account.alerta_metricas_secundarias) return { label: 'Em atenção', tone: 'amber', detail: 'CPL acima de R$ 20,00. Avaliar CPC, CTR, CPM, página de destino e frequência.' };
  if (!isCard && account.alerta_saldo_baixo) return { label: 'Saldo baixo', tone: 'amber', detail: 'Saldo abaixo do mínimo operacional.' };
  return { label: 'Saudável', tone: 'emerald', detail: 'Sem alerta crítico no período selecionado.' };
}

export default function GestorDashboardPage() {
  const { profile } = useAuth();
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState(0);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccountAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertsUpdatedAt, setAlertsUpdatedAt] = useState<string | null>(null);
  const [presetLabel, setPresetLabel] = useState('Todo o período');
  const [error, setError] = useState<string | null>(null);

  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    setDataInicio('2025-01-01');
    setDataFim(todayStr);
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [profile?.id, dataInicio, dataFim]);

  const fetchDashboardData = async () => {
    if (!profile?.id) return;
    
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch all active brokers
      const { data: corretoresData, error: cError } = await supabase
        .from('corretores')
        .select('*')
        .in('status', ['active', 'ativo', 'Ativo'])
        .order('nome', { ascending: true });

      if (cError) throw cError;

      // Filter brokers where current user is their traffic manager
      let filteredCorretores: Corretor[] = corretoresData || [];
      if (profile.tipo_usuario === 'gestor_trafego') {
        filteredCorretores = filteredCorretores.filter(c => isGestorLinkedToConcessionariaCorretor(c, profile));
      }
      setCorretores(filteredCorretores);

      // 2. Fetch total leads for these brokers
      if (filteredCorretores.length > 0) {
        const brokerIds = filteredCorretores.map(c => c.id);
        let leadsRequest = supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('corretor_id', brokerIds);

        if (dataInicio) {
          leadsRequest = leadsRequest.gte('data_entrada', `${dataInicio}T00:00:00.000Z`);
        }
        if (dataFim) {
          leadsRequest = leadsRequest.lte('data_entrada', `${dataFim}T23:59:59.999Z`);
        }

        const { count, error: lError } = await leadsRequest;

        if (lError) console.error('Error fetching leads count:', lError);
        setTotalLeads(count || 0);
      }

      // 3. Fetch Meta Ads alerts to identify critical accounts under gestor management
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (accessToken) {
        setLoadingAlerts(true);
        try {
          const response = await fetch('/api/integrations/meta/alerts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({}),
          });
          if (response.ok) {
            const payload = await response.json();
            setMetaAccounts(payload.accounts || []);
            setAlertsUpdatedAt(payload.refreshed_at || new Date().toISOString());
          }
        } catch (err) {
          console.error('Error loading critical accounts on gestor dashboard:', err);
        } finally {
          setLoadingAlerts(false);
        }
      }
    } catch (err: any) {
      console.error('Error loading gestor dashboard:', err);
      setError('Erro ao carregar dados do painel.');
    } finally {
      setLoading(false);
    }
  };

  const activeCampaignsCount = corretores.filter(c => c.campanhas_ativas).length;
  const pendingOnboardingCount = corretores.filter(c => !c.onboarding_status || c.onboarding_status === 'pendente').length;
  const reviewAccounts = metaAccounts
    .map((account) => ({ account, status: classifyMetaAccount(account) }))
    .filter(({ status }) => status.label !== 'Saudável');
  const criticalReviewCount = reviewAccounts.filter(({ status }) => status.tone === 'red').length;
  const attentionReviewCount = reviewAccounts.filter(({ status }) => status.tone === 'amber').length;
  const crmPendingCount = reviewAccounts.filter(({ status }) => status.label === 'CRM pendente').length;

  const quickActions = [
    {
      title: 'Leads dos Corretores',
      desc: 'Visualizar e gerenciar leads',
      href: '/trafego/leads',
      icon: FileSearch,
      color: 'from-blue-600 to-indigo-600',
      borderColor: 'border-blue-500/20 hover:border-blue-500/50'
    },
    {
      title: 'Entrada de Corretor',
      desc: 'Liberar acessos e operadoras',
      href: '/trafego/entrada',
      icon: UserPlus,
      color: 'from-cyan-600 to-blue-600',
      borderColor: 'border-cyan-500/20 hover:border-cyan-500/50'
    },
    {
      title: 'Avisos Meta',
      desc: 'Acompanhar bloqueios ou alertas',
      href: '/trafego/avisos-meta',
      icon: AlertTriangle,
      color: 'from-amber-600 to-orange-600',
      borderColor: 'border-amber-500/20 hover:border-amber-500/50'
    },
    {
      title: 'Gerar Relatório',
      desc: 'Extrair CPL e investimento',
      href: '/trafego/relatorios',
      icon: TrendingUp,
      color: 'from-emerald-600 to-teal-600',
      borderColor: 'border-emerald-500/20 hover:border-emerald-500/50'
    },
  ];

  return (
    <InternalLayout>
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-2">
              Gestão de Tráfego
            </h1>
            <span className="bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-400/20">
              Operacional
            </span>
          </div>
          <p className="text-slate-400 font-medium text-base sm:text-lg">Monitore campanhas, CPL de clientes e onboarding técnico.</p>
        </div>
        <div className="bg-[#090e1a]/80 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/5 shadow-2xl flex items-center gap-4">
          <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-cyan-400">
            <Calendar size={20} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1.5">Data Atual</p>
            <p className="font-extrabold text-white leading-none">
              {format(new Date(), "dd 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#090e1a]/85 border border-white/5 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-white/5 text-cyan-400 rounded-xl">
            <Calendar size={18} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1.5">Filtrar Período</p>
            <p className="text-xs font-black text-white leading-none">Monitoramento de leads do período</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <MetaDatePicker
            startDate={dataInicio}
            endDate={dataFim}
            preset={presetLabel}
            onChange={(start, end, label) => {
              setDataInicio(start);
              setDataFim(end);
              setPresetLabel(label);
            }}
          />
        </div>
      </div>

      {loading ? (
        <div className="py-32 flex flex-col items-center justify-center">
          <Loader2 className="animate-spin text-cyan-400 mb-4" size={40} />
          <p className="text-slate-400 font-extrabold uppercase tracking-widest text-xs">Carregando painel...</p>
        </div>
      ) : error ? (
        <div className="py-24 text-center">
          <div className="w-16 h-16 bg-red-500/10 text-red-400 border border-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShieldAlert size={32} />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Erro Operacional</h3>
          <p className="text-slate-400 font-medium max-w-md mx-auto mb-6">{error}</p>
          <button 
            onClick={fetchDashboardData}
            className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-white/10"
          >
            Tentar Novamente
          </button>
        </div>
      ) : (
        <>
          {/* Central de Revisao Meta / CRM */}
          <div className="mb-10 rounded-[2rem] border border-white/5 bg-[#090e1a]/85 p-6 shadow-2xl backdrop-blur-md">
            <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
                  <Activity size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">MVP de otimização</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-white">Revisão Meta com leads reais do CRM</h2>
                  <p className="mt-1 max-w-3xl text-sm font-semibold leading-relaxed text-slate-400">
                    O sistema monitora as contas conectadas, calcula CPL usando somente leads do CRM e separa o que é crítico, atenção ou apenas dado pendente. Nenhuma campanha é pausada automaticamente neste MVP.
                  </p>
                </div>
              </div>
              <button
                onClick={fetchDashboardData}
                disabled={loading || loadingAlerts}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingAlerts ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                Revisar contas
              </button>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-2xl border border-red-500/15 bg-red-500/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-red-300">Crítico</p>
                <p className="mt-2 text-3xl font-black text-white">{criticalReviewCount}</p>
                <p className="mt-1 text-xs font-bold text-red-200/80">CPL &gt;= R$ 28, sem saldo ou erro de pagamento.</p>
              </div>
              <div className="rounded-2xl border border-amber-500/15 bg-amber-500/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Atenção</p>
                <p className="mt-2 text-3xl font-black text-white">{attentionReviewCount}</p>
                <p className="mt-1 text-xs font-bold text-amber-200/80">CPL &gt;= R$ 20 exige leitura das métricas secundárias.</p>
              </div>
              <div className="rounded-2xl border border-blue-500/15 bg-blue-500/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-300">CRM pendente</p>
                <p className="mt-2 text-3xl font-black text-white">{crmPendingCount}</p>
                <p className="mt-1 text-xs font-bold text-blue-200/80">Investimento existe, mas ainda nao ha leads no CRM.</p>
              </div>
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Contas lidas</p>
                <p className="mt-2 text-3xl font-black text-white">{metaAccounts.length}</p>
                <p className="mt-1 text-xs font-bold text-emerald-200/80">Base conectada via Meta, leads conferidos no Orion.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ultima revisao</p>
                <p className="mt-2 text-sm font-black text-white">{alertsUpdatedAt ? new Date(alertsUpdatedAt).toLocaleString('pt-BR') : 'Ainda nao revisado'}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">Rotina prevista: 2 vezes ao dia + revisão manual.</p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-white">Contas para revisar agora</h3>
                    <p className="text-xs font-bold text-slate-500">Ordenadas por risco operacional. Danilo deve aparecer fiel quando os leads estiverem no CRM.</p>
                  </div>
                  <Link href="/trafego/avisos-meta" className="text-[10px] font-black uppercase tracking-widest text-cyan-300 hover:text-cyan-200">
                    Ver todos
                  </Link>
                </div>

                <div className="space-y-3">
                  {loadingAlerts ? (
                    <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={24} /></div>
                  ) : reviewAccounts.length === 0 ? (
                    <p className="rounded-xl border border-white/5 bg-white/[0.02] p-5 text-sm font-bold text-slate-400">Nenhum alerta para revisar no periodo selecionado.</p>
                  ) : reviewAccounts.slice(0, 6).map(({ account, status }) => (
                    <div key={`${account.corretor_id}-${account.meta_ad_account_id}`} className="rounded-2xl border border-white/5 bg-white/[0.025] p-4 transition hover:border-cyan-400/25 hover:bg-white/[0.04]">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-white">{account.corretor_nome}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-500">{account.meta_ad_account_name || `act_${account.meta_ad_account_id}`}</p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest ${
                          status.tone === 'red' ? 'border-red-400/25 bg-red-500/10 text-red-300' :
                          status.tone === 'amber' ? 'border-amber-400/25 bg-amber-500/10 text-amber-300' :
                          status.tone === 'blue' ? 'border-blue-400/25 bg-blue-500/10 text-blue-300' :
                          'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                        }`}>{status.label}</span>
                      </div>
                      <p className="mb-3 text-xs font-bold leading-relaxed text-slate-300">{status.detail}</p>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <MetricMini label="Leads CRM" value={String(account.leads || 0)} />
                        <MetricMini label="CPL real" value={formatCurrency(account.cpl, account.currency)} />
                        <MetricMini label="CTR" value={formatPercent(account.ctr)} />
                        <MetricMini label="CPC" value={formatCurrency(account.cpc || 0, account.currency)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                <h3 className="text-base font-black text-white">Regras do MVP</h3>
                <div className="mt-4 space-y-3">
                  <RuleRow icon={TrendingUp} title="CPL crítico" text="Pausar só entra como recomendação quando CPL real chegar a R$ 28,00 com dados confiáveis." tone="red" />
                  <RuleRow icon={Activity} title="CPL em atenção" text="Acima de R$ 20,00 o painel exige leitura de CPC, CTR, CPM, visualização de página e frequência." tone="amber" />
                  <RuleRow icon={MousePointerClick} title="Métricas secundárias" text="CPC máximo R$ 6,00, CTR mínimo 1%. Frequência fica como indicador de fadiga." tone="blue" />
                  <RuleRow icon={Eye} title="Fonte dos leads" text="Lead oficial vem do CRM Orion. Se a Meta tem gasto e o CRM nao tem lead, o status vira CRM pendente." tone="emerald" />
                </div>
              </div>
            </div>
          </div>

          {/* Stats Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            <Link href="/trafego/corretores">
              <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-blue-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Parceiros sob Gestão</p>
                  <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 group-hover:scale-110 transition-transform">
                    <Users size={18} />
                  </div>
                </div>
                <p className="text-3xl font-black text-white group-hover:text-blue-400 transition-colors">{corretores.length}</p>
                <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/40 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </Link>

            <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-emerald-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(16,185,129,0.15)] transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Campanhas Ativas</p>
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:scale-110 transition-transform">
                  <CheckCircle2 size={18} />
                </div>
              </div>
              <p className="text-3xl font-black text-white group-hover:text-emerald-400 transition-colors">{activeCampaignsCount}</p>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-purple-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(168,85,247,0.15)] transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Entradas Pendentes</p>
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 group-hover:scale-110 transition-transform">
                  <Clock size={18} />
                </div>
              </div>
              <p className="text-3xl font-black text-white group-hover:text-purple-400 transition-colors">
                {pendingOnboardingCount}
              </p>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-purple-500/0 via-purple-500/40 to-purple-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Quick Actions Grid */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Atalhos Operacionais</h2>
              <div className="h-px flex-1 bg-white/5" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {quickActions.map((action, idx) => (
                <Link 
                  key={idx} 
                  href={action.href}
                  className={`group p-5 rounded-2xl border ${action.borderColor} bg-[#090e1a]/80 backdrop-blur-md hover:scale-[1.02] shadow-xl hover:shadow-cyan-500/5 transition-all duration-300 flex flex-col justify-between h-48`}
                >
                  <div className="flex justify-between items-start">
                    <div className={`p-2.5 rounded-xl bg-gradient-to-br ${action.color} text-white shadow-lg transition-transform duration-300 group-hover:scale-110`}>
                      <action.icon size={20} />
                    </div>
                    <ChevronRight size={16} className="text-slate-500 group-hover:text-white transition-colors" />
                  </div>
                  
                  <div>
                    <h3 className="text-base font-black text-white mb-1 group-hover:text-cyan-400 transition-colors">{action.title}</h3>
                    <p className="text-xs font-semibold text-slate-500 leading-normal">
                      {action.desc}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Brokers Table Section */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Carteira de Clientes Ativos</h2>
              <div className="h-px flex-1 bg-white/5" />
            </div>

            <div className="bg-[#090e1a]/85 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] border-b border-white/5">
                      <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Corretor / Parceiro</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Página de Captação</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Status Onboarding</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Campanha Meta</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {corretores.map((c) => {
                      const onboardingStatus = getOnboardingStatus(c);
                      return (
                        <tr key={c.id} className="hover:bg-white/[0.01] transition-colors group">
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-blue-500/10 text-cyan-400 border border-cyan-500/15 rounded-xl flex items-center justify-center font-black text-base group-hover:bg-gradient-to-br group-hover:from-blue-500 group-hover:to-cyan-400 group-hover:text-white transition-all">
                                {c.nome?.[0].toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0">
                                <p className="font-extrabold text-white group-hover:text-cyan-400 transition-colors leading-snug">{c.nome}</p>
                                <p className="text-[10px] font-bold text-slate-500 tracking-tighter leading-none mt-1">{c.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            {c.link_pagina ? (
                              <div className="flex items-center gap-2">
                                <Globe size={13} className="text-cyan-400" />
                                <a 
                                  href={c.link_pagina} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-xs font-semibold text-slate-400 hover:text-cyan-400 transition-colors truncate max-w-[200px]"
                                >
                                  {c.link_pagina}
                                </a>
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-600 tracking-widest uppercase italic">Não vinculada</span>
                            )}
                          </td>
                          <td className="px-8 py-5 text-center">
                            <span className={`px-3.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-slate-900/50 ${onboardingStatus.className.replace('text-', 'text-').replace('bg-', 'bg-slate-900/')}`}>
                              {onboardingStatus.label}
                            </span>
                          </td>
                          <td className="px-8 py-5 text-center">
                            <span className={`inline-flex h-2 w-2 rounded-full ${c.campanhas_ativas ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'}`} />
                          </td>
                          <td className="px-8 py-5 text-right">
                            <div className="flex justify-end gap-2">
                              <Link 
                                href={`/trafego/entrada`}
                                className="px-3 py-1.5 bg-white/5 border border-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/10 text-slate-300 hover:text-cyan-400 font-extrabold text-[9px] uppercase tracking-widest rounded-lg transition-all"
                              >
                                Configurar
                              </Link>
                              <Link 
                                href={`/trafego/relatorios`}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[9px] uppercase tracking-widest rounded-lg transition-all shadow-md shadow-blue-600/15"
                              >
                                Relatório
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

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

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-white">{value}</p>
    </div>
  );
}

function RuleRow({
  icon: Icon,
  title,
  text,
  tone,
}: {
  icon: any;
  title: string;
  text: string;
  tone: 'red' | 'amber' | 'blue' | 'emerald';
}) {
  const toneClass = {
    red: 'border-red-400/15 bg-red-500/10 text-red-300',
    amber: 'border-amber-400/15 bg-amber-500/10 text-amber-300',
    blue: 'border-blue-400/15 bg-blue-500/10 text-blue-300',
    emerald: 'border-emerald-400/15 bg-emerald-500/10 text-emerald-300',
  }[tone];

  return (
    <div className="flex gap-3 rounded-2xl border border-white/5 bg-white/[0.025] p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${toneClass}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-sm font-black text-white">{title}</p>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-400">{text}</p>
      </div>
    </div>
  );
}
