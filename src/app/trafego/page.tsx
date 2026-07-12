'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Users, 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  UserPlus,
  Loader2,
  Calendar,
  AlertTriangle,
  Globe,
  FileSearch,
  CheckCircle2,
  ChevronRight,
  ShieldAlert,
  Clock,
  RefreshCw,
  Activity,
  MousePointerClick,
  Eye,
  LayoutDashboard,
  Image as ImageIcon,
  ListChecks,
  Pause
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
  nome_empresa?: string | null;
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
  concessionaria_nome?: string;
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

function getToneClasses(tone: string) {
  if (tone === 'red') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (tone === 'amber') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (tone === 'blue') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
}

export default function GestorDashboardPage() {
  const { profile, actualProfile } = useAuth();
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState(0);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccountAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertsUpdatedAt, setAlertsUpdatedAt] = useState<string | null>(null);
  const [presetLabel, setPresetLabel] = useState('Todo o período');
  const [error, setError] = useState<string | null>(null);
  const [approvedRecommendations, setApprovedRecommendations] = useState<Record<string, boolean>>({});

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
            body: JSON.stringify({
              gestor_id: actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego'
                ? profile.id
                : undefined,
            }),
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
  const concessionarias = useMemo(() => {
    const grouped = new Map<string, { nome: string; active: boolean; corretores: Corretor[] }>();

    corretores.forEach((corretor) => {
      const nome = String((corretor as any).nome_empresa || corretor.nome || '').trim();
      if (!nome) return;
      const key = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const current = grouped.get(key);
      if (current) {
        current.corretores.push(corretor);
        current.active = current.active || Boolean(corretor.campanhas_ativas);
      } else {
        grouped.set(key, { nome, active: Boolean(corretor.campanhas_ativas), corretores: [corretor] });
      }
    });

    return Array.from(grouped.values());
  }, [corretores]);
  const reviewAccounts = metaAccounts
    .map((account) => ({ account, status: classifyMetaAccount(account) }))
    .filter(({ status }) => status.label !== 'Saudável');
  const criticalReviewCount = reviewAccounts.filter(({ status }) => status.tone === 'red').length;
  const attentionReviewCount = reviewAccounts.filter(({ status }) => status.tone === 'amber').length;
  const crmPendingCount = reviewAccounts.filter(({ status }) => status.label === 'CRM pendente').length;
  const totalSpend = metaAccounts.reduce((sum, account) => sum + Number(account.spend || 0), 0);
  const crmLeadCount = metaAccounts.reduce((sum, account) => sum + Number(account.leads || 0), 0);
  const averageCpl = crmLeadCount > 0 ? totalSpend / crmLeadCount : null;
  const highestCplAccount = metaAccounts
    .filter((account) => account.cpl !== null && account.cpl !== undefined)
    .sort((a, b) => Number(b.cpl || 0) - Number(a.cpl || 0))[0] || null;
  const healthyAccountsCount = Math.max(metaAccounts.length - reviewAccounts.length, 0);
  const approvalQueue = reviewAccounts.slice(0, 4);
  const analysisAccount = reviewAccounts[0]?.account || metaAccounts[0] || null;
  const analysisStatus = analysisAccount ? classifyMetaAccount(analysisAccount) : null;

  const quickActions = [
    {
      title: 'Leads das Concessionarias',
      desc: 'Visualizar leads por concessionaria',
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
      <div className="hidden">
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
      <div className="hidden">
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
          <TrafficCommandCenter
            corretores={corretores}
            concessionarias={concessionarias}
            activeCampaignsCount={activeCampaignsCount}
            totalLeads={totalLeads}
            metaAccounts={metaAccounts}
            reviewAccounts={reviewAccounts}
            criticalReviewCount={criticalReviewCount}
            attentionReviewCount={attentionReviewCount}
            crmPendingCount={crmPendingCount}
            healthyAccountsCount={healthyAccountsCount}
            approvalQueue={approvalQueue}
            analysisAccount={analysisAccount}
            analysisStatus={analysisStatus}
            averageCpl={averageCpl}
            highestCplAccount={highestCplAccount}
            totalSpend={totalSpend}
            loadingAlerts={loadingAlerts}
            alertsUpdatedAt={alertsUpdatedAt}
            onReview={fetchDashboardData}
            approvedRecommendations={approvedRecommendations}
            onApproveRecommendation={(key) => setApprovedRecommendations((current) => ({ ...current, [key]: true }))}
          />
          <div className="hidden">
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
          </div>
        </>
      )}

      {/* Footer Decoration */}
      <div className="hidden">
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

function TrafficCommandCenter({
  corretores,
  concessionarias,
  activeCampaignsCount,
  totalLeads,
  metaAccounts,
  reviewAccounts,
  criticalReviewCount,
  attentionReviewCount,
  crmPendingCount,
  healthyAccountsCount,
  approvalQueue,
  analysisAccount,
  analysisStatus,
  averageCpl,
  highestCplAccount,
  totalSpend,
  loadingAlerts,
  alertsUpdatedAt,
  onReview,
  approvedRecommendations,
  onApproveRecommendation,
}: {
  corretores: Corretor[];
  concessionarias: { nome: string; active: boolean; corretores: Corretor[] }[];
  activeCampaignsCount: number;
  totalLeads: number;
  metaAccounts: MetaAccountAlert[];
  reviewAccounts: { account: MetaAccountAlert; status: { label: string; tone: string; detail: string } }[];
  criticalReviewCount: number;
  attentionReviewCount: number;
  crmPendingCount: number;
  healthyAccountsCount: number;
  approvalQueue: { account: MetaAccountAlert; status: { label: string; tone: string; detail: string } }[];
  analysisAccount: MetaAccountAlert | null;
  analysisStatus: { label: string; tone: string; detail: string } | null;
  averageCpl: number | null;
  highestCplAccount: MetaAccountAlert | null;
  totalSpend: number;
  loadingAlerts: boolean;
  alertsUpdatedAt: string | null;
  onReview: () => void;
  approvedRecommendations: Record<string, boolean>;
  onApproveRecommendation: (key: string) => void;
}) {
  const monitoredCount = concessionarias.length;
  const dailyAnalyses = 0;
  const displayedAttention = reviewAccounts.slice(0, 5);
  const activeConcessionarias = concessionarias.filter((item) => item.active).length;
  const portfolioRows = metaAccounts
    .slice()
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
    .slice(0, 10);
  const maxPortfolioSpend = Math.max(...portfolioRows.map((account) => Number(account.spend || 0)), 1);
  const maxPortfolioLeads = Math.max(...portfolioRows.map((account) => Number(account.leads || 0)), 1);

  return (
    <section className="-mx-4 -mt-6 rounded-3xl border border-cyan-400/10 bg-[#050b14] p-4 text-white shadow-2xl sm:-mx-6 sm:p-6 lg:-mx-8 xl:p-8">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Dashboard</h1>
              <p className="mt-1 text-sm font-semibold text-slate-400">Monitoramento das concessionárias do gestor e recomendações operacionais.</p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Última revisão</p>
                <p className="mt-1 text-xs font-black text-slate-200">{alertsUpdatedAt ? new Date(alertsUpdatedAt).toLocaleString('pt-BR') : 'Sem revisão registrada'}</p>
              </div>
              <button
                onClick={onReview}
                disabled={loadingAlerts}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-blue-950/40 transition hover:bg-blue-500 disabled:opacity-60"
              >
                {loadingAlerts ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                Revisar contas
              </button>
            </div>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <TrafficKpi href="/trafego/corretores" icon={Users} label="Concessionárias monitoradas" value={String(monitoredCount)} detail={`Ativas: ${activeConcessionarias} | Pausadas: ${Math.max(monitoredCount - activeConcessionarias, 0)}`} tone="cyan" />
            <TrafficKpi href="/trafego/avisos-meta" icon={TrendingUp} label="Análises hoje" value={String(dailyAnalyses)} detail="Sem registro de análise automática hoje" tone="blue" />
            <TrafficKpi href="/trafego/avisos-meta" icon={DollarSign} label="Maior CPL" value={formatCurrency(highestCplAccount?.cpl, highestCplAccount?.currency)} detail={highestCplAccount?.concessionaria_nome || highestCplAccount?.corretor_nome || 'Nenhuma conta com CPL'} tone="emerald" />
            <TrafficKpi href="/trafego/avisos-meta" icon={AlertTriangle} label="Alertas ativos" value={String(criticalReviewCount + attentionReviewCount + crmPendingCount)} detail={`${criticalReviewCount} críticos | ${attentionReviewCount} atenção`} tone="red" />
            <TrafficKpi href="#recomendacoes" icon={ListChecks} label="Recomendações" value={String(approvalQueue.length)} detail="Aguardando aprovar ou revisar" tone="amber" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Concessionárias em atenção" action={<Link href="/trafego/corretores" className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Ver todas</Link>}>
              <div className="mb-3 grid grid-cols-[1fr_76px_76px_16px] gap-2 px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span>Concessionária</span>
                <span>Status</span>
                <span>CPL</span>
                <span />
              </div>
              <div className="space-y-2">
                {displayedAttention.length === 0 ? (
                  <EmptyPanel text="Nenhuma concessionária em atenção agora." />
                ) : displayedAttention.map(({ account, status }) => (
                  <Link
                    key={`attention-${account.corretor_id}-${account.meta_ad_account_id}`}
                    href="/trafego/avisos-meta"
                    className="grid min-h-12 grid-cols-[1fr_76px_76px_16px] items-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-2 transition hover:border-cyan-400/30 hover:bg-white/[0.05]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-black">{account.corretor_nome?.[0] || '?'}</span>
                      <span className="truncate text-xs font-black text-white">{account.concessionaria_nome || account.corretor_nome}</span>
                    </span>
                    <span className={`w-fit rounded-md border px-2 py-1 text-[9px] font-black ${getToneClasses(status.tone)}`}>{status.label}</span>
                    <span className="text-xs font-black text-slate-200">{formatCurrency(account.cpl, account.currency)}</span>
                    <ChevronRight size={14} className="text-slate-500" />
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel title="Recomendações" badge={String(approvalQueue.length)} action={<Link href="/trafego/otimizacoes" className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Ver todas</Link>}>
              <div className="space-y-3">
                {approvalQueue.length === 0 ? (
                  <EmptyPanel text="Nada aguardando decisão humana agora." />
                ) : approvalQueue.map(({ account, status }, index) => {
                  const Icon = status.tone === 'red' ? Pause : status.tone === 'amber' ? ImageIcon : TrendingUp;
                  return (
                    <div id={index === 0 ? 'recomendacoes' : undefined} key={`queue-${account.corretor_id}-${index}`} className="grid gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 lg:grid-cols-[44px_1fr_84px]">
                      <div className={`grid h-11 w-11 place-items-center rounded-xl border ${getToneClasses(status.tone)}`}>
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-black text-white">{status.tone === 'red' ? 'Pausar anúncio' : status.tone === 'amber' ? 'Trocar criativo' : 'Revisar conta'}</p>
                          <span className={`rounded px-2 py-0.5 text-[9px] font-black uppercase ${getToneClasses(status.tone)}`}>{status.tone === 'red' ? 'Crítico' : 'Atenção'}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-400">{account.concessionaria_nome || account.corretor_nome}: {status.detail}</p>
                        <p className="mt-1 text-[10px] font-bold text-slate-500">CPL: {formatCurrency(account.cpl, account.currency)} | CTR: {formatPercent(account.ctr)} | CPC: {formatCurrency(account.cpc || 0, account.currency)}</p>
                      </div>
                      <div className="flex gap-2 lg:flex-col">
                        <button
                          type="button"
                          onClick={() => onApproveRecommendation(`${account.corretor_id}-${account.meta_ad_account_id}-${index}`)}
                          className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-center text-[10px] font-black text-white hover:bg-blue-500"
                        >
                          {approvedRecommendations[`${account.corretor_id}-${account.meta_ad_account_id}-${index}`] ? 'Aprovado' : 'Aprovar'}
                        </button>
                        <Link href={`/trafego/otimizacoes?conta=${encodeURIComponent(account.meta_ad_account_id || account.corretor_id)}`} className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-center text-[10px] font-black text-slate-300 hover:bg-white/10">Revisar</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="mt-4">
            <Panel title="Comparativo da carteira" action={<Link href="/trafego/otimizacoes" className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Abrir otimizacoes</Link>}>
              <div className="space-y-4">
                {portfolioRows.length === 0 ? (
                  <EmptyPanel text="Nenhuma concessionaria com dados Meta neste periodo." />
                ) : portfolioRows.map((account) => (
                  <div key={`portfolio-${account.corretor_id}-${account.meta_ad_account_id}`} className="grid gap-2 lg:grid-cols-[190px_1fr_92px_1fr_86px_96px] lg:items-center">
                    <div>
                      <p className="truncate text-xs font-black text-white">{account.concessionaria_nome || account.corretor_nome}</p>
                      <p className="truncate text-[10px] font-bold text-slate-500">{account.meta_ad_account_name || `act_${account.meta_ad_account_id}`}</p>
                    </div>
                    <div className="h-6 bg-white/[0.04]">
                      <div className="h-full bg-cyan-500/75" style={{ width: `${Math.max(3, (Number(account.spend || 0) / maxPortfolioSpend) * 100)}%` }} />
                    </div>
                    <p className="text-right text-xs font-black text-white">{formatCurrency(account.spend, account.currency)}</p>
                    <div className="h-6 bg-white/[0.04]">
                      <div className="h-full bg-emerald-400/75" style={{ width: `${Math.max(3, (Number(account.leads || 0) / maxPortfolioLeads) * 100)}%` }} />
                    </div>
                    <p className="text-right text-xs font-black text-white">{account.leads || 0} leads</p>
                    <p className={`text-right text-xs font-black ${Number(account.cpl || 0) >= 28 ? 'text-red-300' : 'text-slate-200'}`}>{formatCurrency(account.cpl, account.currency)}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="hidden">
            <Panel
              title="Análise da IA"
              badge={analysisStatus?.tone === 'red' ? 'Crítico' : analysisStatus?.label || 'Seguro'}
              badgeTone={analysisStatus?.tone || 'emerald'}
            >
              {analysisAccount && analysisStatus ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Conta analisada</p>
                    <p className="mt-1 text-lg font-black text-white">{analysisAccount.corretor_nome}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">{analysisAccount.meta_ad_account_name || `act_${analysisAccount.meta_ad_account_id}`}</p>
                  </div>
                  <div className={`rounded-xl border p-4 ${getToneClasses(analysisStatus.tone)}`}>
                    <div className="mb-2 flex items-center gap-2">
                      <AlertTriangle size={16} />
                      <p className="text-sm font-black text-white">{analysisStatus.label}</p>
                    </div>
                    <p className="text-xs font-semibold leading-relaxed text-slate-200">{analysisStatus.detail}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <AnalysisMetric label="CTR" value={formatPercent(analysisAccount.ctr)} />
                    <AnalysisMetric label="CPC" value={formatCurrency(analysisAccount.cpc || 0, analysisAccount.currency)} />
                    <AnalysisMetric label="CPM" value={formatCurrency(analysisAccount.cpm || 0, analysisAccount.currency)} />
                    <AnalysisMetric label="Frequência" value={Number(analysisAccount.frequency || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} />
                    <AnalysisMetric label="Leads CRM" value={String(analysisAccount.leads || 0)} />
                    <AnalysisMetric label="Investimento" value={formatCurrency(analysisAccount.spend, analysisAccount.currency)} />
                  </div>

                  <div className="rounded-xl border border-white/5 bg-black/20 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Recomendação da IA</p>
                    <p className="mt-2 text-sm font-bold leading-relaxed text-red-200">
                      {analysisAccount.alerta_cpl_alto
                        ? 'Revisar anúncio e criativo antes de qualquer mudança. Pausa só deve ser aprovada por humano.'
                        : analysisAccount.dados_crm_pendentes
                          ? 'Conferir importação de leads no CRM antes de avaliar o CPL desta conta.'
                          : 'Acompanhar métricas secundárias e manter observação no próximo ciclo.'}
                    </p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${analysisStatus.tone === 'red' ? 92 : analysisStatus.tone === 'amber' ? 68 : 42}%` }} />
                    </div>
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Nível de confiança</p>
                  </div>
                </div>
              ) : (
                <EmptyPanel text="Sem conta Meta analisada neste período." />
              )}
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Panel title="Resumo da carteira">
              <div className="grid gap-3 sm:grid-cols-3">
                <AnalysisMetric label="Saudáveis" value={String(healthyAccountsCount)} />
                <AnalysisMetric label="CRM pendente" value={String(crmPendingCount)} />
                <AnalysisMetric label="Investimento Meta" value={formatCurrency(totalSpend)} />
              </div>
            </Panel>
            <Panel title="Regra de segurança">
              <p className="text-sm font-semibold leading-relaxed text-slate-300">
                O painel usa leads do CRM para calcular CPL. Quando existe gasto na Meta e nenhum lead no CRM, a conta entra como “CRM pendente” para evitar decisão errada.
              </p>
            </Panel>
          </div>
    </section>
  );
}

function TrafficKpi({
  href,
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  href: string;
  icon: any;
  label: string;
  value: string;
  detail: string;
  tone: 'cyan' | 'blue' | 'emerald' | 'red' | 'amber';
}) {
  const tones = {
    cyan: 'from-cyan-500/20 to-cyan-500/5 text-cyan-300 border-cyan-400/15',
    blue: 'from-blue-500/20 to-blue-500/5 text-blue-300 border-blue-400/15',
    emerald: 'from-emerald-500/20 to-emerald-500/5 text-emerald-300 border-emerald-400/15',
    red: 'from-red-500/20 to-red-500/5 text-red-300 border-red-400/15',
    amber: 'from-amber-500/20 to-amber-500/5 text-amber-300 border-amber-400/15',
  }[tone];

  return (
    <Link href={href} className={`block rounded-xl border bg-gradient-to-br p-4 transition hover:-translate-y-0.5 hover:border-cyan-300/35 hover:shadow-xl hover:shadow-cyan-950/20 ${tones}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-black/20">
          <Icon size={19} />
        </div>
        <ChevronRight size={16} className="text-slate-500" />
      </div>
      <p className="text-3xl font-black text-white">{value}</p>
      <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-2 text-[11px] font-bold text-slate-500">{detail}</p>
    </Link>
  );
}

function Panel({
  title,
  children,
  action,
  badge,
  badgeTone = 'blue',
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  badge?: string;
  badgeTone?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a1422]/85 p-4 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black text-white">{title}</h2>
          {badge ? <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${getToneClasses(badgeTone)}`}>{badge}</span> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function AnalysisMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm font-bold text-slate-500">
      {text}
    </div>
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
