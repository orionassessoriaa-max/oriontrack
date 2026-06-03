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
  Clock
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import Link from 'next/link';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getOnboardingStatus } from '@/lib/onboarding';
import MetaDatePicker from '@/components/ui/MetaDatePicker';

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

export default function GestorDashboardPage() {
  const { profile } = useAuth();
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState(0);
  const [criticalAccounts, setCriticalAccounts] = useState<any[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
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
        filteredCorretores = filteredCorretores.filter(c => {
          if (c.gestor_trafego_id === profile.id) return true;
          const team = Array.isArray(c.time_operacional) ? c.time_operacional : [];
          return team.some((member: any) => member?.profile_id === profile.id || member?.id === profile.id);
        });
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
            const accounts = payload.accounts || [];
            
            const critical = accounts.filter((acc: any) => {
              const isCard = String(acc.forma_pagamento || '').toLowerCase().includes('cartao') || 
                             String(acc.forma_pagamento || '').toLowerCase().includes('cartão') ||
                             String(acc.forma_pagamento || '').toLowerCase().includes('card') ||
                             String(acc.forma_pagamento || '').toLowerCase().includes('visa') ||
                             String(acc.forma_pagamento || '').toLowerCase().includes('mastercard');
              const hasPaymentError = acc.error && (
                /pagamento|payment|recusad|failed|declined|settle|cobrança|cobranca|cartao|cartão|card|invoice|unpaid|error/i.test(String(acc.error))
              );
              
              const isCriticalCpl = acc.cpl !== null && acc.cpl > 25;
              const isCriticalBalance = !isCard && acc.saldo !== null && acc.saldo < 100;
              const isCardError = isCard && hasPaymentError;
              const hasGeneralError = acc.error && !isCard;

              return isCriticalCpl || isCriticalBalance || isCardError || hasGeneralError;
            });
            setCriticalAccounts(critical);
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
          {/* Alertas Críticos de Contas Meta Ads */}
          {criticalAccounts.length > 0 && (
            <div className="mb-10 p-6 rounded-[2rem] border border-red-500/20 bg-red-500/5 shadow-[0_0_30px_rgba(239,68,68,0.06)] backdrop-blur-md animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center shrink-0">
                  <ShieldAlert size={20} className="animate-pulse" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white leading-none">Contas Críticas em Alerta</h2>
                  <p className="text-xs font-bold text-red-400/80 mt-1.5">Campanhas ou saldos que requerem atenção imediata.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {criticalAccounts.map((acc) => {
                  const isCard = String(acc.forma_pagamento || '').toLowerCase().includes('cartao') || 
                                 String(acc.forma_pagamento || '').toLowerCase().includes('cartão') ||
                                 String(acc.forma_pagamento || '').toLowerCase().includes('card') ||
                                 String(acc.forma_pagamento || '').toLowerCase().includes('visa') ||
                                 String(acc.forma_pagamento || '').toLowerCase().includes('mastercard');
                  const hasPaymentError = acc.error && (
                    /pagamento|payment|recusad|failed|declined|settle|cobrança|cobranca|cartao|cartão|card|invoice|unpaid|error/i.test(String(acc.error))
                  );

                  let badgeText = 'Normal';
                  let badgeTone = 'emerald';
                  let detailText = '';

                  if (acc.cpl !== null && acc.cpl > 25) {
                    badgeText = 'CPL Alto';
                    badgeTone = 'red';
                    detailText = `CPL de R$ ${Number(acc.cpl).toFixed(2).replace('.', ',')} acima do limite.`;
                  } else if (isCard && hasPaymentError) {
                    badgeText = 'Erro Pagamento';
                    badgeTone = 'red';
                    detailText = 'Falha de processamento no cartão de crédito.';
                  } else if (!isCard && acc.saldo !== null && acc.saldo <= 0) {
                    badgeText = 'Sem Saldo';
                    badgeTone = 'red';
                    detailText = 'Campanhas suspensas por falta de créditos.';
                  } else if (!isCard && acc.saldo !== null && acc.saldo < 100) {
                    badgeText = 'Saldo Baixo';
                    badgeTone = 'amber';
                    detailText = `Saldo de R$ ${Number(acc.saldo).toFixed(2).replace('.', ',')} abaixo do limite de R$ 100.`;
                  } else if (acc.error) {
                    badgeText = 'Erro Meta';
                    badgeTone = 'amber';
                    detailText = acc.error;
                  }

                  return (
                    <div key={acc.corretor_id} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors flex flex-col justify-between gap-3 group">
                      <div>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="font-extrabold text-white text-sm truncate group-hover:text-cyan-400 transition-colors">{acc.corretor_nome}</p>
                          <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest leading-none border ${
                            badgeTone === 'red'
                              ? 'bg-red-500/10 text-red-400 border-red-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {badgeText}
                          </span>
                        </div>
                        <p className="text-[10px] font-semibold text-slate-500 truncate leading-none">
                          {acc.meta_ad_account_name || `act_${acc.meta_ad_account_id}`}
                        </p>
                        <p className="text-xs font-bold text-slate-300 mt-2">{detailText}</p>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-1">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{isCard ? 'Cartão de Crédito' : 'Pré-pago'}</span>
                        <Link 
                          href="/trafego/avisos-meta"
                          className="text-[9px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                        >
                          Ver Avisos <ArrowRight size={10} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
