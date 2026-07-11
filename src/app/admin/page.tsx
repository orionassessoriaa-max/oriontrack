'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Users, 
  Building2,
  Target, 
  Clock, 
  TrendingUp, 
  ArrowRight,
  UserPlus,
  Loader2,
  Calendar,
  Search,
  Globe,
  BarChart3,
  HelpCircle,
  FileSearch,
  CheckCircle2,
  ChevronRight,
  UserCog,
  LayoutDashboard,
  Sparkles,
  AlertTriangle,
  Bot
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '@/components/providers/AuthProvider';
import { getProfileRoleLabel } from '@/lib/users';

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function inferGestorIdFromTeam(corretor: any, gestores: Array<{ id: string; nome: string }>) {
  if (corretor.gestor_trafego_id) return corretor.gestor_trafego_id;

  const team = Array.isArray(corretor.time_operacional) ? corretor.time_operacional : [];
  const managerMember = team.find((member: any) => {
    const role = normalizeText(member?.tipo_usuario);
    const cargo = normalizeText(member?.cargo);
    const nome = normalizeText(member?.nome);
    return role === 'gestor_trafego' || cargo.includes('trafego') || gestores.some((gestor) => normalizeText(gestor.nome) === nome);
  });

  if (!managerMember) return null;
  if (managerMember.profile_id) return String(managerMember.profile_id);

  const memberName = normalizeText(managerMember.nome);
  return gestores.find((gestor) => normalizeText(gestor.nome) === memberName)?.id || null;
}

export default function AdminCentralPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({
    totalCorretores: 0,
    totalCorretoras: 0,
    totalGestores: 0,
    totalAccounts: 0,
    totalDesigners: 0,
    suportePendente: 0
  });
  const [gestoresStats, setGestoresStats] = useState<any[]>([]);
  const [corretoresSemGestor, setCorretoresSemGestor] = useState(0);
  const [corretoresSemCorretora, setCorretoresSemCorretora] = useState(0);
  const [loading, setLoading] = useState(true);

  // Advanced Alerts State
  const [corretoresList, setCorretoresList] = useState<any[]>([]);
  const [corretorasList, setCorretorasList] = useState<any[]>([]);
  const [gestoresList, setGestoresList] = useState<any[]>([]);
  const [alertsList, setAlertsList] = useState<any[]>([]);
  const [overdueTrafficRequests, setOverdueTrafficRequests] = useState<any[]>([]);
  const [showNoBalanceModal, setShowNoBalanceModal] = useState(false);
  const [showPendingOnboardingModal, setShowPendingOnboardingModal] = useState(false);
  const [showNoBrokerageModal, setShowNoBrokerageModal] = useState(false);
  const [showNoMetaModal, setShowNoMetaModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [apoloConnected, setApoloConnected] = useState(false);
  const [apoloStatus, setApoloStatus] = useState('checking');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // 1. Total Corretores
      const { count: countCorretores } = await supabase
        .from('corretores')
        .select('*', { count: 'exact', head: true })
        .in('status', ['active', 'ativo', 'Ativo']);

      const { count: countGestores } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('tipo_usuario', 'gestor_trafego')
        .in('status', ['active', 'ativo', 'Ativo']);

      const { count: countAccounts } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('tipo_usuario', 'account_manager')
        .in('status', ['active', 'ativo', 'Ativo']);

      const { count: countDesigners } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('tipo_usuario', 'designer')
        .in('status', ['active', 'ativo', 'Ativo']);

      // 4. Suporte Pendente
      const { count: countSuporte } = await supabase
        .from('solicitacoes_suporte')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'nova');

      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { data: oldTrafficRequests } = await supabase
        .from('solicitacoes_suporte')
        .select('id, solicitante_nome, categoria, tipo, mensagem, created_at')
        .eq('status', 'nova')
        .lt('created_at', threeHoursAgo);

      setOverdueTrafficRequests((oldTrafficRequests || []).filter((request) =>
        /trafego|tráfego|meta|cpl|campanha|anuncio|anúncio|aprov/i.test(`${request.categoria || ''} ${request.tipo || ''} ${request.mensagem || ''}`)
      ));

      // 5. Gestores e corretores
      const [profilesRes, corretoresRes, corretorasRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, nome, email')
          .eq('tipo_usuario', 'gestor_trafego')
          .in('status', ['active', 'ativo', 'Ativo']),
        supabase
          .from('corretores')
          .select('id, nome, gestor_trafego_id, time_operacional, onboarding_status, status, nome_empresa, meta_ad_account_id, meta_ad_account_name'),
        supabase
          .from('corretoras')
          .select('id, nome, status, meta_ad_account_id, meta_ad_account_name')
      ]);

      const gestores = profilesRes.data || [];
      const corretorasCadastradas = corretorasRes.error ? [] : (corretorasRes.data || []);
      const corretores = (corretoresRes.data || []).map((corretor) => ({
        ...corretor,
        gestor_resolvido_id: inferGestorIdFromTeam(corretor, gestores),
      }));

      setGestoresList(gestores);
      setCorretoresList(corretores);
      setCorretorasList(corretorasCadastradas);

      const activeCorretores = corretores.filter(c => ['active', 'ativo', 'Ativo'].includes(c.status || ''));
      const statsPorGestor = gestores.map(g => {
        const concessionarias = new Set(
          activeCorretores
            .filter(c => c.gestor_resolvido_id === g.id)
            .map(c => String(c.nome_empresa || '').trim())
            .filter(Boolean)
            .map(nome => normalizeText(nome))
        );
        return { ...g, count: concessionarias.size };
      });

      const corretorasAtivas = new Set(
        corretorasCadastradas
          .filter(c => ['active', 'ativo', 'Ativo'].includes(c.status || ''))
          .map(c => String(c.nome || '').trim())
          .filter(Boolean)
          .map(nome => normalizeText(nome))
      );
      activeCorretores
        .map(c => String(c.nome_empresa || '').trim())
        .filter(Boolean)
        .map(nome => normalizeText(nome))
        .forEach(nome => corretorasAtivas.add(nome));
      const semGestor = new Set(
        activeCorretores
          .filter(c => !c.gestor_resolvido_id)
          .map(c => String(c.nome_empresa || '').trim())
          .filter(Boolean)
          .map(nome => normalizeText(nome))
      ).size;
      const semCorretora = activeCorretores.filter(c => !String(c.nome_empresa || '').trim()).length;

      setStats({
        totalCorretores: countCorretores || 0,
        totalCorretoras: corretorasAtivas.size,
        totalGestores: countGestores || 0,
        totalAccounts: countAccounts || 0,
        totalDesigners: countDesigners || 0,
        suportePendente: countSuporte || 0
      });
      setGestoresStats(statsPorGestor);
      setCorretoresSemGestor(semGestor);
      setCorretoresSemCorretora(semCorretora);
      // Fetch Meta spend/balance alerts
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (token) {
        const evolutionResponse = await fetch('/api/admin/configuracoes/evolution', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (evolutionResponse.ok) {
          const evolutionPayload = await evolutionResponse.json().catch(() => ({}));
          setApoloConnected(Boolean(evolutionPayload.connected));
          setApoloStatus(String(evolutionPayload.state || 'close'));
        }

        const response = await fetch('/api/integrations/meta/alerts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            data_inicio: format(new Date(), 'yyyy-MM-dd'),
            data_fim: format(new Date(), 'yyyy-MM-dd')
          })
        });
        if (response.ok) {
          const payload = await response.json();
          setAlertsList(payload.accounts || []);
        }
      }
    } catch (err) {
      console.error('Error fetching admin stats:', err);
    } finally {
      setLoading(false);
    }
  };

  // Computations
  const noBalanceList = useMemo(() => {
    const rawNoBalance = alertsList.filter(a => {
      const paymentText = String(a.forma_pagamento || '').toLowerCase();
      const isCard = paymentText.includes('cartao')
        || paymentText.includes('cartão')
        || paymentText.includes('card')
        || paymentText.includes('visa')
        || paymentText.includes('mastercard');

      return !isCard && a.saldo !== null && Number(a.saldo) <= 0;
    });
    return rawNoBalance.map(a => {
      const cObj = corretoresList.find(c => c.id === a.corretor_id);
      const linkedCorretora = corretorasList.find(c => {
        const sameMetaId = a.meta_ad_account_id && c.meta_ad_account_id === a.meta_ad_account_id;
        const sameMetaName = a.meta_ad_account_name && c.meta_ad_account_name === a.meta_ad_account_name;
        const sameName = cObj?.nome_empresa && normalizeText(c.nome) === normalizeText(cObj.nome_empresa);
        return sameMetaId || sameMetaName || sameName;
      });
      const gestorId = cObj ? inferGestorIdFromTeam(cObj, gestoresList) : null;
      const gestorNome = gestoresList.find(g => g.id === gestorId)?.nome || 'Sem Gestor';
      return {
        corretor_id: a.corretor_id,
        corretora_nome: linkedCorretora?.nome || cObj?.nome_empresa || a.meta_ad_account_name || 'Concessionaria nao identificada',
        meta_ad_account_name: a.meta_ad_account_name || `act_${a.meta_ad_account_id}`,
        gestor_nome: gestorNome
      };
    });
  }, [alertsList, corretoresList, corretorasList, gestoresList]);

  const pendingOnboardingList = useMemo(() => {
    const rawPending = corretoresList.filter(c => 
      ['active', 'ativo', 'Ativo'].includes(c.status || '') && 
      (!c.onboarding_status || c.onboarding_status === 'pendente')
    );
    return rawPending.map(c => {
      const gestorId = inferGestorIdFromTeam(c, gestoresList);
      const gestorNome = gestoresList.find(g => g.id === gestorId)?.nome || 'Sem Gestor';
      return {
        corretor_id: c.id,
        corretor_nome: c.nome,
        gestor_nome: gestorNome
      };
    });
  }, [corretoresList, gestoresList]);

  const noBrokerageList = useMemo(() => {
    return corretoresList
      .filter(c => ['active', 'ativo', 'Ativo'].includes(c.status || '') && !String(c.nome_empresa || '').trim())
      .map(c => {
        const gestorId = inferGestorIdFromTeam(c, gestoresList);
        const gestorNome = gestoresList.find(g => g.id === gestorId)?.nome || 'Sem Gestor';
        return {
          corretor_id: c.id,
          corretor_nome: c.nome,
          gestor_nome: gestorNome
        };
      });
  }, [corretoresList, gestoresList]);

  const noMetaList = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      id: string;
      nome: string;
      status: string;
      meta_ad_account_id?: string | null;
      meta_ad_account_name?: string | null;
      corretores: any[];
    }>();

    corretorasList
      .filter(c => ['active', 'ativo', 'Ativo'].includes(c.status || ''))
      .forEach(c => {
        const nome = String(c.nome || '').trim();
        if (!nome) return;
        const key = `empresa:${normalizeText(nome)}`;
        groups.set(key, {
          key,
          id: c.id,
          nome,
          status: c.status,
          meta_ad_account_id: c.meta_ad_account_id,
          meta_ad_account_name: c.meta_ad_account_name,
          corretores: [],
        });
      });

    corretoresList
      .filter(c => ['active', 'ativo', 'Ativo'].includes(c.status || ''))
      .forEach(c => {
        const corretoraNome = String(c.nome_empresa || '').trim();
        const key = corretoraNome ? `empresa:${normalizeText(corretoraNome)}` : `corretor:${c.id}`;
        const existing = groups.get(key);

        if (existing) {
          existing.corretores.push(c);
          if (c.meta_ad_account_id && !existing.meta_ad_account_id) {
            existing.meta_ad_account_id = c.meta_ad_account_id;
            existing.meta_ad_account_name = c.meta_ad_account_name;
          }
          return;
        }

        groups.set(key, {
          key,
          id: c.id,
          nome: corretoraNome || c.nome,
          status: c.status,
          meta_ad_account_id: c.meta_ad_account_id,
          meta_ad_account_name: c.meta_ad_account_name,
          corretores: [c],
        });
      });

    return Array.from(groups.values())
      .filter(group => !String(group.meta_ad_account_id || '').trim())
      .map(group => {
        const primary = group.corretores[0];
        const gestorId = group
          .corretores
          .map(c => inferGestorIdFromTeam(c, gestoresList))
          .find(Boolean);
        const gestorNome = gestoresList.find(g => g.id === gestorId)?.nome || 'Sem Gestor';
        return {
          id: group.id,
          corretor_id: primary?.id || null,
          corretora_nome: group.nome,
          corretores_nomes: group.corretores.map(c => c.nome).filter(Boolean).join(', '),
          corretores_total: group.corretores.length,
          is_corretora: group.key.startsWith('empresa:'),
          gestor_nome: gestorNome
        };
      })
      .sort((a, b) => a.corretora_nome.localeCompare(b.corretora_nome, 'pt-BR'));
  }, [corretorasList, corretoresList, gestoresList]);

  const highCplList = useMemo(() => {
    return alertsList
      .filter((a) => a.cpl !== null && Number(a.cpl) >= 28)
      .map((a) => {
        const cObj = corretoresList.find(c => c.id === a.corretor_id);
        const gestorId = cObj ? inferGestorIdFromTeam(cObj, gestoresList) : null;
        const gestorNome = gestoresList.find(g => g.id === gestorId)?.nome || 'Sem Gestor';
        return {
          corretor_id: a.corretor_id,
          corretora_nome: cObj?.nome_empresa || a.meta_ad_account_name || a.corretor_nome,
          corretor_nome: a.corretor_nome,
          gestor_nome: gestorNome,
          cpl: Number(a.cpl),
          leads: Number(a.leads || 0),
          spend: Number(a.spend || 0),
        };
      });
  }, [alertsList, corretoresList, gestoresList]);

  const crmPendingTrafficList = useMemo(() => {
    return alertsList
      .filter((a) => Boolean(a.dados_crm_pendentes))
      .map((a) => {
        const cObj = corretoresList.find(c => c.id === a.corretor_id);
        const gestorId = cObj ? inferGestorIdFromTeam(cObj, gestoresList) : null;
        const gestorNome = gestoresList.find(g => g.id === gestorId)?.nome || 'Sem Gestor';
        return {
          corretor_id: a.corretor_id,
          corretora_nome: cObj?.nome_empresa || a.meta_ad_account_name || a.corretor_nome,
          corretor_nome: a.corretor_nome,
          gestor_nome: gestorNome,
          spend: Number(a.spend || 0),
        };
      });
  }, [alertsList, corretoresList, gestoresList]);

  const quickActions = [
    { 
      title: 'Novo Corretor', 
      desc: 'Registrar parceiro e acesso', 
      href: '/admin/usuarios?tipo=corretor',
      icon: UserPlus, 
      color: 'from-blue-600 to-indigo-600', 
      borderColor: 'border-blue-500/20 hover:border-blue-500/50',
      glowColor: 'shadow-blue-500/10'
    },
    { 
      title: 'Todos os Leads', 
      desc: 'Auditar e cadastrar leads', 
      href: '/admin/leads', 
      icon: FileSearch, 
      color: 'from-cyan-600 to-blue-600', 
      borderColor: 'border-cyan-500/20 hover:border-cyan-500/50',
      glowColor: 'shadow-cyan-500/10'
    },
    { 
      title: 'Gerenciar Páginas', 
      desc: 'Vincular links dos corretores', 
      href: '/admin/paginas', 
      icon: Globe, 
      color: 'from-violet-600 to-purple-600', 
      borderColor: 'border-violet-500/20 hover:border-violet-500/50',
      glowColor: 'shadow-violet-500/10'
    },
    { 
      title: 'Relatórios', 
      desc: 'Gerar relatório e CPL', 
      href: '/trafego/relatorios', 
      icon: BarChart3, 
      color: 'from-emerald-600 to-teal-600', 
      borderColor: 'border-emerald-500/20 hover:border-emerald-500/50',
      glowColor: 'shadow-emerald-500/10'
    },
    {
      title: 'Apolo WhatsApp',
      desc: apoloConnected ? 'Apolo conectado para notificacoes' : 'Conectar QR Code do Apolo',
      href: '/admin/configuracoes',
      icon: Bot,
      color: apoloConnected ? 'from-emerald-600 to-teal-600' : 'from-cyan-600 to-blue-600',
      borderColor: apoloConnected ? 'border-emerald-500/20 hover:border-emerald-500/50' : 'border-cyan-500/20 hover:border-cyan-500/50',
      glowColor: apoloConnected ? 'shadow-emerald-500/10' : 'shadow-cyan-500/10'
    },
    { 
      title: 'Suporte', 
      desc: 'Acompanhar solicitações', 
      href: '/admin/suporte', 
      icon: HelpCircle, 
      color: 'from-amber-600 to-orange-600', 
      borderColor: 'border-amber-500/20 hover:border-amber-500/50',
      glowColor: 'shadow-amber-500/10'
    },
  ];

  return (
    <InternalLayout>
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-2">
              Painel Orion
            </h1>
            <span className="bg-blue-500/10 text-cyan-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-cyan-400/20 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
              {getProfileRoleLabel(profile)}
            </span>
          </div>
          <p className="text-slate-400 font-medium text-base sm:text-lg">Gestão centralizada de corretores, leads e operação.</p>
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

      <Link
        href="/admin/configuracoes"
        className={`mb-8 flex flex-col gap-4 rounded-2xl border p-5 transition hover:-translate-y-0.5 sm:flex-row sm:items-center sm:justify-between ${
          apoloConnected
            ? 'border-emerald-400/20 bg-emerald-400/10 hover:border-emerald-300/40'
            : 'border-amber-400/20 bg-amber-400/10 hover:border-amber-300/40'
        }`}
      >
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${apoloConnected ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'}`}>
            <Bot size={24} />
          </div>
          <div>
            <p className={`text-[10px] font-black uppercase tracking-widest ${apoloConnected ? 'text-emerald-300' : 'text-amber-300'}`}>
              {apoloConnected ? 'Apolo conectado' : 'Apolo aguardando conexao'}
            </p>
            <p className="mt-1 text-sm font-bold text-slate-300">
              {apoloConnected
                ? 'WhatsApp master ativo para notificacoes dos corretores, gestores e admins.'
                : 'Conecte o QR Code do WhatsApp master para liberar as notificacoes automaticas.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
          Status: {apoloStatus}
          <ChevronRight size={16} />
        </div>
      </Link>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-8">
        <Link href="/admin/corretores">
          <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-blue-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Corretores Ativos</p>
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 group-hover:scale-110 transition-transform">
                <Users size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-blue-400 transition-colors">{stats.totalCorretores}</p>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/40 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link href="/admin/corretores">
          <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-cyan-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(6,182,212,0.15)] transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Concessionarias Ativas</p>
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:scale-110 transition-transform">
                <Building2 size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-cyan-400 transition-colors">{stats.totalCorretoras}</p>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-cyan-500/0 via-cyan-500/40 to-cyan-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link href="/admin/gestores">
          <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-emerald-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(16,185,129,0.15)] transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Gestores ativos</p>
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:scale-110 transition-transform">
                <UserCog size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-emerald-400 transition-colors">{stats.totalGestores}</p>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link href="/admin/accounts">
          <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-purple-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(168,85,247,0.15)] transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Accounts ativos</p>
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 group-hover:scale-110 transition-transform">
                <Users size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-purple-400 transition-colors">{stats.totalAccounts}</p>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-purple-500/0 via-purple-500/40 to-purple-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link href="/admin/designers">
          <div className="group relative bg-[#090e1a]/70 border border-white/5 hover:border-cyan-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(6,182,212,0.15)] transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Designers ativos</p>
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:scale-110 transition-transform">
                <LayoutDashboard size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-cyan-400 transition-colors">{stats.totalDesigners}</p>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-cyan-500/0 via-cyan-500/40 to-cyan-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
      </div>

      {/* Alertas e Acompanhamento Section */}
      <div className="mb-12">
        <div className="flex items-center gap-4 mb-6">
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Alertas e Acompanhamento</h2>
          <div className="h-px flex-1 bg-white/5" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <Link
            href="/trafego/avisos-meta"
            className="group relative bg-[#090e1a]/85 border border-red-500/10 hover:border-red-500/40 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(239,68,68,0.12)] transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">CPL crítico</p>
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 group-hover:scale-110 transition-transform">
                <TrendingUp size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-red-400 transition-colors">{highCplList.length}</p>
            )}
            <p className="text-[10px] font-semibold text-slate-500 mt-2 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
              CPL real acima de R$ 28,00 usando leads do CRM <ArrowRight size={10} />
            </p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-red-500/0 via-red-500/40 to-red-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>

          <Link
            href="/trafego/avisos-meta"
            className="group relative bg-[#090e1a]/85 border border-blue-500/10 hover:border-blue-500/40 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(59,130,246,0.12)] transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">CRM pendente</p>
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 group-hover:scale-110 transition-transform">
                <FileSearch size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-blue-400 transition-colors">{crmPendingTrafficList.length}</p>
            )}
            <p className="text-[10px] font-semibold text-slate-500 mt-2 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
              Meta tem gasto, mas faltam leads importados no CRM <ArrowRight size={10} />
            </p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/40 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>

          <Link
            href="/admin/suporte"
            className="group relative bg-[#090e1a]/85 border border-amber-500/10 hover:border-amber-500/40 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(245,158,11,0.12)] transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Aprovação vencida</p>
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:scale-110 transition-transform">
                <Clock size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-amber-400 transition-colors">{overdueTrafficRequests.length}</p>
            )}
            <p className="text-[10px] font-semibold text-slate-500 mt-2 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
              Chamados de tráfego sem revisão há mais de 3h <ArrowRight size={10} />
            </p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-amber-500/0 via-amber-500/40 to-amber-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>

          {/* Card: Concessionarias Sem Saldo */}
          <div 
            onClick={() => setShowNoBalanceModal(true)}
            className="group relative bg-[#090e1a]/85 border border-red-500/10 hover:border-red-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(239,68,68,0.1)] transition-all duration-300 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Concessionarias Sem Saldo</p>
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 group-hover:scale-110 transition-transform">
                <AlertTriangle size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-red-400 transition-colors">
                {noBalanceList.length}
              </p>
            )}
            <p className="text-[10px] font-semibold text-slate-500 mt-2 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
              Clique para detalhar os gestores responsáveis <ArrowRight size={10} />
            </p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-red-500/0 via-red-500/40 to-red-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Card: Concessionarias Sem Meta Ads */}
          <div
            onClick={() => setShowNoMetaModal(true)}
            className="group relative bg-[#090e1a]/85 border border-cyan-500/10 hover:border-cyan-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(6,182,212,0.1)] transition-all duration-300 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sem Meta Ads</p>
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:scale-110 transition-transform">
                <Globe size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-cyan-400 transition-colors">
                {noMetaList.length}
              </p>
            )}
            <p className="text-[10px] font-semibold text-slate-500 mt-2 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
              Clique para ver quem falta vincular <ArrowRight size={10} />
            </p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-cyan-500/0 via-cyan-500/40 to-cyan-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Card: Corretores Sem Concessionaria */}
          <div
            onClick={() => setShowNoBrokerageModal(true)}
            className="group relative bg-[#090e1a]/85 border border-amber-500/10 hover:border-amber-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(245,158,11,0.1)] transition-all duration-300 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sem Concessionaria</p>
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:scale-110 transition-transform">
                <Building2 size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-amber-400 transition-colors">
                {corretoresSemCorretora}
              </p>
            )}
            <p className="text-[10px] font-semibold text-slate-500 mt-2 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
              Clique para ver quem precisa ser vinculado <ArrowRight size={10} />
            </p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-amber-500/0 via-amber-500/40 to-amber-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Card: Entradas Pendentes */}
          <div 
            onClick={() => setShowPendingOnboardingModal(true)}
            className="group relative bg-[#090e1a]/85 border border-indigo-500/10 hover:border-indigo-500/30 p-6 rounded-2xl shadow-xl hover:shadow-[0_0_30px_rgba(99,102,241,0.1)] transition-all duration-300 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Entradas Pendentes</p>
              <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform">
                <Clock size={18} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-slate-800 animate-pulse rounded-lg" />
            ) : (
              <p className="text-3xl font-black text-white group-hover:text-indigo-400 transition-colors">
                {pendingOnboardingList.length}
              </p>
            )}
            <p className="text-[10px] font-semibold text-slate-500 mt-2 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
              Clique para detalhar os corretores e gestores <ArrowRight size={10} />
            </p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-indigo-500/0 via-indigo-500/40 to-indigo-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>

      {/* Concessionarias por Gestor Section */}
      <div className="mb-12">
        <div className="flex items-center gap-4 mb-6">
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Concessionarias por Gestor</h2>
          <div className="h-px flex-1 bg-white/5" />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {loading ? (
             Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 bg-[#090e1a]/50 rounded-2xl border border-white/5 animate-pulse" />
            ))
          ) : (
            <>
              {gestoresStats.map((gestor) => (
                <div key={gestor.id} className="bg-[#090e1a]/80 backdrop-blur-md p-6 rounded-2xl border border-white/5 shadow-xl flex flex-col justify-between group hover:border-blue-500/30 hover:shadow-[0_0_30px_rgba(59,130,246,0.1)] transition-all duration-300">
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-blue-500/10 text-cyan-400 border border-cyan-500/15 rounded-xl flex items-center justify-center font-black text-lg group-hover:bg-gradient-to-br group-hover:from-blue-500 group-hover:to-cyan-400 group-hover:text-white transition-all">
                        {gestor.nome[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-extrabold text-white leading-tight truncate group-hover:text-cyan-400 transition-colors">{gestor.nome}</h3>
                        <p className="text-[10px] font-bold text-slate-500 truncate">{gestor.email}</p>
                      </div>
                    </div>
                    <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Concessionarias Vinculadas</p>
                      <p className="text-3xl font-black text-white group-hover:scale-105 origin-left transition-transform">{gestor.count}</p>
                    </div>
                  </div>
                  <Link 
                    href={`/admin/corretoras?gestor=${gestor.id}`}
                    className="mt-5 w-full py-2.5 bg-white/5 border border-white/5 text-white font-extrabold text-[10px] uppercase tracking-widest rounded-xl hover:bg-gradient-to-r hover:from-blue-600 hover:to-cyan-500 hover:border-blue-600 hover:shadow-lg hover:shadow-blue-500/10 transition-all flex items-center justify-center gap-2"
                  >
                    Ver concessionarias <ArrowRight size={12} />
                  </Link>
                </div>
              ))}

              <div className="bg-[#090e1a]/40 p-6 rounded-2xl border border-dashed border-white/10 flex flex-col justify-between group hover:border-orange-500/40 hover:bg-[#090e1a]/60 transition-all duration-300">
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-white/5 text-slate-400 border border-white/5 rounded-xl flex items-center justify-center font-black text-lg group-hover:bg-gradient-to-br group-hover:from-orange-500 group-hover:to-amber-400 group-hover:text-white transition-all">
                      ?
                    </div>
                    <div>
                      <h3 className="font-extrabold text-white leading-tight">Sem gestor definido</h3>
                      <p className="text-[10px] font-bold text-slate-500">Aguardando atribuição</p>
                    </div>
                  </div>
                  <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Concessionarias Livres</p>
                    <p className="text-3xl font-black text-white group-hover:scale-105 origin-left transition-transform">{corretoresSemGestor}</p>
                  </div>
                </div>
                <Link 
                  href="/admin/corretoras?gestor=sem-gestor"
                  className="mt-5 w-full py-2.5 bg-white/5 border border-white/5 text-white font-extrabold text-[10px] uppercase tracking-widest rounded-xl hover:bg-gradient-to-r hover:from-orange-600 hover:to-amber-500 hover:border-orange-500 hover:shadow-lg hover:shadow-orange-500/10 transition-all flex items-center justify-center gap-2"
                >
                  Ver concessionarias <ArrowRight size={12} />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Quick Actions Section */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Ações rápidas</h2>
          <div className="h-px flex-1 bg-white/5" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action, idx) => (
            <Link 
              key={idx} 
              href={action.href}
              className={`group p-6 rounded-2xl border ${action.borderColor} bg-[#090e1a]/80 backdrop-blur-md hover:scale-[1.02] shadow-xl hover:${action.glowColor} transition-all duration-300 flex flex-col justify-between h-56`}
            >
              <div className="flex justify-between items-start">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${action.color} text-white shadow-lg transition-transform duration-300 group-hover:scale-110`}>
                  <action.icon size={22} />
                </div>
                <ChevronRight size={18} className="text-slate-500 group-hover:text-white transition-colors" />
              </div>
              
              <div className="mt-4">
                <h3 className="text-lg font-black text-white mb-1 group-hover:text-cyan-400 transition-colors">{action.title}</h3>
                <p className="text-xs font-medium text-slate-400 leading-relaxed">
                  {action.desc}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Modal: Concessionarias Sem Saldo */}
      {mounted && showNoBalanceModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-[#090e1a]/95 border border-red-500/20 w-full max-w-lg rounded-3xl p-6 shadow-2xl relative">
            <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /> Concessionarias Sem Saldo
            </h3>
            <p className="text-xs font-semibold text-slate-500 mb-6">Contas no Meta Ads com saldo zerado ou esgotado.</p>
            
            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-3 scrollbar-none">
              {noBalanceList.length === 0 ? (
                <p className="text-sm font-semibold text-slate-500 text-center py-6">Nenhuma concessionaria sem saldo.</p>
              ) : (
                noBalanceList.map((item) => (
                  <div key={item.corretor_id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-extrabold text-white">{item.corretora_nome}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Gestor: {item.gestor_nome}</p>
                      <p className="text-[9px] font-semibold text-slate-600 mt-1">Conta: {item.meta_ad_account_name}</p>
                    </div>
                    <span className="text-xs font-black text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-full">
                      R$ 0,00
                    </span>
                  </div>
                ))
              )}
            </div>
            
            <button
              onClick={() => setShowNoBalanceModal(false)}
              className="mt-6 w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition-all"
            >
              Fechar
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Entradas Pendentes */}
      {mounted && showPendingOnboardingModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-[#090e1a]/95 border border-indigo-500/20 w-full max-w-lg rounded-3xl p-6 shadow-2xl relative">
            <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" /> Entradas Pendentes
            </h3>
            <p className="text-xs font-semibold text-slate-500 mb-6">Processos de onboarding/entrada aguardando preenchimento.</p>
            
            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-3 scrollbar-none">
              {pendingOnboardingList.length === 0 ? (
                <p className="text-sm font-semibold text-slate-500 text-center py-6">Nenhuma entrada pendente.</p>
              ) : (
                pendingOnboardingList.map((item) => (
                  <div key={item.corretor_id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-extrabold text-white">{item.corretor_nome}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Gestor: {item.gestor_nome}</p>
                    </div>
                    <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider">
                      Pendente
                    </span>
                  </div>
                ))
              )}
            </div>
            
            <button
              onClick={() => setShowPendingOnboardingModal(false)}
              className="mt-6 w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition-all"
            >
              Fechar
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Concessionarias Sem Meta Ads */}
      {mounted && showNoMetaModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-[#090e1a]/95 border border-cyan-500/20 w-full max-w-lg rounded-3xl p-6 shadow-2xl relative">
            <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse" /> Concessionarias Sem Meta Ads
            </h3>
            <p className="text-xs font-semibold text-slate-500 mb-6">Concessionarias ativas sem conta de anuncio vinculada no Meta.</p>
 
            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-3 scrollbar-none">
              {noMetaList.length === 0 ? (
                <p className="text-sm font-semibold text-slate-500 text-center py-6">Nenhuma concessionaria sem Meta Ads.</p>
              ) : (
                noMetaList.map((item) => (
                  <div key={item.corretor_id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-extrabold text-white">{item.corretora_nome}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Gestor: {item.gestor_nome}</p>
                      <p className="text-[9px] font-semibold text-slate-600 mt-1">
                        {item.is_corretora ? `${item.corretores_total} corretor(es): ${item.corretores_nomes}` : 'Corretor sem concessionaria'}
                      </p>
                    </div>
                    <Link
                      href={item.corretor_id ? `/admin/corretores/${item.corretor_id}/editar` : '/admin/meta'}
                      className="text-[9px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider hover:bg-cyan-500/20"
                    >
                      Vincular
                    </Link>
                  </div>
                ))
              )}
            </div>
 
            <button
              onClick={() => setShowNoMetaModal(false)}
              className="mt-6 w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition-all"
            >
              Fechar
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Corretores Sem Concessionaria */}
      {mounted && showNoBrokerageModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-[#090e1a]/95 border border-amber-500/20 w-full max-w-lg rounded-3xl p-6 shadow-2xl relative">
            <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" /> Corretores Sem Concessionaria
            </h3>
            <p className="text-xs font-semibold text-slate-500 mb-6">Corretores ativos que ainda nao foram vinculados a uma concessionaria.</p>
 
            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-3 scrollbar-none">
              {noBrokerageList.length === 0 ? (
                <p className="text-sm font-semibold text-slate-500 text-center py-6">Nenhum corretor sem concessionaria.</p>
              ) : (
                noBrokerageList.map((item) => (
                  <div key={item.corretor_id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-extrabold text-white">{item.corretor_nome}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Gestor: {item.gestor_nome}</p>
                    </div>
                    <Link
                      href={`/admin/corretores/${item.corretor_id}/editar`}
                      className="text-[9px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider hover:bg-amber-500/20"
                    >
                      Vincular
                    </Link>
                  </div>
                ))
              )}
            </div>
 
            <button
              onClick={() => setShowNoBrokerageModal(false)}
              className="mt-6 w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition-all"
            >
              Fechar
            </button>
          </div>
        </div>,
        document.body
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
